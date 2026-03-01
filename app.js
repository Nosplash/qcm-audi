const HOME = document.getElementById("screen-home");
const QUIZ = document.getElementById("screen-quiz");
const RESULT = document.getElementById("screen-result");

const btnStart = document.getElementById("btn-start");
const btnResume = document.getElementById("btn-resume"); // ✅ nouveau bouton (index.html)
const btnSkip = document.getElementById("btn-skip");
const btnNext = document.getElementById("btn-next");
const btnRetry = document.getElementById("btn-retry");
const btnReview = document.getElementById("btn-review");
const installBtn = document.getElementById("btn-install");

const qIndexEl = document.getElementById("q-index");
const timeLeftEl = document.getElementById("time-left");
const questionEl = document.getElementById("question");
const choicesEl = document.getElementById("choices");

const feedbackEl = document.getElementById("feedback");
const scoreEl = document.getElementById("score");
const reviewEl = document.getElementById("review");

const REMAINING_KEY = "qcm_audi_remaining_ids_v1";

const SESSION_SIZE = 30;
const TIME_PER_Q = 30;

const HISTORY_KEY = "qcm_audi_seen_ids_v1";
const HISTORY_MAX = 300; // ~10 sessions

// ✅ état session en cours (reprendre)
const SESSION_STATE_KEY = "qcm_audi_session_state_v1";

// 🔊 Bip (doit exister dans le dossier)
const beep = new Audio("beep.mp3");
beep.volume = 0.8;
beep.preload = "auto";

let allQuestions = [];
let session = [];
let current = 0;
let score = 0;

let timer = null;
let timeLeft = TIME_PER_Q;
let answered = false;

let wrongAnswers = []; // { q, chosenIndex }

// ✅ SHUFFLE DES CHOIX (mapping affichage <-> index d'origine)
let choiceShuffle = {
  qid: null,   // id de la question pour éviter reshuffle si re-render
  order: [],   // [origIdx, origIdx, origIdx, origIdx] en ordre d'affichage
  inv: []      // inv[origIdx] = displayIdx
};

function show(screen) {
  HOME.hidden = screen !== "home";
  QUIZ.hidden = screen !== "quiz";
  RESULT.hidden = screen !== "result";
}

/* ========= Random + Shuffle (crypto) ========= */
function randInt(max) {
  if (max <= 0) return 0;

  // Aléatoire fort (évite motifs au redémarrage)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const u32 = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max; // évite biais modulo
    let x;
    do {
      crypto.getRandomValues(u32);
      x = u32[0];
    } while (x >= limit);
    return x % max;
  }

  // Fallback
  return Math.floor(Math.random() * max);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ✅ génère une permutation stable pour la question courante
function ensureChoiceShuffleForQuestion(q) {
  if (choiceShuffle.qid === q.id && choiceShuffle.order.length === 4) return;

  choiceShuffle.qid = q.id;
  choiceShuffle.order = shuffle([0, 1, 2, 3]); // indices d'origine
  choiceShuffle.inv = [];
  choiceShuffle.order.forEach((origIdx, displayIdx) => {
    choiceShuffle.inv[origIdx] = displayIdx;
  });
}

/* ========= Historique (déjà présent, conservé) ========= */
function loadSeenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSeenIds(seenSet) {
  const arr = Array.from(seenSet);
  const trimmed = arr.slice(Math.max(0, arr.length - HISTORY_MAX));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

/* ========= remaining_ids (sans remise) ========= */
function loadRemainingIds() {
  try {
    const arr = JSON.parse(localStorage.getItem(REMAINING_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveRemainingIds(ids) {
  localStorage.setItem(REMAINING_KEY, JSON.stringify(ids));
}

function resetRemainingIds() {
  const ids = shuffle(allQuestions.map(q => q.id));
  saveRemainingIds(ids);
  return ids;
}

/* ========= Reprendre session ========= */
function loadSessionState() {
  try {
    const raw = localStorage.getItem(SESSION_STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.sessionIds) || s.sessionIds.length === 0) return null;
    return s;
  } catch {
    return null;
  }
}

function saveSessionState() {
  if (!session || session.length === 0) return;

  const state = {
    sessionIds: session.map(q => q.id),
    current,
    score,
    wrongAnswers: wrongAnswers.map(({ q, chosenIndex }) => ({ id: q.id, chosenIndex })),
    savedAt: Date.now()
  };

  try {
    localStorage.setItem(SESSION_STATE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function clearSessionState() {
  try {
    localStorage.removeItem(SESSION_STATE_KEY);
  } catch (e) {}
}

function updateResumeButton() {
  if (!btnResume) return;
  btnResume.hidden = !loadSessionState();
}

async function resumeSession() {
  await loadQuestions();

  const state = loadSessionState();
  if (!state) return false;

  const byId = new Map(allQuestions.map(q => [q.id, q]));
  const restored = state.sessionIds.map(id => byId.get(id)).filter(Boolean);

  // Si questions.json a changé (IDs manquants) -> on abandonne la reprise
  if (restored.length < SESSION_SIZE) {
    clearSessionState();
    updateResumeButton();
    return false;
  }

  session = restored;
  current = Math.min(Number(state.current || 0), SESSION_SIZE - 1);
  score = Number(state.score || 0);

  wrongAnswers = Array.isArray(state.wrongAnswers)
    ? state.wrongAnswers
        .map(w => ({ q: byId.get(w.id), chosenIndex: w.chosenIndex }))
        .filter(x => x.q)
    : [];

  // reset shuffle state
  choiceShuffle.qid = null;
  choiceShuffle.order = [];
  choiceShuffle.inv = [];

  show("quiz");
  renderQuestion();

  saveSessionState();
  updateResumeButton();
  return true;
}

/* ========= Questions ========= */
async function loadQuestions() {
  const res = await fetch("questions.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de charger questions.json");
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("questions.json doit contenir un tableau JSON.");
  allQuestions = data;
}

function pickSession() {
  if (allQuestions.length < SESSION_SIZE) {
    alert(`Il faut au moins ${SESSION_SIZE} questions (actuellement ${allQuestions.length}).`);
    return null;
  }

  // Pile "restant à poser" (anti-répétition stricte)
  let remaining = loadRemainingIds();

  // Si pile vide ou insuffisante pour 30 → nouveau cycle complet
  if (!remaining || remaining.length < SESSION_SIZE) {
    remaining = resetRemainingIds();
  }

  const byId = new Map(allQuestions.map(q => [q.id, q]));
  const remainingQuestions = remaining.map(id => byId.get(id)).filter(Boolean);

  // Buckets sur les questions restantes
  const buckets = { competition: [], concepts: [], origines: [], autres: [] };

  for (const q of remainingQuestions) {
    const t = (q.theme || "").toLowerCase();

    if (t.includes("compétition") || t.includes("competition") || t.includes("le mans") || t.includes("rallye")) {
      buckets.competition.push(q);
    } else if (t.includes("concept")) {
      buckets.concepts.push(q);
    } else if (t.includes("origine") || t.includes("entreprise") || t.includes("slogan") || t.includes("nsu") || t.includes("auto union")) {
      buckets.origines.push(q);
    } else {
      buckets.autres.push(q);
    }
  }

  const target = { competition: 8, concepts: 8, origines: 7, autres: 7 };

  const chosenSet = new Set();
  let chosen = [];

  const take = (arr, n) => {
    const pool = arr.filter(q => !chosenSet.has(q.id));
    const part = shuffle(pool).slice(0, Math.min(n, pool.length));
    part.forEach(q => chosenSet.add(q.id));
    chosen = chosen.concat(part);
  };

  // Respect du mix autant que possible
  take(buckets.competition, target.competition);
  take(buckets.concepts, target.concepts);
  take(buckets.origines, target.origines);
  take(buckets.autres, target.autres);

  // Complète à 30 avec le reste des questions restantes (toujours sans répétition)
  if (chosen.length < SESSION_SIZE) {
    const pool = remainingQuestions.filter(q => !chosenSet.has(q.id));
    const fill = shuffle(pool).slice(0, SESSION_SIZE - chosen.length);
    fill.forEach(q => chosenSet.add(q.id));
    chosen = chosen.concat(fill);
  }

  // Retire de remaining les IDs utilisés
  const usedIds = new Set(chosen.map(q => q.id));
  const newRemaining = remaining.filter(id => !usedIds.has(id));
  saveRemainingIds(newRemaining);

  return shuffle(chosen);
}

/* ========= Timer ========= */
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function startTimer() {
  stopTimer();
  timeLeft = TIME_PER_Q;
  timeLeftEl.textContent = String(timeLeft);

  timer = setInterval(() => {
    timeLeft--;
    timeLeftEl.textContent = String(timeLeft);

    // bip sur 5 dernières secondes (5,4,3,2,1)
    if (timeLeft <= 5 && timeLeft > 0) {
      try {
        beep.currentTime = 0;
        beep.play();
      } catch (e) {}
    }

    if (timeLeft <= 0) {
      stopTimer();
      if (!answered) lockAndNext(null);
    }
  }, 1000);
}

/* ========= UI ========= */
function renderQuestion() {
  answered = false;

  // reset UI feedback
  btnNext.hidden = true;
  btnSkip.disabled = false;
  feedbackEl.hidden = true;
  feedbackEl.innerHTML = "";

  const q = session[current];

  // ✅ prépare le shuffle pour CETTE question
  ensureChoiceShuffleForQuestion(q);

  qIndexEl.textContent = String(current + 1);
  questionEl.textContent = q.question;

  choicesEl.innerHTML = "";

  // ✅ affichage dans l'ordre mélangé, mais on garde l'index d'origine au click
  choiceShuffle.order.forEach((origIdx, displayIdx) => {
    const text = q.choices[origIdx];

    const btn = document.createElement("button");
    btn.className = "choice";
    btn.textContent = `${["A", "B", "C", "D"][displayIdx]}) ${text}`;

    // IMPORTANT : on passe l'index d'origine à lockAndNext
    btn.onclick = () => lockAndNext(origIdx);

    choicesEl.appendChild(btn);
  });

  startTimer();
}

// correctIndex/chosenIndex ici = indices D'AFFICHAGE (0..3)
function lockChoices(correctDisplayIndex, chosenDisplayIndex) {
  const buttons = [...choicesEl.querySelectorAll("button.choice")];
  buttons.forEach((b, idx) => {
    b.disabled = true;
    if (idx === correctDisplayIndex) b.classList.add("correct");
    if (chosenDisplayIndex !== null && idx === chosenDisplayIndex && chosenDisplayIndex !== correctDisplayIndex) {
      b.classList.add("wrong");
    }
  });
}

function showFeedback(q, chosenIndex) {
  // chosenIndex = index d'origine
  const correctText = q.choices[q.answerIndex];
  const chosenText = chosenIndex === null ? "Aucune réponse" : q.choices[chosenIndex];

  feedbackEl.hidden = false;
  feedbackEl.innerHTML = `
    <div class="title">❌ Mauvaise réponse</div>
    <div class="meta"><b>Ta réponse :</b> ${chosenText}</div>
    <div class="meta"><b>Bonne réponse :</b> ${correctText}</div>
    <div class="meta"><b>Explication :</b> ${q.explanation || "—"}</div>
    <div class="meta"><b>Mnémotechnique :</b> ${q.mnemonic || "—"}</div>
  `;
}

function endSession() {
  stopTimer();

  // ✅ session terminée => on supprime l'état "reprendre"
  clearSessionState();
  updateResumeButton();

  show("result");
  scoreEl.textContent = String(score);
  reviewEl.hidden = true;
  reviewEl.innerHTML = "";
}

function lockAndNext(chosenIndex) {
  if (answered) return;
  answered = true;
  stopTimer();

  const q = session[current];

  // ✅ sécurité : si déclenché par timeout, on s'assure que le mapping existe
  ensureChoiceShuffleForQuestion(q);

  const correctIndex = q.answerIndex; // index d'origine

  // ✅ conversion orig -> affichage pour le surlignage des boutons
  const correctDisplayIndex = choiceShuffle.inv[correctIndex];
  const chosenDisplayIndex = chosenIndex === null ? null : choiceShuffle.inv[chosenIndex];

  lockChoices(correctDisplayIndex, chosenDisplayIndex);

  const isCorrect = chosenIndex === correctIndex;
  if (isCorrect) {
    score++;
    current++; // ✅ on avance tout de suite pour que la sauvegarde soit fiable

    saveSessionState();
    updateResumeButton();

    setTimeout(() => {
      if (current >= SESSION_SIZE) endSession();
      else renderQuestion();
    }, 350);
    return;
  }

  // erreur / aucune réponse -> feedback + attendre "Suivant"
  wrongAnswers.push({ q, chosenIndex });
  showFeedback(q, chosenIndex);

  btnNext.hidden = false;
  btnSkip.disabled = true;

  saveSessionState();
  updateResumeButton();
}

function buildReview() {
  reviewEl.innerHTML = "";
  if (wrongAnswers.length === 0) {
    reviewEl.innerHTML = `<div class="item">✅ Aucune erreur.</div>`;
    return;
  }

  wrongAnswers.forEach(({ q, chosenIndex }, i) => {
    const chosen = chosenIndex === null ? "Aucune réponse" : q.choices[chosenIndex];
    const correct = q.choices[q.answerIndex];

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <b>${i + 1}. ${q.question}</b>
      <div class="meta">Ta réponse : <u>${chosen}</u></div>
      <div class="meta">Bonne réponse : <b>${correct}</b></div>
      <div class="meta">Explication : ${q.explanation || "—"}</div>
      <div class="meta">Mnémotechnique : ${q.mnemonic || "—"}</div>
      <div class="meta">Source : ${q.source || "—"}</div>
    `;
    reviewEl.appendChild(div);
  });
}

async function startNewSession() {
  await loadQuestions();

  // ✅ si on démarre une nouvelle session, on écrase l’ancienne
  clearSessionState();

  const s = pickSession();
  if (!s) return;

  session = s;
  current = 0;
  score = 0;
  wrongAnswers = [];

  // reset shuffle state
  choiceShuffle.qid = null;
  choiceShuffle.order = [];
  choiceShuffle.inv = [];

  show("quiz");
  renderQuestion();

  saveSessionState();
  updateResumeButton();
}

/* ====== HANDLERS ====== */

btnStart.onclick = async () => {
  try {
    await startNewSession();
  } catch (e) {
    alert("Erreur : " + e.message);
  }
};

if (btnResume) {
  btnResume.onclick = async () => {
    try {
      const ok = await resumeSession();
      if (!ok) {
        // rien à reprendre => fallback nouvelle session
        await startNewSession();
      }
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  };
}

btnRetry.onclick = async () => {
  try {
    await startNewSession();
  } catch (e) {
    alert("Erreur : " + e.message);
  }
};

btnSkip.onclick = () => lockAndNext(null);

btnNext.onclick = () => {
  btnNext.hidden = true;
  btnSkip.disabled = false;
  feedbackEl.hidden = true;
  feedbackEl.innerHTML = "";

  current++;
  saveSessionState();
  updateResumeButton();

  if (current >= SESSION_SIZE) endSession();
  else renderQuestion();
};

btnReview.onclick = () => {
  reviewEl.hidden = !reviewEl.hidden;
  if (!reviewEl.hidden) buildReview();
};

// ✅ sauvegarde quand l’app passe en arrière-plan / fermeture onglet
window.addEventListener("pagehide", () => {
  saveSessionState();
  updateResumeButton();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveSessionState();
    updateResumeButton();
  }
});

// PWA install prompt (Android/Chrome)
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
};

// ✅ au chargement : affiche/masque le bouton “Reprendre”
updateResumeButton();