// Risk + return + matching engine. Pure functions, runs in < 1 ms for 40 listings.
(function () {
  const LGD = 0.50;          // loss given default for unsecured micro-loans
  const FEE = 0.01;          // platform fee, % p.a.
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Probability of default over the loan term (logistic scorecard)
  function probDefault(b) {
    let z = -2.7
      - 0.0085 * (b.creditScore - 700)
      + 4.2 * (b.dti - 0.30)
      - 5.0 * (b.onTime - 0.92)
      - 0.06 * (b.vintage - 4)
      + 0.02 * (b.tenure - 12)
      - 0.05 * Math.min(b.priorLoans, 6);
    if (!(b.kyc.aadhaar && b.kyc.pan)) z += 0.7; // identity risk premium
    return clamp(sigmoid(z), 0.004, 0.6);
  }

  function enrich(b) {
    const pd = probDefault(b);
    const rate = b.rate ?? +clamp(12 + pd * 95 + b.rateNoise, 11, 36).toFixed(1); // APR %
    const n = b.tenure;
    const avgLife = (n + 1) / 24;                         // avg capital outstanding (years) for an EMI loan
    const lossAnnual = (pd * LGD) / avgLife;              // expected credit loss, % p.a.
    const expAnnual = rate / 100 - FEE - lossAnnual;      // expected ROI p.a.
    const expTerm = expAnnual * avgLife;                  // expected earnings per ₹1 over the term
    const sigma = (Math.sqrt(pd * (1 - pd)) * LGD) / avgLife;
    const grade = pd < 0.03 ? "A" : pd < 0.06 ? "B" : pd < 0.10 ? "C" : pd < 0.16 ? "D" : "E";
    const verified = b.kyc.aadhaar && b.kyc.pan;
    return { ...b, rate, pd, avgLife, lossAnnual, expTerm, expAnnual, sigma, grade, verified, remaining: Math.max(0, b.amount - b.funded) };
  }

  // Investor risk appetite 1..10 -> preferences
  function prefs(risk) {
    const a = (risk - 1) / 9;
    return {
      a,
      pdMax: 0.03 + a * 0.20,          // tolerated default probability
      wReturn: 0.15 + 0.45 * a,
      wSafety: 0.60 - 0.45 * a,
      wCapacity: 0.15,
      wTrust: 0.10,
    };
  }

  function rank(listings, { risk, amount }) {
    const P = prefs(risk);
    const rets = listings.map((l) => l.expAnnual), pds = listings.map((l) => l.pd);
    const rMin = Math.min(...rets), rMax = Math.max(...rets);
    const pMin = Math.min(...pds), pMax = Math.max(...pds);
    const slot = amount / 5; // planned ticket per borrower for a 5-way split

    const scored = listings.map((l) => {
      const ret = (l.expAnnual - rMin) / (rMax - rMin || 1);
      const safety = 1 - (l.pd - pMin) / (pMax - pMin || 1);
      const capacity = l.remaining <= 0 ? 0 : clamp(l.remaining / slot, 0, 1);
      const trust = (l.verified ? 0.6 : l.kyc.aadhaar || l.kyc.pan ? 0.25 : 0) + 0.4 * clamp((l.onTime - 0.7) / 0.3, 0, 1);
      const over = Math.max(0, l.pd - P.pdMax);
      const penalty = clamp(over * 4.5, 0, 0.6);
      const parts = {
        Return: P.wReturn * ret,
        Safety: P.wSafety * safety,
        Capacity: P.wCapacity * capacity,
        Trust: P.wTrust * trust,
        Penalty: -penalty,
      };
      const fit = clamp(Object.values(parts).reduce((s, x) => s + x, 0), 0, 1);
      return { ...l, fit, parts, norm: { ret, safety, capacity, trust }, over, pdMax: P.pdMax };
    });
    scored.sort((x, y) => y.fit - x.fit || y.expAnnual - x.expAnnual);
    scored.forEach((s, idx) => (s.rank = idx + 1));
    return { ranked: scored, P };
  }

  // Allocate the amount across top 5: proportional to fit, capped by remaining need and 35% diversification cap
  function allocate(top, amount) {
    const cap = amount * 0.35;
    const alloc = top.map(() => 0);
    let left = amount;
    for (let pass = 0; pass < 6 && left > 1; pass++) {
      const open = top.map((t, i) => (alloc[i] < Math.min(cap, t.remaining) ? i : -1)).filter((i) => i >= 0);
      if (!open.length) break;
      const w = open.reduce((s, i) => s + top[i].fit + 0.05, 0);
      let used = 0;
      open.forEach((i) => {
        const want = (left * (top[i].fit + 0.05)) / w;
        const room = Math.min(cap, top[i].remaining) - alloc[i];
        const give = Math.min(want, room);
        alloc[i] += give; used += give;
      });
      left -= used;
      if (used < 1) break;
    }
    const rounded = alloc.map((x) => Math.floor(x / 100) * 100);
    const unallocated = Math.max(0, amount - rounded.reduce((s, x) => s + x, 0));
    return { alloc: rounded, unallocated };
  }

  window.Engine = { enrich, rank, allocate, prefs, probDefault, LGD, FEE };
})();
