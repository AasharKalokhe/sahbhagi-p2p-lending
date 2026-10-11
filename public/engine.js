// API client for the Java matchmaker backend, with a faithful JS mirror of the
// same algorithm as an offline fallback.
(function () {
  const RAW = "__PORT_5000__";
  const BASE = RAW.startsWith("__PORT") ? "http://localhost:5000" : RAW;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const tier = (pd) => (pd <= 0.04 ? "Low Risk" : pd <= 0.09 ? "Moderate Risk" : "High Risk");

  // --- Mirror of MatchmakerServer.evaluate / rank / allocate ---
  function evaluate(b, risk, capital) {
    const expectedLoss = b.defaultProb * 0.75 * 100;
    const netROI = Math.max(0, b.interestRate - expectedLoss);
    const riskIndex = b.defaultProb * 50;
    const riskFit = Math.max(0, 40 - Math.abs(risk - riskIndex) * 5);
    const ret = Math.min(35, netROI * 2 * (0.6 + 0.4 * (risk / 10)));
    const capDiff = Math.abs(b.requestedAmount - capital) / Math.max(b.requestedAmount, capital);
    const cap = Math.max(0, 25 * (1 - Math.min(1, capDiff)));
    let rationale;
    if (risk <= 3) rationale = b.creditScore >= 720 ? "High solvency aligns with conservative target" : "Acceptable safety margin; low volatility";
    else if (risk >= 8) rationale = netROI > 12 ? "High yield compensates for default profile" : "Solid upside matching aggressive growth goal";
    else rationale = "Balanced blend of steady yield and risk tolerance";
    return { borrower: { ...b, riskTier: tier(b.defaultProb) }, netExpectedROI: netROI, matchScore: riskFit + ret + cap, scores: { riskFit, return: ret, capital: cap }, rationale };
  }
  function allocate(top, capital) {
    const alloc = top.map(() => 0);
    let left = capital;
    for (let pass = 0; pass < 6 && left > 0.5; pass++) {
      let w = 0;
      top.forEach((t, i) => { if (alloc[i] < t.borrower.requestedAmount) w += t.matchScore; });
      if (w <= 0) break;
      let used = 0;
      top.forEach((t, i) => {
        const room = t.borrower.requestedAmount - alloc[i];
        if (room <= 0) return;
        const give = Math.min(room, (left * t.matchScore) / w);
        alloc[i] += give; used += give;
      });
      left -= used;
      if (used < 0.5) break;
    }
    const out = alloc.map(Math.floor);
    let rem = capital - out.reduce((s, x) => s + x, 0);
    for (let i = 0; i < out.length && rem >= 1; i++) {
      const give = Math.min(rem, Math.floor(top[i].borrower.requestedAmount - out[i]));
      if (give > 0) { out[i] += give; rem -= give; }
    }
    return out;
  }
  const local = {
    borrowers: window.SAMPLE_BORROWERS.map((b) => ({ ...b, kyc: { ...b.kyc } })),
    nextId: 111,
    match({ risk, capital, verifiedOnly }) {
      const ranked = this.borrowers
        .filter((b) => b.requestedAmount > 0 && (!verifiedOnly || b.kyc.verified))
        .map((b) => evaluate(b, risk, capital))
        .sort((x, y) => y.matchScore - x.matchScore);
      const alloc = allocate(ranked.slice(0, 5), capital);
      ranked.forEach((r, i) => { r.rank = i + 1; r.allocation = alloc[i] || 0; });
      return { risk, capital, verifiedOnly, unverifiedOpen: this.borrowers.filter((b) => b.requestedAmount > 0 && !b.kyc.verified).length, ranked };
    },
    add(f) {
      const score = clamp(+f.creditScore || 650, 300, 850);
      const pd = Math.round(clamp(0.155 - (score - 580) * 0.0007, 0.01, 0.3) * 1000) / 1000;
      const b = { id: "B" + this.nextId++, name: f.name, purpose: f.purpose || "Small business", requestedAmount: clamp(+f.requestedAmount || 1000, 100, 10000), interestRate: clamp(+f.interestRate || 12, 5, 36), creditScore: score, defaultProb: pd,
        kyc: { aadhaar: f.aadhaarVerified === "true", pan: f.panVerified === "true", aadhaarMasked: f.aadhaarMasked, panMasked: f.panMasked } };
      b.kyc.verified = b.kyc.aadhaar && b.kyc.pan;
      this.borrowers.unshift(b);
      return { ...b, riskTier: tier(pd) };
    },
    fund(pairs) { pairs.forEach(([id, amt]) => { const b = this.borrowers.find((x) => x.id === id); if (b) b.requestedAmount = Math.max(0, b.requestedAmount - amt); }); },
  };

  let mode = "java"; // "java" | "local"
  async function call(path, opts = {}, signal) {
    const r = await fetch(BASE + path, { ...opts, signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  const form = (o) => new URLSearchParams(o).toString();

  window.Api = {
    get mode() { return mode; },
    async health() {
      try { const h = await call("/api/health"); mode = h.engine === "java" ? "java" : "local"; } catch { mode = "local"; }
      return mode;
    },
    async match(p, signal) {
      if (mode === "java") {
        try { return await call(`/api/match?risk=${p.risk}&capital=${p.capital}&verifiedOnly=${p.verifiedOnly}`, {}, signal); }
        catch (e) { if (e.name === "AbortError") throw e; mode = "local"; }
      }
      return local.match(p);
    },
    async addBorrower(f) {
      if (mode === "java") {
        try { return await call("/api/borrowers", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(f) }); }
        catch { mode = "local"; }
      }
      return local.add(f);
    },
    async fund(pairs) {
      if (mode === "java") {
        try { return await call("/api/fund", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: pairs.map(([id, a]) => encodeURIComponent(id) + "=" + a).join("&") }); }
        catch { mode = "local"; }
      }
      local.fund(pairs);
      return { ok: true };
    },
  };
})();
