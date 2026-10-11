# Sahbhagi — P2P Micro-Lending Matchmaker

Investors set a risk appetite (1–10) and available capital ($100–$5,000). A **Java backend** ranks every open borrower listing from best to worst fit, and the web app shows the top 5 with estimated net ROI, a suggested allocation and a transparent rationale. Rankings refresh live as either control moves.

## Project layout
```
backend/src/MatchmakerServer.java   Java matchmaker algorithm + JSON HTTP API (JDK only)
public/                             Static web app (HTML/CSS/JS)
  engine.js                         API client + offline mirror of the Java algorithm
  data.js                           Mirror of the sample listings (offline fallback)
```

## Matching algorithm (backend)
- **Net expected ROI** = interest rate − default probability × 75% × 100
- **Risk fit (0–40)** = 40 − 5 × |appetite − default probability × 50|
- **Return (0–35)** = min(35, 2 × net ROI × (0.6 + 0.4 × appetite ÷ 10))
- **Capital fit (0–25)** = 25 × (1 − |requested − capital| ÷ max(requested, capital))
- **Match score** = risk fit + return + capital fit (0–100), sorted descending
- Risk tiers: Low (≤ 4%), Moderate (≤ 9%), High (> 9%) default probability
- Rationale text depends on appetite band (conservative / balanced / aggressive)
- Capital is split across the top 5 in proportion to match score, capped at each request

## Verified borrowers only
Each borrower has Aadhaar and PAN verification status. With `verifiedOnly=true` (the default), the backend excludes anyone without **both** verified before ranking. The borrower onboarding flow simulates Aadhaar (Verhoeff checksum + OTP) and PAN (format + surname initial) checks; only masked IDs are sent to the backend.

## API
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Status check |
| GET | `/api/match?risk=5&capital=2000&verifiedOnly=true` | Ranked listings with scores, allocation and rationale |
| GET | `/api/borrowers` | All listings |
| POST | `/api/borrowers` | Add a listing (form-encoded: name, purpose, requestedAmount, interestRate, creditScore, aadhaarVerified, panVerified, aadhaarMasked, panMasked). Default probability is estimated from credit score. |
| POST | `/api/fund` | Fund listings (`B101=500&B104=300`), reduces requested amounts |

## Run locally
```bash
cd backend && javac -d out src/MatchmakerServer.java && java -cp out MatchmakerServer   # API on :5000
cd public && python3 -m http.server 8080                                              # web app on :8080
```
If the API is unreachable, the web app falls back to an identical JavaScript copy of the algorithm.

Data is held in memory: new listings and funding reset when the server restarts. Demo data and KYC are simulated; production would integrate UIDAI Aadhaar e-KYC / DigiLocker and Protean (NSDL) PAN verification.
