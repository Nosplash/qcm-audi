// add_mnemonics.js
// Ajoute automatiquement un champ "mnemonic" aux questions qui n'en ont pas.

const fs = require("fs");

const INPUT = "questions.json";
const BACKUP = "questions.backup.json";

function norm(s) {
  return (s || "").toLowerCase();
}

function guessMnemonic(q) {
  const t = norm(q.theme);
  const text = norm(q.question);
  const choices = q.choices || [];
  const answer = choices[q.answerIndex] || "";

  // --- Règles "ultra rentables" (tu peux en ajouter autant que tu veux) ---

  // Auto Union / 4 anneaux / 1932
  if (text.includes("auto union") && (text.includes("fond") || text.includes("fondée") || text.includes("fondation"))) {
    return "4 anneaux = 4 marques ; Auto Union = 1932 (retenir 32).";
  }

  // quattro Genève 3 mars 1980
  if (text.includes("quattro") && text.includes("genève")) {
    return "quattro = 3/3/80 (3 mars 1980) → facile à visualiser : 3-3-80.";
  }

  // Le Mans 2000 (première victoire)
  if (text.includes("première") && text.includes("mans") && answer.includes("2000")) {
    return "Le Mans : 2000 = 1re victoire Audi (R8) → 2000 = départ de la série.";
  }

  // Diesel 2006 / R10 TDI / V12 TDI
  if (text.includes("diesel") && answer.includes("2006")) {
    return "Diesel = 2006 : pense 'D' + '6' (2006) = 1re victoire diesel.";
  }
  if (text.includes("r10") || (text.includes("mans") && text.includes("2006") && text.includes("moteur"))) {
    if (answer.toLowerCase().includes("v12")) return "R10 TDI = V12 (gros diesel) → V12 = '12' comme 2012 arrive plus tard en hybride.";
  }

  // Hybride 2012 / R18 e-tron quattro
  if (text.includes("hybride") && answer.includes("2012")) {
    return "Hybride Audi au Mans = 2012 (R18 e-tron) → 12 = 'e-tron' première victoire hybride.";
  }

  // TT 1998
  if (text.includes("tt") && (text.includes("production") || text.includes("produit") || text.includes("début"))) {
    if (answer.includes("1998")) return "TT = fin des 90s → 1998 (Coupé) puis 1999 (Roadster).";
  }

  // August Horch / Audi
  if (text.includes("august horch") && (text.includes("audi") || text.includes("zwickau"))) {
    return "Horch → Audi (latin 'écoute !') ; Audi fondée à Zwickau (1909).";
  }
  if (text.includes("pourquoi") && text.includes("audi") && text.includes("horch")) {
    return "Horch = 'écoute !' en allemand → Audi = 'écoute !' en latin.";
  }

  // Ferdinand Porsche / Auto Union GP
  if (text.includes("ferdinand porsche") && (text.includes("auto union") || text.includes("grand prix") || text.includes("gp"))) {
    return "Porsche = cerveau technique Auto Union GP (années 30) → associer Porsche ↔ Silver Arrows.";
  }

  // Concepts sphere (mnémo chiffres)
  if (t.includes("concept") || text.includes("sphere")) {
    if (text.includes("activesphere")) return "Active = 4,98 m / 2,97 m → '98' et '97' (facile à confondre, retenir le couple).";
    if (text.includes("grandsphere")) return "Grand = 5,35 m / 3,19 m → 'très grand empattement'.";
    if (text.includes("urbansphere")) return "Urban = 5,51 m (le plus long) → 5-5-1.";
    if (text.includes("skysphere")) return "Sky = 4,94 ↔ 5,19 (+25 cm) → 494/519 + 250 mm.";
  }

  // Par défaut : rien (on mettra "—" dans l'app)
  return "";
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`❌ Fichier introuvable: ${INPUT}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("❌ JSON invalide dans questions.json :", e.message);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error("❌ Le JSON doit être un tableau de questions.");
    process.exit(1);
  }

  // backup
  fs.writeFileSync(BACKUP, raw, "utf8");

  let added = 0;
  for (const q of data) {
    if (!q || typeof q !== "object") continue;
    if (q.mnemonic && String(q.mnemonic).trim().length > 0) continue;

    const m = guessMnemonic(q);
    if (m) {
      q.mnemonic = m;
      added++;
    }
  }

  fs.writeFileSync(INPUT, JSON.stringify(data, null, 2), "utf8");

  console.log(`✅ Terminé. Mnémotechniques ajoutées: ${added}`);
  console.log(`🧷 Backup créé: ${BACKUP}`);
}

main();