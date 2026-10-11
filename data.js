// Seeded demo dataset of open borrower listings (deterministic so rankings are reproducible)
(function () {
  let seed = 20261011;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => a + rnd() * (b - a);
  const round = (x, s) => Math.round(x / s) * s;

  const first = ["Aarav","Priya","Rohan","Sneha","Imran","Kavya","Arjun","Meera","Vikram","Anjali","Suresh","Fatima","Rahul","Lakshmi","Karan","Pooja","Nikhil","Divya","Manoj","Ayesha","Ganesh","Shreya","Harish","Neha","Ravi","Sunita","Aditya","Zoya","Deepak","Swati","Farhan","Kiran","Mahesh","Rekha","Siddharth","Tanvi","Omkar","Nisha","Yusuf","Bhavna"];
  const last = ["Patil","Sharma","Deshmukh","Iyer","Khan","Reddy","Kulkarni","Nair","Joshi","Gupta","Shinde","Sheikh","Verma","Pillai","Mehta","Pawar","Rao","Bose","Jadhav","Qureshi","More","Chavan","Menon","Singh","Kale"];
  const cities = ["Pune","Nashik","Nagpur","Mumbai","Kolhapur","Aurangabad","Satara","Solapur","Indore","Hyderabad","Bengaluru","Surat","Jaipur","Lucknow","Kochi","Bhopal"];
  const purposes = [
    ["Kirana store inventory","Small business"],["Tailoring machines","Small business"],["Dairy cattle purchase","Agriculture"],
    ["Auto-rickshaw repair","Transport"],["College tuition fees","Education"],["Medical treatment","Personal"],
    ["Bakery oven upgrade","Small business"],["Mobile repair shop setup","Small business"],["Organic seeds & drip irrigation","Agriculture"],
    ["Handloom raw material","Small business"],["Food cart expansion","Small business"],["Beauty salon equipment","Small business"],
    ["Two-wheeler for delivery work","Transport"],["Skill certification course","Education"],["Home roof repair","Personal"],
    ["Poultry farm expansion","Agriculture"],["Laptop for freelance work","Education"],["Pottery kiln","Small business"]
  ];
  const employment = ["Self-employed","Salaried","Shop owner","Farmer","Gig worker","Freelancer"];

  const list = [];
  for (let i = 0; i < 40; i++) {
    const fn = first[i % first.length];
    const ln = pick(last);
    const [purpose, category] = pick(purposes);
    const creditScore = Math.round(between(560, 860));
    const dti = +between(0.08, 0.58).toFixed(2);
    const onTime = +Math.min(1, between(0.72, 1.02)).toFixed(2);
    const priorLoans = Math.floor(between(0, 9));
    const vintage = +between(0.5, 12).toFixed(1);
    const tenure = pick([6, 9, 12, 12, 18, 24, 24, 36]);
    const amount = round(between(15000, 300000), 5000);
    const funded = round(amount * between(0, 0.85), 1000);
    const income = round(between(14000, 95000), 500);
    // KYC distribution: ~65% fully verified, rest partial/pending
    const k = rnd();
    const aadhaar = k < 0.65 || (k >= 0.65 && k < 0.78);
    const pan = k < 0.65 || (k >= 0.78 && k < 0.88);
    const a4 = String(1000 + Math.floor(rnd() * 9000));
    const p4 = String(1000 + Math.floor(rnd() * 9000));
    list.push({
      id: "BR-" + String(1001 + i),
      name: fn + " " + ln,
      initials: fn[0] + ln[0],
      city: pick(cities),
      purpose, category,
      employment: pick(employment),
      creditScore, dti, onTime, priorLoans, vintage, tenure,
      amount, funded, income,
      kyc: {
        aadhaar, pan,
        aadhaarMasked: "XXXX XXXX " + a4,
        panMasked: ln[0].toUpperCase() + "XXXX" + p4 + "X",
        verifiedOn: aadhaar && pan ? `2026-0${1 + Math.floor(rnd() * 9)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}` : null
      },
      rateNoise: between(-2.2, 2.2)
    });
  }
  window.BORROWERS = list;
})();
