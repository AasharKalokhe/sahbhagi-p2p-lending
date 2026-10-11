(function () {
  const E = window.Engine;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const inr = new Intl.NumberFormat("en-IN");
  const rs = (x) => "₹" + inr.format(Math.round(x));
  const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let listings = window.BORROWERS.map(E.enrich);
  const state = { amount: 50000, risk: 5, tenureMax: 99, verifiedOnly: true, query: "" };
  let prevRanks = null;   // baseline ranks (before current interaction) for ▲▼ badges
  let lastRender = null;  // ranks from the previous frame, used for the flash effect
  let baselineTimer = 0;
  let current = { ranked: [], top: [], alloc: [], P: null };

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
    if (view === "how") renderWeights();
  }
  $$("[data-nav]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.dataset.nav); }));

  /* ---------- Controls ---------- */
  const amountInput = $("#amountInput"), amountRange = $("#amountRange"), riskRange = $("#riskRange");
  const riskLabel = (r) => (r <= 3 ? "Conservative" : r <= 7 ? "Balanced" : "Aggressive");
  function setFill(el) { el.style.setProperty("--fill", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"); }
  function syncControls() {
    amountRange.value = clamp(state.amount, 5000, 500000);
    setFill(amountRange);
    if (document.activeElement !== amountInput) amountInput.value = inr.format(state.amount);
    riskRange.value = state.risk;
    $("#riskOut").textContent = state.risk + " · " + riskLabel(state.risk);
    $("#tolOut").textContent = pct(E.prefs(state.risk).pdMax, 0);
    $$("[data-amt]").forEach((c) => c.classList.toggle("is-on", +c.dataset.amt === state.amount));
    $$("[data-risk]").forEach((c) => c.classList.toggle("is-on", +c.dataset.risk === state.risk));
  }
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { syncControls(); update(); }); };
  amountRange.addEventListener("input", () => { state.amount = +amountRange.value; schedule(); });
  amountInput.addEventListener("input", () => {
    const digits = amountInput.value.replace(/\D/g, "").slice(0, 7);
    const v = +digits || 0;
    amountInput.value = digits ? inr.format(v) : "";
    if (v >= 5000) { state.amount = Math.min(v, 500000); schedule(); }
  });
  amountInput.addEventListener("blur", () => { state.amount = clamp(+amountInput.value.replace(/\D/g, "") || 5000, 5000, 500000); amountInput.value = inr.format(state.amount); schedule(); });
  amountInput.addEventListener("keydown", (e) => { if (e.key === "Enter") amountInput.blur(); });
  riskRange.addEventListener("input", () => { state.risk = +riskRange.value; schedule(); });
  $$("[data-amt]").forEach((c) => c.addEventListener("click", () => { state.amount = +c.dataset.amt; schedule(); }));
  $$("[data-risk]").forEach((c) => c.addEventListener("click", () => { state.risk = +c.dataset.risk; schedule(); }));
  $("#tenureSel").addEventListener("change", (e) => { state.tenureMax = +e.target.value; schedule(); });
  $("#verifiedOnly").addEventListener("change", (e) => { state.verifiedOnly = e.target.checked; schedule(); toast(state.verifiedOnly ? "Showing only Aadhaar + PAN verified borrowers" : "Showing all borrowers, including unverified"); });
  $("#search").addEventListener("input", (e) => { state.query = e.target.value.toLowerCase(); renderTable(); });

  /* ---------- Core update ---------- */
  function pool() {
    return listings.filter((l) => l.remaining > 0 && l.tenure <= state.tenureMax && (!state.verifiedOnly || l.verified));
  }
  function update() {
    const p = pool();
    const { ranked, P } = E.rank(p, state);
    const top = ranked.slice(0, 5);
    const { alloc, unallocated } = E.allocate(top, state.amount);
    current = { ranked, top, alloc, unallocated, P };
    renderKpis(); renderTop(); renderChart(); renderTable(); renderKycNote();
    const snap = new Map(top.map((t) => [t.id, t.rank]));
    lastRender = snap;
    if (!prevRanks) prevRanks = snap;
    clearTimeout(baselineTimer);
    baselineTimer = setTimeout(() => { prevRanks = snap; }, 1500);
  }

  function renderKycNote() {
    const open = listings.filter((l) => l.remaining > 0 && l.tenure <= state.tenureMax);
    const unv = open.filter((l) => !l.verified).length;
    $("#kycNote").innerHTML = state.verifiedOnly
      ? `<b>${open.length - unv}</b> verified listings shown · ${unv} unverified hidden`
      : `Showing all <b>${open.length}</b> listings · ${unv} not fully verified (marked in red)`;
  }

  function portfolioStats() {
    const { top, alloc } = current;
    const inv = alloc.reduce((s, x) => s + x, 0);
    if (!inv) return { inv: 0, roi: 0, earn: 0, pd: 0, life: 0 };
    let roi = 0, earn = 0, pd = 0, life = 0;
    top.forEach((t, i) => { const w = alloc[i] / inv; roi += w * t.expAnnual; pd += w * t.pd; life += w * t.avgLife; earn += alloc[i] * t.expTerm; });
    return { inv, roi, earn, pd, life };
  }

  function renderKpis() {
    const s = portfolioStats();
    const { top, unallocated } = current;
    const minGrade = top.length ? top.map((t) => t.grade).sort().pop() : "–";
    const verifiedCount = top.filter((t) => t.verified).length;
    $("#kpis").innerHTML = `
      <div class="card kpi"><div class="kpi-label">Expected portfolio ROI</div><div class="kpi-value ${s.roi >= 0 ? "pos" : "neg"}">${pct(s.roi)}<span class="kpi-sub"> p.a.</span></div><div class="kpi-sub">after fees &amp; expected defaults</div></div>
      <div class="card kpi"><div class="kpi-label">Expected earnings</div><div class="kpi-value">${rs(s.earn)}</div><div class="kpi-sub">on ${rs(s.inv)} over ~${(s.life * 12).toFixed(0)} months avg.</div></div>
      <div class="card kpi"><div class="kpi-label">Avg. default risk</div><div class="kpi-value ${s.pd > current.P.pdMax ? "warn" : ""}">${pct(s.pd)}</div><div class="kpi-sub">your limit ${pct(current.P.pdMax, 0)} · riskiest grade ${minGrade}</div></div>
      <div class="card kpi"><div class="kpi-label">KYC verified</div><div class="kpi-value">${verifiedCount}/${top.length || 0}</div><div class="kpi-sub">${unallocated > 0 ? `<span class="warn">${rs(unallocated)} unallocated</span>` : "Aadhaar + PAN checked"}</div></div>`;
    $("#summaryLine").textContent = `Ranked ${current.ranked.length} open listings for ${rs(state.amount)} at ${riskLabel(state.risk).toLowerCase()} risk (${state.risk}/10).`;
    $("#fundBtn").disabled = !s.inv;
  }

  function reasons(t) {
    const P = current.P, out = [];
    const slot = state.amount / 5;
    const better = current.ranked.filter((x) => x.expAnnual < t.expAnnual).length / Math.max(1, current.ranked.length - 1);
    if (t.pd <= P.pdMax * 0.5) out.push({ t: `Low default risk (${pct(t.pd)}), well within your ${pct(P.pdMax, 0)} limit` });
    else if (t.pd <= P.pdMax) out.push({ t: `Default risk ${pct(t.pd)} is within your ${pct(P.pdMax, 0)} limit` });
    else out.push({ t: `Default risk ${pct(t.pd)} is above your ${pct(P.pdMax, 0)} limit`, w: 1 });
    if (better >= 0.6) out.push({ t: `Expected return ${pct(t.expAnnual)} p.a. beats ${Math.round(better * 100)}% of listings` });
    else out.push({ t: `Expected return ${pct(t.expAnnual)} p.a. at ${t.rate}% interest` });
    if (t.creditScore >= 750 && t.onTime >= 0.95) out.push({ t: `Strong profile: CIBIL ${t.creditScore}, ${Math.round(t.onTime * 100)}% on-time repayments` });
    else if (t.dti <= 0.25) out.push({ t: `Low debt burden: EMIs are ${Math.round(t.dti * 100)}% of income` });
    else if (t.remaining >= slot) out.push({ t: `Can take your full ${rs(slot)} share` });
    else out.push({ t: `Only ${rs(t.remaining)} still needed, so your share is smaller`, w: 1 });
    if (!t.verified) out.push({ t: "KYC incomplete, which adds identity risk", w: 1 });
    return out.slice(0, 3);
  }

  function kycBadges(l) {
    const tick = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg>';
    const cross = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    return `<span class="kyc ${l.kyc.aadhaar ? "ok" : "no"}" title="Aadhaar ${l.kyc.aadhaar ? "verified" : "not verified"}">${l.kyc.aadhaar ? tick : cross} Aadhaar</span><span class="kyc ${l.kyc.pan ? "ok" : "no"}" title="PAN ${l.kyc.pan ? "verified" : "not verified"}">${l.kyc.pan ? tick : cross} PAN</span>`;
  }

  function factorBar(t) {
    const p = t.parts, tot = Math.max(0.0001, p.Return + p.Safety + p.Capacity + p.Trust);
    const w = (x) => ((x / tot) * t.fit * 100).toFixed(1) + "%";
    return `<div class="factors" aria-hidden="true"><span class="f-saf" style="width:${w(p.Safety)}"></span><span class="f-ret" style="width:${w(p.Return)}"></span><span class="f-cap" style="width:${w(p.Capacity)}"></span><span class="f-tru" style="width:${w(p.Trust)}"></span></div>`;
  }

  function renderTop() {
    const { top, alloc } = current;
    const box = $("#top5");
    if (!top.length) {
      box.innerHTML = `<div class="card empty"><b>No listings match these filters.</b><br/>Try allowing longer tenures or turning off the verified-only filter.</div>`;
      return;
    }
    box.innerHTML = top.map((t, i) => {
      let mv = "";
      if (prevRanks) {
        const was = prevRanks.get(t.id);
        if (was === undefined) mv = `<span class="move new">NEW</span>`;
        else if (was > t.rank) mv = `<span class="move up">▲${was - t.rank}</span>`;
        else if (was < t.rank) mv = `<span class="move down">▼${t.rank - was}</span>`;
      }
      const changed = lastRender && lastRender.get(t.id) !== t.rank;
      return `<article class="card rec${changed ? " flash" : ""}" data-id="${t.id}" tabindex="0" aria-label="Rank ${t.rank}: ${esc(t.name)}">
        ${mv}
        <div class="rank-badge">${t.rank}</div>
        <div class="who">
          <div class="avatar">${t.initials}</div>
          <div style="min-width:0">
            <div class="who-name">${esc(t.name)} <span class="grade g-${t.grade}" title="Risk grade">${t.grade}</span></div>
            <div class="who-sub">${esc(t.purpose)} · ${esc(t.city)} · ${t.tenure} mo</div>
            <div class="badges">${kycBadges(t)}</div>
          </div>
        </div>
        <div class="why-col">
          <ul class="why">${reasons(t).map((r) => `<li class="${r.w ? "w" : ""}">${r.t}</li>`).join("")}</ul>
          ${factorBar(t)}
        </div>
        <div class="nums">
          <div class="roi ${t.expAnnual >= 0 ? "pos" : "neg"}">${pct(t.expAnnual)} <small>ROI p.a.</small></div>
          <div class="alloc">Invest ${rs(alloc[i])}</div>
          <small>Earn ~${rs(alloc[i] * t.expTerm)} · Fit ${Math.round(t.fit * 100)}</small>
        </div>
      </article>`;
    }).join("") + `<div class="factor-legend" aria-label="Fit score breakdown legend"><span><i class="f-saf"></i>Safety</span><span><i class="f-ret"></i>Return</span><span><i class="f-cap"></i>Capacity</span><span><i class="f-tru"></i>Trust</span><span>Bar length = fit score</span></div>`;
    $$(".rec", box).forEach((el) => {
      el.addEventListener("click", () => openDrawer(el.dataset.id));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(el.dataset.id); } });
    });
  }

  /* ---------- Chart (hand-built SVG) ---------- */
  const svg = $("#chart"), tip = $("#tooltip");
  const NS = "http://www.w3.org/2000/svg";
  function renderChart() {
    const W = svg.clientWidth || 800, H = svg.clientHeight || 340;
    const m = { l: 48, r: 16, t: 14, b: 36 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const all = listings.filter((l) => l.remaining > 0 && l.tenure <= state.tenureMax);
    const xMax = 0.4, yMin = -0.1, yMax = 0.3;
    const x = (v) => m.l + (clamp(v, 0, xMax) / xMax) * (W - m.l - m.r);
    const y = (v) => H - m.b - ((clamp(v, yMin, yMax) - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    let g = svg.querySelector(".static");
    if (!g || svg.dataset.w != W) {
      svg.innerHTML = "";
      svg.dataset.w = W;
      g = document.createElementNS(NS, "g"); g.setAttribute("class", "static"); svg.appendChild(g);
      let h = `<rect class="zone" x="${m.l}" y="${m.t}" height="${H - m.t - m.b}" width="0"/>`;
      h += `<g class="grid">`;
      for (let v = 0; v <= xMax + 1e-9; v += 0.1) h += `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H - m.b}"/>`;
      for (let v = yMin; v <= yMax + 1e-9; v += 0.1) h += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      h += `</g><g class="axis">`;
      for (let v = 0; v <= xMax + 1e-9; v += 0.1) h += `<text x="${x(v)}" y="${H - m.b + 16}" text-anchor="middle">${Math.round(v * 100)}%</text>`;
      for (let v = yMin; v <= yMax + 1e-9; v += 0.1) h += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`;
      h += `<text x="${(W + m.l) / 2}" y="${H - 4}" text-anchor="middle">Probability of default →</text>`;
      h += `<text transform="translate(12 ${(H - m.b + m.t) / 2}) rotate(-90)" text-anchor="middle">Expected ROI p.a. →</text></g>`;
      h += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--color-text-faint)" stroke-dasharray="3 3"/>`;
      g.innerHTML = h;
      const pts = document.createElementNS(NS, "g"); pts.setAttribute("class", "pts"); svg.appendChild(pts);
    }
    svg.querySelector(".zone").setAttribute("width", x(current.P.pdMax) - m.l);
    const ptsG = svg.querySelector(".pts");
    const topIdx = new Map(current.top.map((t, i) => [t.id, i + 1]));
    const shown = new Set(current.ranked.map((r) => r.id));
    const seen = new Set();
    all.forEach((l) => {
      seen.add(l.id);
      let node = ptsG.querySelector(`[data-id="${l.id}"]`);
      if (!node) {
        node = document.createElementNS(NS, "g"); node.dataset.id = l.id; node.setAttribute("class", "pt-g");
        node.innerHTML = `<circle class="pt"/><text text-anchor="middle" font-size="11" font-weight="800" fill="var(--color-text-inverse)" pointer-events="none"></text>`;
        node.addEventListener("mouseenter", (e) => showTip(e, l.id));
        node.addEventListener("mousemove", (e) => moveTip(e));
        node.addEventListener("mouseleave", () => (tip.style.opacity = 0));
        node.addEventListener("click", () => openDrawer(l.id));
        ptsG.appendChild(node);
      }
      const c = node.querySelector("circle"), tx = node.querySelector("text");
      const r = topIdx.get(l.id), vis = shown.has(l.id);
      c.setAttribute("cx", x(l.pd)); c.setAttribute("cy", y(l.expAnnual));
      c.setAttribute("r", r ? 10 : 5);
      c.setAttribute("fill", r ? "var(--color-primary)" : l.verified ? "var(--color-text-faint)" : "transparent");
      c.setAttribute("stroke", r ? "var(--color-surface)" : l.verified ? "none" : "var(--color-error)");
      c.setAttribute("stroke-width", r ? 2 : 1.6);
      node.style.opacity = vis ? 1 : 0.15;
      tx.setAttribute("x", x(l.pd)); tx.setAttribute("y", y(l.expAnnual) + 4); tx.textContent = r || "";
      if (r) ptsG.appendChild(node); // keep top 5 on top
    });
    $$(".pt-g", ptsG).forEach((n) => { if (!seen.has(n.dataset.id)) n.remove(); });
  }
  function showTip(e, id) {
    const l = listings.find((x) => x.id === id);
    tip.innerHTML = `<b>${esc(l.name)}</b> · Grade ${l.grade}${l.verified ? "" : ' · <span class="neg">Unverified</span>'}<br/>Default risk ${pct(l.pd)} · ROI ${pct(l.expAnnual)} p.a.`;
    tip.style.opacity = 1; moveTip(e);
  }
  function moveTip(e) {
    const r = $("#chartWrap").getBoundingClientRect();
    let left = e.clientX - r.left + 14; if (left > r.width - 200) left -= 220;
    tip.style.left = left + "px"; tip.style.top = e.clientY - r.top - 10 + "px";
  }
  addEventListener("resize", () => { svg.dataset.w = ""; renderChart(); });

  /* ---------- Table ---------- */
  function renderTable() {
    const topIds = new Set(current.top.map((t) => t.id));
    const rows = current.ranked.filter((l) => !state.query || (l.name + l.city + l.purpose).toLowerCase().includes(state.query));
    $("#marketLine").textContent = `${current.ranked.length} listings ranked for ${rs(state.amount)} at risk appetite ${state.risk}/10${state.verifiedOnly ? " · verified borrowers only" : ""}. Adjust preferences on the Invest tab.`;
    $("#table tbody").innerHTML = rows.length ? rows.map((l) => `
      <tr data-id="${l.id}" class="${topIds.has(l.id) ? "is-top" : ""}" tabindex="0">
        <td><b>#${l.rank}</b></td>
        <td><div class="who"><div class="avatar">${l.initials}</div><div><div class="who-name">${esc(l.name)}</div><div class="who-sub">${esc(l.purpose)} · ${esc(l.city)}</div></div></div></td>
        <td><div class="badges">${kycBadges(l)}</div></td>
        <td><span class="grade g-${l.grade}">${l.grade}</span></td>
        <td class="num">${l.rate.toFixed(1)}%</td>
        <td class="num ${l.pd > current.P.pdMax ? "warn" : ""}">${pct(l.pd)}</td>
        <td class="num ${l.expAnnual >= 0 ? "pos" : "neg"}"><b>${pct(l.expAnnual)}</b></td>
        <td class="num">${rs(l.remaining)}</td>
        <td><div class="fitbar"><div class="bar"><span style="width:${l.fit * 100}%"></span></div><b>${Math.round(l.fit * 100)}</b></div></td>
      </tr>`).join("") : `<tr><td colspan="9" class="empty">No listings match “${esc(state.query)}”.</td></tr>`;
    $$("#table tbody tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => openDrawer(tr.dataset.id));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openDrawer(tr.dataset.id); });
    });
  }

  /* ---------- Drawer ---------- */
  const drawer = $("#drawer"), scrim = $("#scrim");
  let lastFocus = null;
  function openDrawer(id) {
    const r = current.ranked.find((x) => x.id === id);
    const l = r || E.rank([...pool(), listings.find((x) => x.id === id)].filter((v, i, a) => a.indexOf(v) === i), state).ranked.find((x) => x.id === id);
    const ti = current.top.findIndex((t) => t.id === id);
    const p = l.parts;
    const contrib = [["Safety", p.Safety, "var(--color-primary)"], ["Return", p.Return, "var(--color-gold)"], ["Capacity", p.Capacity, "#5b7fa8"], ["Trust", p.Trust, "#8a6bb0"], ["Over-limit", p.Penalty, "var(--color-error)"]];
    $("#drawerBody").innerHTML = `
      <div class="d-head">
        <div class="avatar">${l.initials}</div>
        <div>
          <h2 id="drawerTitle" class="panel-title">${esc(l.name)} <span class="grade g-${l.grade}">${l.grade}</span></h2>
          <div class="muted" style="font-size:var(--text-sm)">${esc(l.purpose)} · ${esc(l.city)} · ${esc(l.employment)}</div>
          <div class="muted" style="font-size:var(--text-xs)">${l.id} · ${r ? `Rank #${l.rank} of ${current.ranked.length} for you` : "Hidden by your current filters"}</div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><b class="${l.expAnnual >= 0 ? "pos" : "neg"}">${pct(l.expAnnual)}</b><span>Est. ROI p.a.</span></div>
        <div class="stat"><b>${l.rate.toFixed(1)}%</b><span>Interest rate</span></div>
        <div class="stat"><b class="${l.pd > current.P.pdMax ? "warn" : ""}">${pct(l.pd)}</b><span>Default risk</span></div>
        <div class="stat"><b>${rs(l.amount)}</b><span>Loan size</span></div>
        <div class="stat"><b>${l.tenure} mo</b><span>Tenure</span></div>
        <div class="stat"><b>${Math.round(l.fit * 100)}/100</b><span>Fit for you</span></div>
      </div>
      <div style="margin-top:var(--space-4);font-size:var(--text-sm)">${rs(l.funded)} funded · <b>${rs(l.remaining)}</b> still needed
        <div class="funded"><span style="width:${(l.funded / l.amount) * 100}%"></span></div></div>
      ${ti >= 0 ? `<p style="margin-top:var(--space-4)" class="verified-banner">Suggested investment ${rs(current.alloc[ti])} → expected earnings ~${rs(current.alloc[ti] * l.expTerm)}</p>` : ""}

      <div class="d-section" style="margin-top:var(--space-5)">
        <h3>Identity verification</h3>
        <div class="kyc-rows">
          <div class="kyc-row"><span>Aadhaar <code>${l.kyc.aadhaarMasked}</code></span>${l.kyc.aadhaar ? '<span class="kyc ok">Verified</span>' : '<span class="kyc no">Not verified</span>'}</div>
          <div class="kyc-row"><span>PAN <code>${l.kyc.panMasked}</code></span>${l.kyc.pan ? '<span class="kyc ok">Verified</span>' : '<span class="kyc no">Not verified</span>'}</div>
        </div>
        <p class="hint" style="margin-top:var(--space-2)">${l.verified ? `Full KYC completed on ${l.kyc.verifiedOn}.` : "This borrower has not completed full KYC. A default-risk premium is applied and they are hidden when “Verified borrowers only” is on."}</p>
      </div>

      <div class="d-section">
        <h3>Why this fit score</h3>
        <div class="contrib">${contrib.filter(([k, v]) => k !== "Over-limit" || v < 0).map(([k, v, c]) => `
          <div class="contrib-row"><span>${k}</span><div class="bar"><span style="width:${Math.abs(v) * 100 / 0.6}%;background:${c}"></span></div><b class="${v < 0 ? "neg" : ""}">${v < 0 ? "−" : "+"}${Math.abs(v * 100).toFixed(0)}</b></div>`).join("")}
        </div>
        <ul class="why" style="margin-top:var(--space-4)">${reasons(l).map((x) => `<li class="${x.w ? "w" : ""}">${x.t}</li>`).join("")}</ul>
      </div>

      <div class="d-section">
        <h3>Credit profile</h3>
        <div class="stats">
          <div class="stat"><b>${l.creditScore}</b><span>CIBIL score</span></div>
          <div class="stat"><b>${Math.round(l.dti * 100)}%</b><span>Debt-to-income</span></div>
          <div class="stat"><b>${Math.round(l.onTime * 100)}%</b><span>On-time EMIs</span></div>
          <div class="stat"><b>${l.priorLoans}</b><span>Past loans</span></div>
          <div class="stat"><b>${l.vintage} yrs</b><span>Work vintage</span></div>
          <div class="stat"><b>${rs(l.income)}</b><span>Monthly income</span></div>
        </div>
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
    const s = portfolioStats();
    $("#modalBody").innerHTML = `
      <h2 id="modalTitle" class="panel-title">Confirm your investment</h2>
      <p class="muted" style="font-size:var(--text-sm)">${rs(s.inv)} split across ${current.top.length} ${state.verifiedOnly ? "KYC-verified " : ""}borrowers.</p>
      <ul class="modal-list">${current.top.map((t, i) => `<li><span>#${t.rank} ${esc(t.name)} <span class="grade g-${t.grade}">${t.grade}</span></span><b class="tabnum">${rs(current.alloc[i])}</b></li>`).join("")}
        <li><span>Expected ROI</span><b class="pos">${pct(s.roi)} p.a.</b></li>
        <li><span>Expected earnings</span><b>${rs(s.earn)}</b></li></ul>
      <p class="hint">Returns are estimates, not guaranteed. P2P loans are unsecured and can default.</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mOk">Confirm ${rs(s.inv)}</button></div>`;
    modal.hidden = false; $("#mOk").focus();
    $("#mCancel").onclick = closeModal;
    $("#mOk").onclick = () => {
      current.top.forEach((t, i) => { const l = listings.find((x) => x.id === t.id); l.funded += current.alloc[i]; l.remaining = Math.max(0, l.amount - l.funded); });
      closeModal(); toast(`Invested ${rs(s.inv)}. Listings updated with your funding.`); prevRanks = null; lastRender = null; update();
    };
  });

  /* ---------- Toast ---------- */
  let tt;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3200); }

  /* ---------- How-it-works weights ---------- */
  function renderWeights() {
    const rows = [[1, "Appetite 1"], [5, "Appetite 5"], [10, "Appetite 10"], [state.risk, `You (${state.risk})`]];
    $("#weightsViz").innerHTML = rows.map(([r, label]) => {
      const P = E.prefs(r), tot = P.wSafety + P.wReturn + P.wCapacity + P.wTrust;
      const seg = (v, c, n) => `<span style="width:${(v / tot) * 100}%;background:${c}" title="${n}">${Math.round((v / tot) * 100)}%</span>`;
      return `<div class="weights-row"><b>${label}</b><div class="wbar">${seg(P.wSafety, "var(--color-primary)", "Safety")}${seg(P.wReturn, "var(--color-gold)", "Return")}${seg(P.wCapacity, "#5b7fa8", "Capacity")}${seg(P.wTrust, "#8a6bb0", "Trust")}</div></div>`;
    }).join("") + `<div class="factor-legend"><span><i class="f-saf"></i>Safety</span><span><i class="f-ret"></i>Return</span><span><i class="f-cap"></i>Capacity</span><span><i class="f-tru"></i>Trust</span></div>`;
  }

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
      const b = $("#kycStatusBanner");
      const full = kyc.aadhaar && kyc.pan;
      b.className = "verified-banner" + (full ? "" : " partial");
      b.textContent = full ? `Aadhaar and PAN verified. Your listing will be visible to all investors.` : `PAN not verified. Your listing will be hidden from investors who only want verified borrowers.`;
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

  function draftListing() {
    const num = (id) => +$(id).value.replace(/[^\d.]/g, "") || 0;
    const name = fN.value.trim() || "New Borrower";
    const parts = name.split(/\s+/);
    const income = Math.max(1000, num("#fIncome"));
    return {
      id: "BR-" + (2001 + listings.length), name, initials: (parts[0][0] + (parts[1] || " ")[0]).toUpperCase().trim(),
      city: $("#fCity").value.trim() || "Pune", purpose: $("#fPurpose").value.trim() || "Small business", category: "Small business",
      employment: "Self-employed", creditScore: clamp(num("#fScore"), 300, 900), dti: +clamp(num("#fEmi") / income, 0, 0.9).toFixed(2),
      onTime: 0.95, priorLoans: 1, vintage: clamp(num("#fVintage"), 0, 40), tenure: +$("#fTenure").value,
      amount: clamp(Math.round(num("#fAmount") / 1000) * 1000, 5000, 500000), funded: 0, income,
      kyc: { aadhaar: kyc.aadhaar, pan: kyc.pan, aadhaarMasked: "XXXX XXXX " + kyc.aadhaarLast4, panMasked: kyc.panMasked || "Not provided", verifiedOn: kyc.aadhaar && kyc.pan ? new Date().toISOString().slice(0, 10) : null },
      rateNoise: 0
    };
  }
  function renderPreview() {
    const l = E.enrich(draftListing());
    $("#loanPreview").innerHTML = `<div><span>Risk grade</span><b><span class="grade g-${l.grade}">${l.grade}</span></b></div><div><span>Default risk</span><b>${pct(l.pd)}</b></div><div><span>Your interest rate</span><b>${l.rate}% p.a.</b></div><div><span>Monthly EMI</span><b>${rs(emi(l.amount, l.rate, l.tenure))}</b></div>`;
  }
  const emi = (P, r, n) => { const i = r / 1200; return (P * i) / (1 - Math.pow(1 + i, -n)); };
  $$("#view-kyc .step[data-step='3'] input, #view-kyc .step[data-step='3'] select").forEach((el) => el.addEventListener("input", renderPreview));
  $("#kycForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!kyc.aadhaar) { setStep(1); return; }
    const l = E.enrich(draftListing());
    listings.unshift(l);
    update();
    toast(l.verified ? `Listing ${l.id} published. Visible to investors now.` : `Listing ${l.id} published. Hidden from verified-only investors until PAN is verified.`);
    // reset
    Object.assign(kyc, { aadhaar: false, pan: false, aadhaarLast4: "", panMasked: "", otp: "" });
    $("#kycForm").reset(); $("#otpRow").hidden = true; $("#verifyOtp").hidden = true; $("#sendOtp").textContent = "Send OTP"; $("#sendOtp").className = "btn btn-primary";
    fA.classList.remove("valid", "invalid"); fP.classList.remove("valid", "invalid");
    setStep(1); go("market");
    setTimeout(() => openDrawer(l.id), 350);
  });

  /* ---------- Init ---------- */
  syncControls();
  update();
})();
