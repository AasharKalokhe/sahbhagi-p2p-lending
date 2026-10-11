# Sahbhagi — P2P Micro-Lending Matchmaker

An interactive web app that matches investors with micro-loan borrowers. Set your risk appetite and investment amount, and every open listing is re-ranked instantly, with a recommended top 5, estimated ROI and a plain-language reason for each ranking.

## Features
- **Live ranking** — risk appetite (1–10) and amount (₹5,000–₹5,00,000) re-rank borrowers instantly, with ▲/▼ rank-movement badges.
- **Top 5 recommendations** — suggested allocation per borrower (fit-weighted, max 35% each), estimated ROI p.a. and expected earnings.
- **Explainable scores** — fit score split into Safety, Return, Capacity and Trust, plus three reasons per borrower.
- **Verified borrowers only** — on by default; investors see only Aadhaar + PAN verified borrowers (masked IDs shown).
- **Borrower KYC onboarding** — Aadhaar Verhoeff checksum + OTP, PAN format and surname check, then publish a listing.
- Risk vs. return chart, full ranked listings table, borrower detail drawer, light/dark mode, mobile friendly.

## Model
- Probability of default (PD): logistic scorecard on credit score, debt-to-income, on-time repayments, work vintage, tenure and KYC status.
- `ROI p.a. = interest rate − 1% fee − (PD × 50% loss ÷ average loan life)`
- Fit weights shift from safety to return as risk appetite rises; borrowers above your PD tolerance (3% → 23%) are penalised.

## Run / deploy
Static site, no build step. Open `index.html`, or deploy on Vercel (Framework preset: **Other**, no build command, output directory: root).

Demo data and KYC are simulated in the browser. Production would integrate UIDAI Aadhaar e-KYC / DigiLocker and Protean (NSDL) PAN verification.
