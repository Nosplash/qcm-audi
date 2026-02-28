const HOME = document.getElementById("screen-home");
const QUIZ = document.getElementById("screen-quiz");
const RESULT = document.getElementById("screen-result");

const btnStart = document.getElementById("btn-start");
const btnSkip = document.getElementById("btn-skip");
const btnRetry = document.getElementById("btn-retry");
const btnReview = document.getElementById("btn-review");
const feedbackEl = document.getElementById("feedback");
const btnNext = document.getElementById("btn-next");
const installBtn = document.getElementById("btn-install");

const qIndexEl = document.getElementById("q-index");
const timeLeftEl = document.getElementById("time-left");
const questionEl = document.getElementById("question");
const choicesEl = document.getElementById("choices");

const scoreEl = document.getElementById("score");
const reviewEl = document.getElementById("review");

const SESSION_SIZE = 30;
const TIME_PER_Q = 30;

let allQuestions = [];
let session = [];
let current = 0;
let score = 0;
let timer = null;
let answered = false;
let wrongAnswers = []; // { q, chosenIndex }

function show(screen) {
  HOME.hidden = screen !== "home";
  QUIZ.hidden = screen !== "quiz";
  RESULT.hidden = screen !== "result";
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadQuestions() {
  const res = await fetch("questions.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de charger questions.json");
  allQuestions = await res.json();
}

function pickSession() {
  if (allQuestions.length < SESSION_SIZE) {
    alert(`Ajoute des questions dans questions.json : il en faut au moins ${SESSION_SIZE} (actuellement ${allQuestions.length}).`);
    return null;
  }

  // Catégorisation “souple” par mots-clés dans theme
  const buckets = {
    competition: [],
    concepts: [],
    origines: [],
    autres: []
  };

  for (const q of allQuestions) {
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

  const pick = (arr, n) => shuffle(arr).slice(0, Math.min(n, arr.length));

  // Quotas pour 30 questions
  const target = {
    competition: 8,
    concepts: 8,
    origines: 7,
    autres: 7
  };

  let chosen = [
    ...pick(buckets.competition, target.competition),
    ...pick(buckets.concepts, target.concepts),
    ...pick(buckets.origines, target.origines),
    ...pick(buckets.autres, target.autres)
  ];

  // Compléter si un bucket est trop petit
  if (chosen.length < SESSION_SIZE) {
    const already = new Set(chosen.map(x => x.id));
    const remaining = shuffle(allQuestions).filter(q => !already.has(q.id));
    chosen = chosen.concat(remaining.slice(0, SESSION_SIZE - chosen.length));
  }

  // Si on a trop (rare), on tronque
  chosen = shuffle(chosen).slice(0, SESSION_SIZE);

  return chosen;
}

let timeLeft = TIME_PER_Q;
function startTimer() {
  stopTimer();
  timeLeft = TIME_PER_Q;
  timeLeftEl.textContent = timeLeft;
timer = setInterval(() => {
  timeLeft--;
  timeLeftEl.textContent = timeLeft;

  // ✅ Bip sur les 5 dernières secondes (5,4,3,2,1)
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

  timer = setInterval(() => {
    timeLeft--;
    timeLeftEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopTimer();
      if (!answered) lockAndNext(null);
    }
  }, 1000);

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function renderQuestion() {
  answered = false;btnNext.hidden = true;
btnSkip.disabled = false;
feedbackEl.hidden = true;
feedbackEl.innerHTML = "";
  const q = session[current];

  qIndexEl.textContent = String(current + 1);
  questionEl.textContent = q.question;

  choicesEl.innerHTML = "";
  q.choices.forEach((text, idx) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.textContent = `${["A","B","C","D"][idx]}) ${text}`;
    btn.onclick = () => lockAndNext(idx);
    choicesEl.appendChild(btn);
  });

  startTimer();
}

function lockChoices(correctIndex, chosenIndex) {
  const buttons = [...choicesEl.querySelectorAll("button.choice")];
  buttons.forEach((b, idx) => {
    b.disabled = true;
    if (idx === correctIndex) b.classList.add("correct");
    if (chosenIndex !== null && idx === chosenIndex && chosenIndex !== correctIndex) b.classList.add("wrong");
  });
}

function showFeedback(q, chosenIndex) {
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
function lockAndNext(chosenIndex) {
  if (answered) return;
  answered = true;
  stopTimer();

  const q = session[current];
  const correctIndex = q.answerIndex;

  lockChoices(correctIndex, chosenIndex);

  const isCorrect = chosenIndex === correctIndex;
  if (isCorrect) {
    score++;
    // Bonne réponse -> enchaîne rapidement
    setTimeout(() => {
      current++;
      if (current >= SESSION_SIZE) endSession();
      else renderQuestion();
    }, 450);
    return;
  }

  // Mauvaise réponse (ou pas de réponse) -> on affiche correction + bouton "Suivant"
  wrongAnswers.push({ q, chosenIndex });
  showFeedback(q, chosenIndex);

  btnNext.hidden = false;
  btnSkip.disabled = true;
}

function endSession() {
  show("result");
  scoreEl.textContent = String(score);
  reviewEl.hidden = true;
  reviewEl.innerHTML = "";
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
      <div class="meta">Source : ${q.source || "—"}</div>
    `;
    reviewEl.appendChild(div);
  });
}

btnStart.onclick = async () => {
  await loadQuestions();
  const s = pickSession();
  if (!s) return;

  session = s;
  current = 0;
  score = 0;
  wrongAnswers = [];

  show("quiz");
  renderQuestion();
};

btnSkip.onclick = () => lockAndNext(null);
btnNext.onclick = () => {
  btnNext.hidden = true;
  btnSkip.disabled = false;
  feedbackEl.hidden = true;
  feedbackEl.innerHTML = "";

  current++;
  if (current >= SESSION_SIZE) endSession();
  else renderQuestion();
};
btnRetry.onclick = () => show("home");
btnReview.onclick = () => {
  reviewEl.hidden = !reviewEl.hidden;
  if (!reviewEl.hidden) buildReview();
};

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