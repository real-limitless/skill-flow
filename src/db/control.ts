import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  hashPassword,
  hashToken,
  mintOpaqueToken,
  newId,
  verifyPassword,
} from "../crypto.js";

export interface OperatorPublic {
  id: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface OperatorSession {
  operator: OperatorPublic;
  csrf: string;
  sessionId: string;
}

export interface AuditEvent {
  id: string;
  ts: string;
  action: string;
  detail: Record<string, unknown> | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowOp(r: Record<string, unknown>): OperatorPublic {
  return {
    id: String(r.id),
    email: String(r.email),
    createdAt: String(r.created_at),
    lastLoginAt: r.last_login_at == null ? null : String(r.last_login_at),
  };
}

export class ControlStore {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        /* best-effort */
      }
    }
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operators (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS operator_sessions (
        id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        csrf TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        action TEXT NOT NULL,
        detail_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sf_sess_hash ON operator_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sf_audit_ts ON audit_events(ts DESC);
    `);
  }

  close(): void {
    this.db.close();
  }

  countOperators(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM operators")
      .get() as { n: number | bigint } | undefined;
    return Number(row?.n ?? 0);
  }

  listOperators(): OperatorPublic[] {
    const rows = this.db
      .prepare(
        "SELECT id, email, created_at, last_login_at FROM operators ORDER BY created_at",
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowOp);
  }

  createOperator(email: string, password: string): OperatorPublic {
    const rec: OperatorPublic = {
      id: newId("op"),
      email: email.trim().toLowerCase(),
      createdAt: nowIso(),
      lastLoginAt: null,
    };
    this.db
      .prepare(
        "INSERT INTO operators (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(rec.id, rec.email, hashPassword(password), rec.createdAt);
    return rec;
  }

  authenticateOperator(email: string, password: string): OperatorPublic | null {
    const row = this.db
      .prepare(
        "SELECT id, email, password_hash, created_at, last_login_at FROM operators WHERE email = ?",
      )
      .get(email.trim().toLowerCase()) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (!verifyPassword(password, String(row.password_hash))) return null;
    return rowOp(row);
  }

  createSession(operator: OperatorPublic): {
    token: string;
    csrf: string;
    expiresAt: string;
  } {
    const { token, hash } = mintOpaqueToken();
    const csrf = mintOpaqueToken().token;
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    this.db
      .prepare(
        `INSERT INTO operator_sessions (id, operator_id, token_hash, csrf, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId("opsess"), operator.id, hash, csrf, expiresAt, nowIso());
    this.db
      .prepare("UPDATE operators SET last_login_at = ? WHERE id = ?")
      .run(nowIso(), operator.id);
    return { token, csrf, expiresAt };
  }

  authenticateSession(token: string): OperatorSession | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.csrf, s.expires_at, s.revoked_at,
                o.id, o.email, o.created_at, o.last_login_at
         FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
         WHERE s.token_hash = ?`,
      )
      .get(hashToken(token)) as Record<string, unknown> | undefined;
    if (!row || row.revoked_at != null) return null;
    if (String(row.expires_at) <= nowIso()) return null;
    return {
      operator: rowOp(row),
      csrf: String(row.csrf),
      sessionId: String(row.session_id),
    };
  }

  revokeSession(token: string): void {
    this.db
      .prepare(
        "UPDATE operator_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .run(nowIso(), hashToken(token));
  }

  writeAudit(action: string, detail?: Record<string, unknown> | null): void {
    this.db
      .prepare(
        "INSERT INTO audit_events (id, ts, action, detail_json) VALUES (?, ?, ?, ?)",
      )
      .run(
        newId("aud"),
        nowIso(),
        action,
        detail ? JSON.stringify(detail) : null,
      );
  }

  listAudit(limit = 50): AuditEvent[] {
    const rows = this.db
      .prepare(
        "SELECT id, ts, action, detail_json FROM audit_events ORDER BY ts DESC LIMIT ?",
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      ts: String(r.ts),
      action: String(r.action),
      detail: r.detail_json
        ? (JSON.parse(String(r.detail_json)) as Record<string, unknown>)
        : null,
    }));
  }
}
