import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

/**
 * Sahbhagi backend: the P2P Micro-Lending Matchmaker algorithm from P2PMatchmakerApp.java,
 * exposed as a small JSON HTTP API (JDK only, no external libraries).
 *
 * Endpoints
 *   GET  /api/health
 *   GET  /api/match?risk=1..10&capital=100..5000&verifiedOnly=true|false
 *   GET  /api/borrowers
 *   POST /api/borrowers      (application/x-www-form-urlencoded, adds a listing)
 *   POST /api/fund           (id=..&amount=.. pairs, reduces requested amounts)
 */
public class MatchmakerServer {

    // --- Domain Model: Borrower Listing (from P2PMatchmakerApp, plus KYC fields) ---
    static class Borrower {
        String id;
        String name;
        String purpose;
        double requestedAmount;
        double interestRate; // Annual %
        int creditScore;     // 300 - 850
        double defaultProb;  // e.g. 0.02 = 2%
        // KYC
        boolean aadhaarVerified;
        boolean panVerified;
        String aadhaarMasked;
        String panMasked;

        Borrower(String id, String name, String purpose, double requestedAmount,
                 double interestRate, int creditScore, double defaultProb,
                 boolean aadhaarVerified, boolean panVerified, String aadhaarMasked, String panMasked) {
            this.id = id;
            this.name = name;
            this.purpose = purpose;
            this.requestedAmount = requestedAmount;
            this.interestRate = interestRate;
            this.creditScore = creditScore;
            this.defaultProb = defaultProb;
            this.aadhaarVerified = aadhaarVerified;
            this.panVerified = panVerified;
            this.aadhaarMasked = aadhaarMasked;
            this.panMasked = panMasked;
        }

        boolean isVerified() { return aadhaarVerified && panVerified; }

        // Risk Category derived from Default Probability
        String getRiskTier() {
            if (defaultProb <= 0.04) return "Low Risk";
            if (defaultProb <= 0.09) return "Moderate Risk";
            return "High Risk";
        }
    }

    // --- Match Evaluation Result ---
    static class MatchResult {
        Borrower borrower;
        double netExpectedROI; // Adjusted for default loss
        double matchScore;     // Composite ranking score (0 - 100)
        double riskFitScore, returnScore, capitalScore;
        String rationale;

        MatchResult(Borrower b, double netROI, double riskFit, double ret, double cap, String rationale) {
            this.borrower = b;
            this.netExpectedROI = netROI;
            this.riskFitScore = riskFit;
            this.returnScore = ret;
            this.capitalScore = cap;
            this.matchScore = riskFit + ret + cap;
            this.rationale = rationale;
        }
    }

    private static final List<Borrower> borrowers = new CopyOnWriteArrayList<>();
    private static int nextId = 111;

    private static void initSampleData() {
        borrowers.add(new Borrower("B101", "Artisan Bakery", "Inventory Expansion", 1200, 8.5, 760, 0.02, true, true, "XXXX XXXX 4821", "AXXXX3410X"));
        borrowers.add(new Borrower("B102", "Urban Courier", "Electric Bike Fleet", 2500, 14.0, 680, 0.06, true, true, "XXXX XXXX 7302", "UXXXX9182X"));
        borrowers.add(new Borrower("B103", "Tech Fix Hub", "Repair Tooling", 800, 19.5, 610, 0.12, true, false, "XXXX XXXX 1957", "Not provided"));
        borrowers.add(new Borrower("B104", "Green Grocer", "Cold Storage", 3200, 9.0, 740, 0.03, true, true, "XXXX XXXX 6640", "GXXXX2275X"));
        borrowers.add(new Borrower("B105", "Craft Pottery", "Studio Kiln", 600, 16.0, 640, 0.08, true, true, "XXXX XXXX 3018", "CXXXX5521X"));
        borrowers.add(new Borrower("B106", "Solar Installer", "Certification & Kit", 4500, 11.5, 710, 0.05, true, true, "XXXX XXXX 8893", "SXXXX7704X"));
        borrowers.add(new Borrower("B107", "Mobile Cafe", "Espresso Unit", 1800, 22.0, 580, 0.15, false, false, "Not provided", "Not provided"));
        borrowers.add(new Borrower("B108", "Local Tailor", "Sewing Equipment", 950, 7.5, 780, 0.015, true, true, "XXXX XXXX 2466", "LXXXX1039X"));
        borrowers.add(new Borrower("B109", "Freelance Studio", "Workstation Upgrade", 2200, 12.5, 690, 0.055, true, true, "XXXX XXXX 5179", "FXXXX6648X"));
        borrowers.add(new Borrower("B110", "Street Eatery", "Kitchen Remodel", 3800, 18.0, 615, 0.11, false, true, "Not provided", "SXXXX4417X"));
    }

    // --- Core Matchmaker Algorithm (unchanged from P2PMatchmakerApp.updateRecommendations) ---
    static MatchResult evaluate(Borrower b, int investorRisk, double investorCapital) {
        // 1. Estimated Net ROI = Nominal Interest - Default Loss Expectancy (75% loss on default)
        double expectedLoss = b.defaultProb * 0.75 * 100.0;
        double netROI = Math.max(0.0, b.interestRate - expectedLoss);

        // 2. Risk Compatibility Score (0 - 40 points)
        double borrowerRiskIndex = b.defaultProb * 50.0; // 0.02 -> 1.0, 0.15 -> 7.5
        double riskDiff = Math.abs(investorRisk - borrowerRiskIndex);
        double riskFitScore = Math.max(0.0, 40.0 - (riskDiff * 5.0));

        // 3. Return Attractiveness Score (0 - 35 points)
        double returnHungerWeight = investorRisk / 10.0;
        double returnScore = Math.min(35.0, (netROI * 2.0) * (0.6 + 0.4 * returnHungerWeight));

        // 4. Capital Compatibility Score (0 - 25 points)
        double capDiffRatio = Math.abs(b.requestedAmount - investorCapital) / Math.max(b.requestedAmount, investorCapital);
        double capitalScore = Math.max(0.0, 25.0 * (1.0 - Math.min(1.0, capDiffRatio)));

        // Transparent rationale
        String rationale;
        if (investorRisk <= 3) {
            rationale = b.creditScore >= 720 ? "High solvency aligns with conservative target"
                                             : "Acceptable safety margin; low volatility";
        } else if (investorRisk >= 8) {
            rationale = netROI > 12.0 ? "High yield compensates for default profile"
                                      : "Solid upside matching aggressive growth goal";
        } else {
            rationale = "Balanced blend of steady yield and risk tolerance";
        }
        return new MatchResult(b, netROI, riskFitScore, returnScore, capitalScore, rationale);
    }

    static List<MatchResult> rank(int risk, double capital, boolean verifiedOnly) {
        List<MatchResult> evaluated = new ArrayList<>();
        for (Borrower b : borrowers) {
            if (b.requestedAmount <= 0) continue;           // fully funded
            if (verifiedOnly && !b.isVerified()) continue;  // Aadhaar + PAN filter
            evaluated.add(evaluate(b, risk, capital));
        }
        // Rank Best to Worst (Descending Score)
        evaluated.sort(Comparator.comparingDouble((MatchResult m) -> m.matchScore).reversed());
        return evaluated;
    }

    /** Split the investor's capital across the top 5 in proportion to match score, capped by each request. */
    static double[] allocate(List<MatchResult> top, double capital) {
        double[] alloc = new double[top.size()];
        double left = capital;
        for (int pass = 0; pass < 6 && left > 0.5; pass++) {
            double w = 0;
            for (int i = 0; i < top.size(); i++) if (alloc[i] < top.get(i).borrower.requestedAmount) w += top.get(i).matchScore;
            if (w <= 0) break;
            double used = 0;
            for (int i = 0; i < top.size(); i++) {
                double room = top.get(i).borrower.requestedAmount - alloc[i];
                if (room <= 0) continue;
                double give = Math.min(room, left * top.get(i).matchScore / w);
                alloc[i] += give;
                used += give;
            }
            left -= used;
            if (used < 0.5) break;
        }
        for (int i = 0; i < alloc.length; i++) alloc[i] = Math.floor(alloc[i]);
        // hand the rounding remainder to the best-ranked borrower(s) that still have room
        double rem = capital - Arrays.stream(alloc).sum();
        for (int i = 0; i < alloc.length && rem >= 1; i++) {
            double give = Math.min(rem, Math.floor(top.get(i).borrower.requestedAmount - alloc[i]));
            if (give > 0) { alloc[i] += give; rem -= give; }
        }
        return alloc;
    }

    // --- HTTP layer ---
    public static void main(String[] args) throws IOException {
        initSampleData();
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "5000"));
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        server.createContext("/api/health", ex -> send(ex, 200, "{\"status\":\"ok\",\"engine\":\"java\",\"borrowers\":" + borrowers.size() + "}"));
        server.createContext("/api/match", MatchmakerServer::handleMatch);
        server.createContext("/api/borrowers", MatchmakerServer::handleBorrowers);
        server.createContext("/api/fund", MatchmakerServer::handleFund);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.start();
        System.out.println("Sahbhagi matchmaker API listening on port " + port);
    }

    private static void handleMatch(HttpExchange ex) throws IOException {
        if (preflight(ex)) return;
        Map<String, String> q = parseQuery(ex.getRequestURI().getRawQuery());
        int risk = (int) clamp(parseD(q.get("risk"), 5), 1, 10);
        double capital = clamp(parseD(q.get("capital"), 2000), 100, 5000);
        boolean verifiedOnly = !"false".equalsIgnoreCase(q.getOrDefault("verifiedOnly", "true"));

        List<MatchResult> ranked = rank(risk, capital, verifiedOnly);
        List<MatchResult> top = ranked.subList(0, Math.min(5, ranked.size()));
        double[] alloc = allocate(top, capital);

        long hidden = borrowers.stream().filter(b -> b.requestedAmount > 0 && !b.isVerified()).count();
        StringBuilder sb = new StringBuilder();
        sb.append("{\"risk\":").append(risk)
          .append(",\"capital\":").append(num(capital))
          .append(",\"verifiedOnly\":").append(verifiedOnly)
          .append(",\"unverifiedOpen\":").append(hidden)
          .append(",\"ranked\":[");
        for (int i = 0; i < ranked.size(); i++) {
            if (i > 0) sb.append(',');
            MatchResult m = ranked.get(i);
            sb.append(resultJson(m, i + 1, i < alloc.length ? alloc[i] : 0));
        }
        sb.append("]}");
        send(ex, 200, sb.toString());
    }

    private static void handleBorrowers(HttpExchange ex) throws IOException {
        if (preflight(ex)) return;
        if ("POST".equalsIgnoreCase(ex.getRequestMethod())) {
            Map<String, String> f = parseQuery(readBody(ex));
            String name = f.getOrDefault("name", "").trim();
            if (name.isEmpty() || name.length() > 60) { send(ex, 400, "{\"error\":\"name is required (max 60 chars)\"}"); return; }
            int score = (int) clamp(parseD(f.get("creditScore"), 650), 300, 850);
            // Estimated default probability from credit score (calibrated to the sample listings)
            double pd = clamp(0.155 - (score - 580) * 0.0007, 0.01, 0.30);
            pd = Math.round(pd * 1000) / 1000.0;
            Borrower b = new Borrower("B" + (nextId++), name,
                    trim(f.getOrDefault("purpose", "Small business"), 60),
                    clamp(parseD(f.get("requestedAmount"), 1000), 100, 10000),
                    clamp(parseD(f.get("interestRate"), 12), 5, 36),
                    score, pd,
                    "true".equals(f.get("aadhaarVerified")), "true".equals(f.get("panVerified")),
                    trim(f.getOrDefault("aadhaarMasked", "Not provided"), 20),
                    trim(f.getOrDefault("panMasked", "Not provided"), 20));
            borrowers.add(0, b);
            send(ex, 201, borrowerJson(b));
            return;
        }
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < borrowers.size(); i++) { if (i > 0) sb.append(','); sb.append(borrowerJson(borrowers.get(i))); }
        send(ex, 200, sb.append(']').toString());
    }

    private static void handleFund(HttpExchange ex) throws IOException {
        if (preflight(ex)) return;
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) { send(ex, 405, "{\"error\":\"POST only\"}"); return; }
        String body = readBody(ex);
        double total = 0;
        for (String pair : body.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length != 2) continue;
            String id = URLDecoder.decode(kv[0], StandardCharsets.UTF_8);
            double amt = Math.max(0, parseD(URLDecoder.decode(kv[1], StandardCharsets.UTF_8), 0));
            for (Borrower b : borrowers) if (b.id.equals(id)) {
                double give = Math.min(amt, b.requestedAmount);
                b.requestedAmount -= give;
                total += give;
            }
        }
        send(ex, 200, "{\"funded\":" + num(total) + "}");
    }

    // --- JSON helpers ---
    private static String borrowerJson(Borrower b) {
        return "{\"id\":" + str(b.id) + ",\"name\":" + str(b.name) + ",\"purpose\":" + str(b.purpose)
                + ",\"requestedAmount\":" + num(b.requestedAmount) + ",\"interestRate\":" + num(b.interestRate)
                + ",\"creditScore\":" + b.creditScore + ",\"defaultProb\":" + num(b.defaultProb)
                + ",\"riskTier\":" + str(b.getRiskTier())
                + ",\"kyc\":{\"aadhaar\":" + b.aadhaarVerified + ",\"pan\":" + b.panVerified
                + ",\"aadhaarMasked\":" + str(b.aadhaarMasked) + ",\"panMasked\":" + str(b.panMasked)
                + ",\"verified\":" + b.isVerified() + "}}";
    }

    private static String resultJson(MatchResult m, int rank, double alloc) {
        return "{\"rank\":" + rank + ",\"borrower\":" + borrowerJson(m.borrower)
                + ",\"netExpectedROI\":" + num(m.netExpectedROI) + ",\"matchScore\":" + num(m.matchScore)
                + ",\"scores\":{\"riskFit\":" + num(m.riskFitScore) + ",\"return\":" + num(m.returnScore) + ",\"capital\":" + num(m.capitalScore) + "}"
                + ",\"allocation\":" + num(alloc)
                + ",\"rationale\":" + str(m.rationale) + "}";
    }

    private static String num(double d) { return String.format(Locale.ROOT, "%.4f", d); }

    private static String str(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default: if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    // --- misc helpers ---
    private static boolean preflight(HttpExchange ex) throws IOException {
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) { ex.sendResponseHeaders(204, -1); ex.close(); return true; }
        return false;
    }

    private static void send(HttpExchange ex, int code, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }

    private static String readBody(HttpExchange ex) throws IOException {
        try (InputStream in = ex.getRequestBody()) {
            byte[] data = in.readNBytes(16 * 1024);
            return new String(data, StandardCharsets.UTF_8);
        }
    }

    private static Map<String, String> parseQuery(String q) {
        Map<String, String> m = new HashMap<>();
        if (q == null || q.isEmpty()) return m;
        for (String pair : q.split("&")) {
            String[] kv = pair.split("=", 2);
            m.put(URLDecoder.decode(kv[0], StandardCharsets.UTF_8), kv.length > 1 ? URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "");
        }
        return m;
    }

    private static double parseD(String s, double def) {
        try { return s == null ? def : Double.parseDouble(s.trim()); } catch (NumberFormatException e) { return def; }
    }

    private static double clamp(double v, double lo, double hi) { return Math.max(lo, Math.min(hi, v)); }

    private static String trim(String s, int max) { s = s.trim(); return s.length() > max ? s.substring(0, max) : s; }
}
