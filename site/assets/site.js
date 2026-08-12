const cfg = () =>
  window.__SITE__ || {
    base: "",
    catalogBase: "catalog",
    repo: "https://github.com/real-limitless/skill-flow",
  };

function siteHref(path) {
  const base = (cfg().base || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base && p === "/") return "./";
  return `${base}${p}` || "./";
}

function catalogUrl(rel) {
  const base = (cfg().base || "").replace(/\/$/, "");
  const cat = (cfg().catalogBase || "catalog").replace(/^\//, "").replace(/\/$/, "");
  const r = rel.replace(/^\//, "");
  return `${base}/${cat}/${r}`.replace(/([^:]\/)\/+/g, "$1");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function entryFilename(id) {
  return (
    String(id)
      .replace(/\\/g, "/")
      .replace(/\//g, "--")
      .replace(/:/g, "__")
      .replace(/[^a-zA-Z0-9._@+-]+/g, "_")
      .slice(0, 200) + ".json"
  );
}

function wireNav() {
  document.querySelectorAll("[data-site-href]").forEach((el) => {
    const p = el.getAttribute("data-site-href") || "/";
    el.setAttribute("href", siteHref(p === "/" ? "/" : p));
  });
  document.querySelectorAll("[data-repo]").forEach((el) => {
    el.setAttribute("href", cfg().repo);
  });
}

async function loadCatalogIndex() {
  const res = await fetch(catalogUrl("index.json"));
  if (!res.ok) throw new Error(`catalog index ${res.status}`);
  return res.json();
}

async function loadEntry(id) {
  const res = await fetch(catalogUrl(`entries/${entryFilename(id)}`));
  if (!res.ok) throw new Error(`entry ${res.status}`);
  return res.json();
}

function riskClass(risk) {
  if (risk === "high") return "deny";
  if (risk === "medium") return "warn";
  if (risk === "low") return "on";
  return "";
}

function renderHomeCatalog() {
  const status = document.getElementById("status");
  const list = document.getElementById("skill-list");
  const q = document.getElementById("q");
  const fRisk = document.getElementById("f-risk");
  if (!list) return;

  let index = { entries: [] };

  function paint() {
    const query = (q?.value || "").trim().toLowerCase();
    const risk = fRisk?.value || "";
    let rows = index.entries || [];
    if (query) {
      const terms = query.split(/\s+/).filter(Boolean);
      rows = rows.filter((e) => {
        const hay = [e.id, e.name, e.summary, e.description, ...(e.tags || [])]
          .join(" ")
          .toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    if (risk) rows = rows.filter((e) => (e.risk || "") === risk);

    if (status) {
      status.textContent = `${rows.length} skill${rows.length === 1 ? "" : "s"} · schema ${(index.schemaVersion || "").toString() || "—"}`;
    }

    list.innerHTML = rows
      .map((e) => {
        const tags = (e.tags || [])
          .slice(0, 4)
          .map((t) => `<span class="badge place">${escapeHtml(t)}</span>`)
          .join(" ");
        const riskBadge = e.risk
          ? `<span class="badge ${riskClass(e.risk)}">${escapeHtml(e.risk)}</span>`
          : "";
        return `<a class="row-card" href="${siteHref("/skill.html")}?id=${encodeURIComponent(e.id)}">
          <div class="row-main">
            <div class="row-title">${escapeHtml(e.name)}</div>
            <div class="row-sub mono">${escapeHtml(e.id)}</div>
            <div class="row-desc">${escapeHtml(e.summary || e.description || "")}</div>
          </div>
          <div class="row-meta">${riskBadge} ${tags}</div>
        </a>`;
      })
      .join("");

    if (!rows.length) {
      list.innerHTML = `<p class="status-line">No skills match. Run <code class="mono">npm run catalog:seed</code> and rebuild the site.</p>`;
    }
  }

  loadCatalogIndex()
    .then((data) => {
      index = data;
      paint();
    })
    .catch((err) => {
      if (status) status.textContent = `Catalog unavailable: ${err.message}`;
      list.innerHTML = `<p class="status-line">Could not load catalog/index.json. Build with <code class="mono">npm run site:build</code>.</p>`;
    });

  q?.addEventListener("input", () => paint());
  fRisk?.addEventListener("change", () => paint());
}

async function renderSkillDetail() {
  const root = document.getElementById("skill-detail");
  if (!root) return;
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    root.innerHTML = `<p class="status-line">Missing ?id=</p>`;
    return;
  }
  try {
    const e = await loadEntry(id);
    const installCmd = `npx skill-flow install ${JSON.stringify(e.id)} --target portable --yes`;
    root.innerHTML = `
      <p class="eyebrow">${escapeHtml(e.provenance || "catalog")} · ${escapeHtml(e.status || "")}</p>
      <h1 class="display" style="max-width: 20ch; font-size: 42px">${escapeHtml(e.name)}</h1>
      <p class="lede" style="max-width: 60ch">${escapeHtml(e.description || "")}</p>
      <div class="tag-row" style="margin: 16px 0 24px">
        ${(e.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
        ${e.security?.risk ? `<span class="tag hot">risk:${escapeHtml(e.security.risk)}</span>` : ""}
      </div>
      <div class="panel" style="margin-bottom: 20px">
        <div class="panel-head"><span class="title">Install</span><span class="title">CLI</span></div>
        <pre class="code-block">${escapeHtml(installCmd)}</pre>
      </div>
      <div class="panel" style="margin-bottom: 20px">
        <div class="panel-head"><span class="title">SKILL.md preview</span></div>
        <pre class="code-block">${escapeHtml(e.skillMd?.bodyPreview || "(no preview)")}</pre>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="title">Entry JSON</span></div>
        <pre class="code-block">${escapeHtml(JSON.stringify(e, null, 2).slice(0, 4000))}</pre>
      </div>`;
  } catch (err) {
    root.innerHTML = `<p class="status-line">Failed to load entry: ${escapeHtml(err.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  wireNav();
  const page = document.body.dataset.page;
  if (page === "catalog" || page === "home") renderHomeCatalog();
  if (page === "skill") renderSkillDetail();
});
