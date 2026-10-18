const $ = (s) => document.querySelector(s);
const TOKEN_KEY = "skill_flow_admin_token";
let csrf = "";

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}
function setToken(t) {
  sessionStorage.setItem(TOKEN_KEY, t);
}
function showErr(msg) {
  const el = $("#err");
  el.hidden = !msg;
  el.textContent = msg || "";
}

async function api(path, opts = {}) {
  const t = token();
  const method = (opts.method || "GET").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (t) headers.Authorization = `Bearer ${t}`;
  if (csrf && method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = csrf;
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !t) {
    const st = await fetch("/v1/auth/status").then((r) => r.json()).catch(() => ({}));
    location.replace(st.setupRequired ? "/admin/setup.html" : "/admin/login.html");
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function renderStatus() {
  const st = await api("/v1/status");
  $("#tab-status").innerHTML = `<div class="surface"><div class="panel-head">Status</div>
    <div class="panel-pad">
      <p>version <span class="mono">${esc(st.version)}</span></p>
      <p class="muted">home ${esc(st.skillFlowHome)}</p>
      <p class="muted">catalog ${esc(st.catalogDir)}</p>
      <p>harnesses: ${(st.harnessesPresent || []).join(", ") || "none detected"}</p>
    </div></div>`;
}

async function renderCatalog() {
  $("#tab-catalog").innerHTML = `<div class="surface"><div class="panel-head">Catalog</div>
    <div class="panel-pad">
      <form id="search" class="row-actions">
        <input name="q" placeholder="search skills" />
        <button class="pill-btn primary" type="submit">Search</button>
      </form>
      <div id="catOut"></div>
    </div></div>`;
  $("#search").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q");
    const { results } = await api(`/v1/catalog/search?q=${encodeURIComponent(q)}`);
    $("#catOut").innerHTML = `<table><thead><tr><th>Name</th><th>Summary</th></tr></thead><tbody>${
      (results || [])
        .map((r) => `<tr><td class="mono">${esc(r.name)}</td><td>${esc(r.summary)}</td></tr>`)
        .join("") || `<tr><td colspan="2" class="muted">No hits</td></tr>`
    }</tbody></table>`;
  });
}

async function renderInstalls() {
  const { installed } = await api("/v1/installs");
  const rows = (installed || [])
    .map(
      (i) => `<tr><td>${esc(i.name)}</td><td class="mono">${esc(i.path)}</td>
        <td><button class="pill-btn" data-rm="${esc(i.name)}">Uninstall</button></td></tr>`,
    )
    .join("");
  $("#tab-installs").innerHTML = `<div class="surface"><div class="panel-head">Installs</div>
    <div class="panel-pad">
      <form id="inst" class="row-actions">
        <input name="source" placeholder="catalog id, path, or git URL" required />
        <button class="pill-btn primary" type="submit">Install</button>
      </form>
      <table><thead><tr><th>Name</th><th>Path</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">None</td></tr>`}</tbody></table>
    </div></div>`;
  $("#inst").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/v1/installs", {
        method: "POST",
        body: JSON.stringify({ source: new FormData(e.target).get("source") }),
      });
      await renderInstalls();
    } catch (err) {
      showErr(err.message);
    }
  });
  document.querySelectorAll("[data-rm]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/v1/installs/${encodeURIComponent(btn.dataset.rm)}`, { method: "DELETE" });
        await renderInstalls();
      } catch (err) {
        showErr(err.message);
      }
    });
  });
}

async function renderHarnesses() {
  const { registry, detected } = await api("/v1/harnesses");
  $("#tab-harnesses").innerHTML = `<div class="surface"><div class="panel-head">Harnesses</div>
    <div class="panel-pad"><table><thead><tr><th>Id</th><th>Present</th></tr></thead><tbody>${
      (detected || registry || [])
        .map(
          (h) =>
            `<tr><td class="mono">${esc(h.id)}</td><td>${h.present ? "yes" : "no"}</td></tr>`,
        )
        .join("")
    }</tbody></table></div></div>`;
}

async function renderAudit() {
  const { events } = await api("/v1/audit/events");
  $("#tab-audit").innerHTML = `<div class="surface"><div class="panel-head">Audit</div>
    <div class="panel-pad">
      <form id="aud" class="row-actions">
        <input name="source" placeholder="source to audit" required />
        <button class="pill-btn primary" type="submit">Run audit</button>
      </form>
      <table><thead><tr><th>Time</th><th>Action</th></tr></thead><tbody>${
        (events || [])
          .map((e) => `<tr><td class="muted">${esc(e.ts)}</td><td>${esc(e.action)}</td></tr>`)
          .join("") || `<tr><td colspan="2" class="muted">No events</td></tr>`
      }</tbody></table>
    </div></div>`;
  $("#aud").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/v1/audit", {
        method: "POST",
        body: JSON.stringify({ source: new FormData(e.target).get("source") }),
      });
      showErr(r.report ? `risk ${r.report.risk}` : "");
      await renderAudit();
    } catch (err) {
      showErr(err.message);
    }
  });
}

async function renderOperators() {
  const { operators } = await api("/v1/operators");
  $("#tab-operators").innerHTML = `<div class="surface"><div class="panel-head">Operators</div>
    <div class="panel-pad">
      <p class="lede" style="margin-top:0">Local to this skill-flow instance.</p>
      <table><thead><tr><th>Email</th></tr></thead><tbody>${
        (operators || []).map((o) => `<tr><td>${esc(o.email)}</td></tr>`).join("")
      }</tbody></table>
      <form id="addOp" class="row-actions" style="margin-top:12px">
        <input name="email" type="email" required />
        <input name="password" type="password" minlength="8" required />
        <button class="pill-btn primary" type="submit">Add</button>
      </form>
    </div></div>`;
  $("#addOp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/v1/operators", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      await renderOperators();
    } catch (err) {
      showErr(err.message);
    }
  });
}

async function refresh() {
  showErr("");
  const tab = document.querySelector(".seg-btn.active")?.dataset.tab || "status";
  if (tab === "status") await renderStatus();
  if (tab === "catalog") await renderCatalog();
  if (tab === "installs") await renderInstalls();
  if (tab === "harnesses") await renderHarnesses();
  if (tab === "audit") await renderAudit();
  if (tab === "operators") await renderOperators();
}

document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    void refresh();
  });
});
$("#refresh").addEventListener("click", () => void refresh());
$("#saveToken").addEventListener("click", () => {
  setToken($("#token").value.trim());
  void refresh();
});
$("#logout").addEventListener("click", async () => {
  sessionStorage.removeItem(TOKEN_KEY);
  await fetch("/v1/auth/logout", { method: "POST" });
  location.replace("/admin/login.html");
});
$("#token").value = token();

(async () => {
  const me = await fetch("/v1/auth/me").then((r) => (r.ok ? r.json() : null));
  if (me?.operator) {
    csrf = me.csrf || "";
    $("#who").textContent = me.operator.email;
    await refresh();
    return;
  }
  if (token()) {
    $("#who").textContent = "Break-glass token";
    await refresh();
    return;
  }
  const st = await fetch("/v1/auth/status").then((r) => r.json()).catch(() => ({}));
  location.replace(st.setupRequired ? "/admin/setup.html" : "/admin/login.html");
})();
