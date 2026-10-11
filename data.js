// Mirror of the sample listings in backend/src/MatchmakerServer.java.
// Used only if the Java API is unreachable, so the page still works offline.
window.SAMPLE_BORROWERS = [
  ["B101","Artisan Bakery","Inventory Expansion",1200,8.5,760,0.02,true,true,"XXXX XXXX 4821","AXXXX3410X"],
  ["B102","Urban Courier","Electric Bike Fleet",2500,14.0,680,0.06,true,true,"XXXX XXXX 7302","UXXXX9182X"],
  ["B103","Tech Fix Hub","Repair Tooling",800,19.5,610,0.12,true,false,"XXXX XXXX 1957","Not provided"],
  ["B104","Green Grocer","Cold Storage",3200,9.0,740,0.03,true,true,"XXXX XXXX 6640","GXXXX2275X"],
  ["B105","Craft Pottery","Studio Kiln",600,16.0,640,0.08,true,true,"XXXX XXXX 3018","CXXXX5521X"],
  ["B106","Solar Installer","Certification & Kit",4500,11.5,710,0.05,true,true,"XXXX XXXX 8893","SXXXX7704X"],
  ["B107","Mobile Cafe","Espresso Unit",1800,22.0,580,0.15,false,false,"Not provided","Not provided"],
  ["B108","Local Tailor","Sewing Equipment",950,7.5,780,0.015,true,true,"XXXX XXXX 2466","LXXXX1039X"],
  ["B109","Freelance Studio","Workstation Upgrade",2200,12.5,690,0.055,true,true,"XXXX XXXX 5179","FXXXX6648X"],
  ["B110","Street Eatery","Kitchen Remodel",3800,18.0,615,0.11,false,true,"Not provided","SXXXX4417X"]
].map(([id,name,purpose,requestedAmount,interestRate,creditScore,defaultProb,a,p,am,pm]) => ({
  id, name, purpose, requestedAmount, interestRate, creditScore, defaultProb,
  kyc: { aadhaar: a, pan: p, aadhaarMasked: am, panMasked: pm, verified: a && p }
}));
