(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const usd = new Intl.NumberFormat("en-US");
  const money = (x) => "$" + usd.format(Math.round(x));
  const pct = (x, d = 1) => (+x).toFixed(d) + "%";          // x already in percent
  const prob = (p, d = 1) => (p * 100).toFixed(d) + "%";    // p is 0..1
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const tierClass = (t) => (t.startsWith("Low") ? "t-low" : t.startsWith("Moderate") ? "t-mod" : "t-high");

  const state = { capital: 2000, risk: 5, verifiedOnly: true, query: "" };
  let data = { ranked: [], unverifiedOpen: 0 };
  let prevRanks = null, lastRender = null, baselineTimer = 0;

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  let theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const themeBtn = $("#themeToggle");
  const sun = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function applyTheme() {
    root.setAttribute("data-theme", theme);
    themeBtn.innerHTML = theme === "dark" ? sun : moon;
    themeBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  themeBtn.addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; applyTheme(); });
  applyTheme();

  /* ---------- Navigation ---------- */
  function go(view) {
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-" + view));
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.nav === view));
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (view === "invest") renderChart();
  }
  $$("[data-nav]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.dataset.nav); }));

  /* ---------- Controls ---------- */
  const amountInput = $("#amountInput"), amountRange = $("#amountRange"), riskRange = $("#riskRange");
  const riskLabel = (r) => (r <= 3 ? "Conservative" : r <= 7 ? "Balanced" : "Aggressive");
  const setFill = (el) => el.style.setProperty("--fill", ((el.value - el.min) / (el.max - el.min)) * 100 + "%");
  function syncControls() {
    amountRange.value = clamp(state.capital, 100, 5000);
    setFill(amountRange);
    if (document.activeElement !== amountInput) amountInput.value = usd.format(state.capital);
    riskRange.value = state.risk;
    $("#riskOut").textContent = state.risk + " / 10 · " + riskLabel(state.risk);
    $("#tolOut").textContent = prob(state.risk / 50, 0);
    $$("[data-amt]").forEach((c) => c.classList.toggle("is-on", +c.dataset.amt === state.capital));
    $$("[data-risk]").forEach((c) => c.classList.toggle("is-on", +c.dataset.risk === state.risk));
  }
  let timer = 0;
  const schedule = () => { syncControls(); clearTimeout(timer); timer = setTimeout(update, 40); };
  amountRange.addEventListener("input", () => { state.capital = +amountRange.value; schedule(); });
  amountInput.addEventListener("input", () => {
    const digits = amountInput.value.replace(/\D/g, "").slice(0, 5);
    const v = +digits || 0;
    amountInput.value = digits ? usd.format(v) : "";
    if (v >= 100) { state.capital = Math.min(v, 5000); clearTimeout(timer); timer = setTimeout(update, 40); }
  });
  amountInput.addEventListener("blur", () => { state.capital = clamp(+amountInput.value.replace(/\D/g, "") || 100, 100, 5000); amountInput.value = usd.format(state.capital); schedule(); });
  amountInput.addEventListener("keydown", (e) => { if (e.key === "Enter") amountInput.blur(); });
  riskRange.addEventListener("input", () => { state.risk = +riskRange.value; schedule(); });
  $$("[data-amt]").forEach((c) => c.addEventListener("click", () => { state.capital = +c.dataset.amt; schedule(); }));
  $$("[data-risk]").forEach((c) => c.addEventListener("click", () => { state.risk = +c.dataset.risk; schedule(); }));
  $("#verifiedOnly").addEventListener("change", (e) => {
    state.verifiedOnly = e.target.checked; schedule();
    toast(state.verifiedOnly ? "Showing only Aadhaar + PAN verified borrowers" : "Showing all borrowers, including unverified");
  });
  $("#search").addEventListener("input", (e) => { state.query = e.target.value.toLowerCase(); renderTable(); });

  /* ---------- Backend calls ---------- */
  let inflight = null, seq = 0;
  async function update() {
    const my = ++seq;
    if (inflight) inflight.abort();
    inflight = new AbortController();
    $(".results").classList.add("is-loading");
    try {
      const res = await Api.match({ risk: state.risk, capital: state.capital, verifiedOnly: state.verifiedOnly }, inflight.signal);
      if (my !== seq) return;
      data = res;
      render();
    } catch (e) {
      if (e.name !== "AbortError") console.error(e);
    } finally {
      if (my === seq) $(".results").classList.remove("is-loading");
    }
  }
  function renderEngine() {
    const el = $("#engineStatus");
    const live = Api.mode === "java";
    el.className = "engine " + (live ? "is-live" : "is-local");
    el.querySelector("span:last-child").textContent = live ? "Live: ranked by the Java matchmaker API" : "Offline: using a local copy of the Java algorithm";
  }

  function render() {
    const top = data.ranked.slice(0, 5);
    renderEngine(); renderKpis(top); renderTop(top); renderChart(); renderTable(); renderKycNote();
    const snap = new Map(top.map((t) => [t.borrower.id, t.rank]));
    lastRender = snap;
    if (!prevRanks) prevRanks = snap;
    clearTimeout(baselineTimer);
    baselineTimer = setTimeout(() => { prevRanks = snap; }, 1500);
  }

  function renderKycNote() {
    const shown = data.ranked.length, unv = data.unverifiedOpen;
    $("#kycNote").innerHTML = state.verifiedOnly
      ? `<b>${shown}</b> verified listings shown · ${unv} unverified hidden`
      : `Showing all <b>${shown}</b> listings · ${unv} not fully verified (marked in red)`;
  }

  function portfolio(top) {
    const inv = top.reduce((s, t) => s + t.allocation, 0);
    if (!inv) return { inv: 0, roi: 0, earn: 0, pd: 0 };
    let roi = 0, pd = 0;
    top.forEach((t) => { const w = t.allocation / inv; roi += w * t.netExpectedROI; pd += w * t.borrower.defaultProb; });
    return { inv, roi, earn: (inv * roi) / 100, pd };
  }

  function renderKpis(top) {
    const s = portfolio(top);
    const verified = top.filter((t) => t.borrower.kyc.verified).length;
    const avgScore = top.length ? top.reduce((a, t) => a + t.matchScore, 0) / top.length : 0;
    const unalloc = Math.max(0, state.capital - s.inv);
    $("#kpis").innerHTML = `
      <div class="card kpi"><div class="kpi-label">Portfolio net ROI</div><div class="kpi-value pos">${pct(s.roi, 2)}</div><div class="kpi-sub">after expected default losses</div></div>
      <div class="card kpi"><div class="kpi-label">Expected yearly earnings</div><div class="kpi-value">${money(s.earn)}</div><div class="kpi-sub">on ${money(s.inv)} invested${unalloc >= 1 ? ` · <span class="warn">${money(unalloc)} unallocated</span>` : ""}</div></div>
      <div class="card kpi"><div class="kpi-label">Avg. default probability</div><div class="kpi-value">${prob(s.pd)}</div><div class="kpi-sub">avg. match score ${avgScore.toFixed(1)} / 100</div></div>
      <div class="card kpi"><div class="kpi-label">KYC verified</div><div class="kpi-value">${verified}/${top.length}</div><div class="kpi-sub">Aadhaar + PAN checked</div></div>`;
    $("#summaryLine").textContent = `Ranked ${data.ranked.length} open listings for ${money(state.capital)} at ${riskLabel(state.risk).toLowerCase()} risk (${state.risk}/10).`;
    $("#fundBtn").disabled = !s.inv;
  }

  function details(t) {
    const b = t.borrower, s = t.scores;
    const loss = b.defaultProb * 75;
    const out = [];
    out.push({ t: `Risk fit ${s.riskFit.toFixed(1)}/40: risk index ${(b.defaultProb * 50).toFixed(1)} vs your appetite ${state.risk}`, w: s.riskFit < 20 });
    out.push({ t: `Net ROI ${pct(t.netExpectedROI, 2)}: ${pct(b.interestRate)} interest − ${pct(loss, 2)} expected loss` });
    out.push({ t: `Capital fit ${s.capital.toFixed(1)}/25: requests ${money(b.requestedAmount)} vs your ${money(state.capital)}`, w: s.capital < 10 });
    if (!b.kyc.verified) out.push({ t: "KYC incomplete: Aadhaar and PAN not both verified", w: true });
    return out;
  }

  const tick = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg>';
  const cross = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const kycBadges = (k) => `<span class="kyc ${k.aadhaar ? "ok" : "no"}" title="Aadhaar ${k.aadhaar ? "verified" : "not verified"}">${k.aadhaar ? tick : cross} Aadhaar</span><span class="kyc ${k.pan ? "ok" : "no"}" title="PAN ${k.pan ? "verified" : "not verified"}">${k.pan ? tick : cross} PAN</span>`;

  function scoreBar(t) {
    const s = t.scores;
    return `<div class="factors" aria-hidden="true"><span class="f-risk" style="width:${s.riskFit}%"></span><span class="f-ret" style="width:${s.return}%"></span><span class="f-capi" style="width:${s.capital}%"></span></div>`;
  }

  function renderTop(top) {
    const box = $("#top5");
    if (!top.length) {
      box.innerHTML = `<div class="card empty"><b>No open listings match.</b><br/>Try turning off the verified-only filter.</div>`;
      return;
    }
    box.innerHTML = top.map((t) => {
      const b = t.borrower;
      let mv = "";
      if (prevRanks) {
        const was = prevRanks.get(b.id);
        if (was === undefined) mv = `<span class="move new">NEW</span>`;
        else if (was > t.rank) mv = `<span class="move up">▲${was - t.rank}</span>`;
        else if (was < t.rank) mv = `<span class="move down">▼${t.rank - was}</span>`;
      }
      const changed = lastRender && lastRender.get(b.id) !== t.rank;
      return `<article class="card rec${changed ? " flash" : ""}" data-id="${b.id}" tabindex="0" aria-label="Rank ${t.rank}: ${esc(b.name)}">
        ${mv}
        <div class="rank-badge">${t.rank}</div>
        <div class="who">
          <div class="avatar">${initials(b.name)}</div>
          <div style="min-width:0">
            <div class="who-name">${esc(b.name)} <span class="tier ${tierClass(b.riskTier)}">${b.riskTier}</span></div>
            <div class="who-sub">${b.id} · ${esc(b.purpose)} · Credit ${b.creditScore}</div>
            <div class="badges">${kycBadges(b.kyc)}</div>
          </div>
        </div>
        <div class="why-col">
          <p class="rationale">${esc(t.rationale)}</p>
          <ul class="why">${details(t).map((r) => `<li class="${r.w ? "w" : ""}">${r.t}</li>`).join("")}</ul>
          ${scoreBar(t)}
        </div>
        <div class="nums">
          <div class="roi pos">${pct(t.netExpectedROI, 2)} <small>net ROI</small></div>
          <div class="alloc">Invest ${money(t.allocation)}</div>
          <small>Earn ~${money((t.allocation * t.netExpectedROI) / 100)}/yr · ${t.matchScore.toFixed(1)} pts</small>
        </div>
      </article>`;
    }).join("") + `<div class="factor-legend" aria-label="Match score legend"><span><i class="f-risk"></i>Risk fit (40)</span><span><i class="f-ret"></i>Return (35)</span><span><i class="f-capi"></i>Capital fit (25)</span><span>Bar length = match score out of 100</span></div>`;
    $$(".rec", box).forEach((el) => {
      el.addEventListener("click", () => openDrawer(el.dataset.id));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(el.dataset.id); } });
    });
  }

  /* ---------- Chart ---------- */
  const svg = $("#chart"), tip = $("#tooltip");
  const NS = "http://www.w3.org/2000/svg";
  function renderChart() {
    const W = svg.clientWidth, H = svg.clientHeight || 340;
    if (!W) return; // hidden tab
    const m = { l: 48, r: 16, t: 14, b: 36 };
    const xMax = 0.2, yMax = 25;
    const x = (v) => m.l + (clamp(v, 0, xMax) / xMax) * (W - m.l - m.r);
    const y = (v) => H - m.b - (clamp(v, 0, yMax) / yMax) * (H - m.t - m.b);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (svg.dataset.w != W) {
      svg.dataset.w = W;
      let h = `<rect class="zone" y="${m.t}" height="${H - m.t - m.b}" x="${m.l}" width="0"/><line class="ideal" y1="${m.t}" y2="${H - m.b}" stroke="var(--color-primary)" stroke-dasharray="4 4"/><g class="grid">`;
      for (let v = 0; v <= xMax + 1e-9; v += 0.04) h += `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H - m.b}"/>`;
      for (let v = 0; v <= yMax; v += 5) h += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      h += `</g><g class="axis">`;
      for (let v = 0; v <= xMax + 1e-9; v += 0.04) h += `<text x="${x(v)}" y="${H - m.b + 16}" text-anchor="middle">${Math.round(v * 100)}%</text>`;
      for (let v = 0; v <= yMax; v += 5) h += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
      h += `<text x="${(W + m.l) / 2}" y="${H - 4}" text-anchor="middle">Default probability →</text>`;
      h += `<text transform="translate(12 ${(H - m.b + m.t) / 2}) rotate(-90)" text-anchor="middle">Net ROI →</text></g><g class="pts"></g>`;
      svg.innerHTML = h;
    }
    const lo = Math.max(0, (state.risk - 4) / 50), hi = (state.risk + 4) / 50;
    const z = svg.querySelector(".zone");
    z.setAttribute("x", x(lo)); z.setAttribute("width", Math.max(0, x(hi) - x(lo)));
    const ideal = svg.querySelector(".ideal");
    ideal.setAttribute("x1", x(state.risk / 50)); ideal.setAttribute("x2", x(state.risk / 50));
    const g = svg.querySelector(".pts");
    g.innerHTML = "";
    const ordered = [...data.ranked].reverse(); // draw top ranks last
    ordered.forEach((t) => {
      const b = t.borrower, top = t.rank <= 5;
      const node = document.createElementNS(NS, "g");
      node.style.cursor = "pointer";
      node.innerHTML = `<circle cx="${x(b.defaultProb)}" cy="${y(t.netExpectedROI)}" r="${top ? 11 : 6}" fill="${top ? "var(--color-primary)" : b.kyc.verified ? "var(--color-text-faint)" : "transparent"}" stroke="${top ? "var(--color-surface)" : b.kyc.verified ? "none" : "var(--color-error)"}" stroke-width="2"/>` +
        (top ? `<text x="${x(b.defaultProb)}" y="${y(t.netExpectedROI) + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="var(--color-text-inverse)" pointer-events="none">${t.rank}</text>` : "");
      node.addEventListener("mouseenter", (e) => {
        tip.innerHTML = `<b>${esc(b.name)}</b> · #${t.rank} · ${b.riskTier}${b.kyc.verified ? "" : ' · <span class="neg">Unverified</span>'}<br/>Default ${prob(b.defaultProb)} · Net ROI ${pct(t.netExpectedROI, 2)} · ${t.matchScore.toFixed(1)} pts`;
        tip.style.opacity = 1; moveTip(e);
      });
      node.addEventListener("mousemove", moveTip);
      node.addEventListener("mouseleave", () => (tip.style.opacity = 0));
      node.addEventListener("click", () => openDrawer(b.id));
      g.appendChild(node);
    });
  }
  function moveTip(e) {
    const r = $("#chartWrap").getBoundingClientRect();
    let left = e.clientX - r.left + 14; if (left > r.width - 240) left -= 260;
    tip.style.left = left + "px"; tip.style.top = e.clientY - r.top - 10 + "px";
  }
  addEventListener("resize", () => { svg.dataset.w = ""; renderChart(); });

  /* ---------- Table ---------- */
  function renderTable() {
    const rows = data.ranked.filter((t) => !state.query || (t.borrower.name + t.borrower.id + t.borrower.purpose).toLowerCase().includes(state.query));
    $("#marketLine").textContent = `${data.ranked.length} listings ranked for ${money(state.capital)} at risk appetite ${state.risk}/10${state.verifiedOnly ? " · verified borrowers only" : ""}. Adjust preferences on the Invest tab.`;
    $("#table tbody").innerHTML = rows.length ? rows.map((t) => {
      const b = t.borrower;
      return `<tr data-id="${b.id}" class="${t.rank <= 5 ? "is-top" : ""}" tabindex="0">
        <td><b>#${t.rank}</b></td>
        <td class="mono">${b.id}</td>
        <td><div class="who"><div class="avatar">${initials(b.name)}</div><div><div class="who-name">${esc(b.name)}</div><div class="who-sub">${esc(b.purpose)}</div></div></div></td>
        <td><div class="badges">${kycBadges(b.kyc)}</div></td>
        <td class="num">${b.creditScore}</td>
        <td><span class="tier ${tierClass(b.riskTier)}">${b.riskTier}</span></td>
        <td class="num">${pct(b.interestRate)}</td>
        <td class="num">${prob(b.defaultProb)}</td>
        <td class="num pos"><b>${pct(t.netExpectedROI, 2)}</b></td>
        <td class="num">${money(b.requestedAmount)}</td>
        <td><div class="fitbar"><div class="bar"><span style="width:${t.matchScore}%"></span></div><b style="width:4ch">${t.matchScore.toFixed(1)}</b></div></td>
      </tr>`;
    }).join("") : `<tr><td colspan="11" class="empty">No listings match “${esc(state.query)}”.</td></tr>`;
    $$("#table tbody tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => openDrawer(tr.dataset.id));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openDrawer(tr.dataset.id); });
    });
  }

  /* ---------- Drawer ---------- */
  const drawer = $("#drawer"), scrim = $("#scrim");
  let lastFocus = null;
  function openDrawer(id) {
    const t = data.ranked.find((x) => x.borrower.id === id);
    if (!t) return;
    const b = t.borrower, s = t.scores;
    const rows = [["Risk fit", s.riskFit, 40, "var(--color-primary)"], ["Return", s.return, 35, "var(--color-gold)"], ["Capital fit", s.capital, 25, "#5b7fa8"]];
    $("#drawerBody").innerHTML = `
      <div class="d-head">
        <div class="avatar">${initials(b.name)}</div>
        <div>
          <h2 id="drawerTitle" class="panel-title">${esc(b.name)} <span class="tier ${tierClass(b.riskTier)}">${b.riskTier}</span></h2>
          <div class="muted" style="font-size:var(--text-sm)">${esc(b.purpose)}</div>
          <div class="muted" style="font-size:var(--text-xs)">${b.id} · Rank #${t.rank} of ${data.ranked.length} for you</div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><b class="pos">${pct(t.netExpectedROI, 2)}</b><span>Net ROI</span></div>
        <div class="stat"><b>${pct(b.interestRate)}</b><span>Interest rate</span></div>
        <div class="stat"><b>${prob(b.defaultProb)}</b><span>Default prob.</span></div>
        <div class="stat"><b>${money(b.requestedAmount)}</b><span>Requested</span></div>
        <div class="stat"><b>${b.creditScore}</b><span>Credit score</span></div>
        <div class="stat"><b>${t.matchScore.toFixed(1)}</b><span>Match score</span></div>
      </div>
      ${t.rank <= 5 ? `<p style="margin-top:var(--space-4)" class="verified-banner">Suggested investment ${money(t.allocation)} → about ${money((t.allocation * t.netExpectedROI) / 100)} per year</p>` : ""}
      <div class="d-section" style="margin-top:var(--space-5)">
        <h3>Identity verification</h3>
        <div class="kyc-rows">
          <div class="kyc-row"><span>Aadhaar <code>${esc(b.kyc.aadhaarMasked)}</code></span>${b.kyc.aadhaar ? '<span class="kyc ok">Verified</span>' : '<span class="kyc no">Not verified</span>'}</div>
          <div class="kyc-row"><span>PAN <code>${esc(b.kyc.panMasked)}</code></span>${b.kyc.pan ? '<span class="kyc ok">Verified</span>' : '<span class="kyc no">Not verified</span>'}</div>
        </div>
        <p class="hint" style="margin-top:var(--space-2)">${b.kyc.verified ? "Aadhaar and PAN both verified." : "Not fully verified. Hidden when “Verified borrowers only” is on."}</p>
      </div>
      <div class="d-section">
        <h3>Why this match score</h3>
        <p class="rationale">${esc(t.rationale)}</p>
        <div class="contrib">${rows.map(([k, v, max, c]) => `
          <div class="contrib-row"><span>${k}</span><div class="bar"><span style="width:${(v / max) * 100}%;background:${c}"></span></div><b>${v.toFixed(1)}/${max}</b></div>`).join("")}
        </div>
        <ul class="why" style="margin-top:var(--space-4)">${details(t).map((x) => `<li class="${x.w ? "w" : ""}">${x.t}</li>`).join("")}</ul>
      </div>`;
    lastFocus = document.activeElement;
    drawer.hidden = false; scrim.hidden = false;
    $("#drawerClose").focus();
  }
  function closeDrawer() { drawer.hidden = true; scrim.hidden = true; lastFocus && lastFocus.focus(); }
  $("#drawerClose").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!drawer.hidden) closeDrawer(); if (!$("#modal").hidden) closeModal(); } });

  /* ---------- Fund modal ---------- */
  const modal = $("#modal");
  function closeModal() { modal.hidden = true; }
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  $("#fundBtn").addEventListener("click", () => {
    const top = data.ranked.slice(0, 5).filter((t) => t.allocation > 0);
    const s = portfolio(top);
    $("#modalBody").innerHTML = `
      <h2 id="modalTitle" class="panel-title">Confirm your investment</h2>
      <p class="muted" style="font-size:var(--text-sm)">${money(s.inv)} split across ${top.length} ${state.verifiedOnly ? "KYC-verified " : ""}borrowers.</p>
      <ul class="modal-list">${top.map((t) => `<li><span>#${t.rank} ${esc(t.borrower.name)} <span class="tier ${tierClass(t.borrower.riskTier)}">${t.borrower.riskTier}</span></span><b class="tabnum">${money(t.allocation)}</b></li>`).join("")}
        <li><span>Portfolio net ROI</span><b class="pos">${pct(s.roi, 2)}</b></li>
        <li><span>Expected yearly earnings</span><b>${money(s.earn)}</b></li></ul>
      <p class="hint">Returns are estimates, not guaranteed. Micro-loans are unsecured and can default.</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mOk">Confirm ${money(s.inv)}</button></div>`;
    modal.hidden = false; $("#mOk").focus();
    $("#mCancel").onclick = closeModal;
    $("#mOk").onclick = async () => {
      $("#mOk").disabled = true;
      await Api.fund(top.map((t) => [t.borrower.id, t.allocation]));
      closeModal(); toast(`Invested ${money(s.inv)}. Requested amounts updated.`);
      prevRanks = null; lastRender = null; update();
    };
  });

  /* ---------- Toast ---------- */
  let tt;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3200); }

  /* ---------- KYC onboarding ---------- */
  const vd = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const vp = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const vinv = [0,4,3,2,1,5,6,7,8,9];
  const verhoeffValid = (num) => { let c = 0; [...num].reverse().forEach((d, i) => { c = vd[c][vp[i % 8][+d]]; }); return c === 0; };
  const verhoeffDigit = (num) => { let c = 0; [...num].reverse().forEach((d, i) => { c = vd[c][vp[(i + 1) % 8][+d]]; }); return vinv[c]; };

  const kyc = { aadhaar: false, pan: false, aadhaarLast4: "", panMasked: "", otp: "" };
  const fA = $("#fAadhaar"), fP = $("#fPan"), fN = $("#fName");
  function setStep(n) {
    $$(".step").forEach((s) => s.classList.toggle("is-active", +s.dataset.step === n));
    $$("#stepper li").forEach((li, i) => { li.classList.toggle("is-current", i + 1 === n); li.classList.toggle("is-done", i + 1 < n); });
    if (n === 3) {
      const b = $("#kycStatusBanner"), full = kyc.aadhaar && kyc.pan;
      b.className = "verified-banner" + (full ? "" : " partial");
      b.textContent = full ? "Aadhaar and PAN verified (simulated). Your listing will be visible to all investors." : "PAN not verified. Your listing will be hidden from investors who only want verified borrowers.";
      renderPreview();
    }
  }
  fA.addEventListener("input", () => {
    const d = fA.value.replace(/\D/g, "").slice(0, 12);
    fA.value = d.replace(/(\d{4})(?=\d)/g, "$1 ");
    $("#aadhaarErr").textContent = ""; fA.classList.remove("invalid", "valid");
    if (d.length === 12) fA.classList.add(verhoeffValid(d) && /^[2-9]/.test(d) ? "valid" : "invalid");
  });
  $("#sampleAadhaar").addEventListener("click", () => {
    let base = String(2 + Math.floor(Math.random() * 8)); for (let i = 0; i < 10; i++) base += Math.floor(Math.random() * 10);
    fA.value = base + verhoeffDigit(base); fA.dispatchEvent(new Event("input"));
    if (!fN.value) fN.value = "Sunita Pawar";
    if (!$("#fBiz").value) $("#fBiz").value = "Pawar Tiffin Service";
  });
  $("#sendOtp").addEventListener("click", () => {
    const d = fA.value.replace(/\D/g, "");
    if (fN.value.trim().length < 3) { $("#aadhaarErr").textContent = "Enter your full name first."; fN.focus(); return; }
    if (d.length !== 12) { $("#aadhaarErr").textContent = "Aadhaar must be exactly 12 digits."; fA.classList.add("invalid"); return; }
    if (!/^[2-9]/.test(d)) { $("#aadhaarErr").textContent = "Aadhaar numbers never start with 0 or 1."; fA.classList.add("invalid"); return; }
    if (!verhoeffValid(d)) { $("#aadhaarErr").textContent = "This isn't a valid Aadhaar number (checksum failed). Please re-check the digits."; fA.classList.add("invalid"); return; }
    kyc.otp = String(100000 + Math.floor(Math.random() * 900000));
    $("#otpRow").hidden = false; $("#verifyOtp").hidden = false; $("#sendOtp").textContent = "Resend OTP"; $("#sendOtp").className = "btn btn-ghost";
    $("#fOtp").focus();
    toast(`Demo SMS: your Aadhaar OTP is ${kyc.otp}`);
  });
  $("#verifyOtp").addEventListener("click", () => {
    if ($("#fOtp").value.trim() !== kyc.otp) { $("#otpErr").textContent = "Incorrect OTP. Check the demo message and try again."; return; }
    kyc.aadhaar = true; kyc.aadhaarLast4 = fA.value.replace(/\D/g, "").slice(-4);
    $("#aadhaarMaskOut").textContent = "XXXX XXXX " + kyc.aadhaarLast4;
    toast("Aadhaar verified (simulated)"); setStep(2); fP.focus();
  });
  fP.addEventListener("input", () => { fP.value = fP.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); $("#panErr").textContent = ""; fP.classList.remove("invalid", "valid"); if (fP.value.length === 10) fP.classList.add(/^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/.test(fP.value) ? "valid" : "invalid"); });
  $("#samplePan").addEventListener("click", () => {
    const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const sur = (fN.value.trim().split(/\s+/).pop() || "X")[0].toUpperCase();
    fP.value = L() + L() + L() + "P" + (/[A-Z]/.test(sur) ? sur : L()) + String(1000 + Math.floor(Math.random() * 9000)) + L();
    fP.dispatchEvent(new Event("input"));
  });
  $("#verifyPan").addEventListener("click", () => {
    const v = fP.value;
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) { $("#panErr").textContent = "PAN must be 5 letters, 4 digits, then 1 letter (e.g. ABCPK1234F)."; fP.classList.add("invalid"); return; }
    if (v[3] !== "P") { $("#panErr").textContent = "The 4th character must be P for an individual borrower."; fP.classList.add("invalid"); return; }
    const sur = (fN.value.trim().split(/\s+/).pop() || "")[0]?.toUpperCase();
    if (sur && v[4] !== sur) { $("#panErr").textContent = `The 5th character should match your surname's initial (${sur}). Name mismatch.`; fP.classList.add("invalid"); return; }
    kyc.pan = true; kyc.panMasked = v.slice(0, 1) + "XXXX" + v.slice(5, 9) + "X";
    toast("PAN verified (simulated)"); setStep(3);
  });
  $("#skipPan").addEventListener("click", () => { kyc.pan = false; setStep(3); });

  const num = (id) => +$(id).value.replace(/[^\d.]/g, "") || 0;
  function draft() {
    const score = clamp(num("#fScore") || 650, 300, 850);
    const pd = Math.round(clamp(0.155 - (score - 580) * 0.0007, 0.01, 0.3) * 1000) / 1000;
    const rate = clamp(num("#fRate") || 12, 5, 36);
    return { score, pd, rate, amount: clamp(num("#fAmount") || 1000, 100, 10000), net: Math.max(0, rate - pd * 75) };
  }
  function renderPreview() {
    const d = draft();
    const t = d.pd <= 0.04 ? "Low Risk" : d.pd <= 0.09 ? "Moderate Risk" : "High Risk";
    $("#loanPreview").innerHTML = `<div><span>Risk tier</span><b><span class="tier ${tierClass(t)}">${t}</span></b></div><div><span>Est. default prob.</span><b>${prob(d.pd)}</b></div><div><span>Investor net ROI</span><b>${pct(d.net, 2)}</b></div><div><span>Amount</span><b>${money(d.amount)}</b></div>`;
  }
  $$("#view-kyc .step[data-step='3'] input").forEach((el) => el.addEventListener("input", renderPreview));
  $("#kycForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!kyc.aadhaar) { setStep(1); return; }
    const d = draft();
    const name = ($("#fBiz").value.trim() || fN.value.trim() || "New Borrower").slice(0, 60);
    const b = await Api.addBorrower({
      name, purpose: $("#fPurpose").value.trim() || "Small business",
      requestedAmount: d.amount, interestRate: d.rate, creditScore: d.score,
      aadhaarVerified: String(kyc.aadhaar), panVerified: String(kyc.pan),
      aadhaarMasked: "XXXX XXXX " + kyc.aadhaarLast4, panMasked: kyc.panMasked || "Not provided",
    });
    const verified = b.kyc.verified;
    Object.assign(kyc, { aadhaar: false, pan: false, aadhaarLast4: "", panMasked: "", otp: "" });
    $("#kycForm").reset(); $("#otpRow").hidden = true; $("#verifyOtp").hidden = true; $("#sendOtp").textContent = "Send OTP"; $("#sendOtp").className = "btn btn-primary";
    fA.classList.remove("valid", "invalid"); fP.classList.remove("valid", "invalid");
    setStep(1);
    if (!verified && state.verifiedOnly) { state.verifiedOnly = false; $("#verifiedOnly").checked = false; }
    await update();
    go("market");
    toast(verified ? `Listing ${b.id} published and ranked by the matchmaker.` : `Listing ${b.id} published. Hidden from verified-only investors until PAN is verified.`);
    setTimeout(() => openDrawer(b.id), 350);
  });

  /* ---------- Init ---------- */
  syncControls();
  Api.health().then(update);
})();
