// Same /v1 contract as the previous vanilla admin (src/admin/app.js).
export const TOKEN_KEY = "skill_flow_admin_token";
let csrf = "";

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string) {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}
export function setCsrf(v: string) {
  csrf = v;
}

export type AuthStatus = { setupRequired?: boolean; authenticated?: boolean };

export async function authStatus(): Promise<AuthStatus> {
  return fetch("/v1/auth/status")
    .then((r) => r.json())
    .catch(() => ({}));
}

export function go(route: "setup" | "login" | "console") {
  const hash = route === "console" ? "#/" : `#/${route}`;
  if (location.hash !== hash) location.replace(`/admin/${hash}`);
}

export async function redirectForStatus() {
  const st = await authStatus();
  go(st.setupRequired ? "setup" : "login");
}

export async function api<T = Record<string, unknown>>(path: string, opts: RequestInit = {}): Promise<T> {
  const t = getToken();
  const method = (opts.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  if (csrf && method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = csrf;
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !t) {
    await redirectForStatus();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error((body as { error?: string }).error || res.statusText);
  return body as T;
}

export async function postCredentials(path: "/v1/auth/setup" | "/v1/auth/login", email: string, password: string) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || "failed");
}
