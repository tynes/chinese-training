// === State & Persistence ===

const STORAGE_KEY = "chinese-training";
const NEW_CARDS_PER_SESSION = 10;

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      // corrupted, start fresh
    }
  }
  return {
    cards: {},
    stats: { totalReviews: 0, streak: 0, lastReviewDate: null },
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getCardProgress(id) {
  if (!state.cards[id]) {
    state.cards[id] = {
      id,
      interval: 0,
      easeFactor: 2.5,
      repetitions: 0,
      nextReviewDate: null,
      status: "new",
    };
  }
  return state.cards[id];
}

let state = loadState();

// === Theme ===

function initTheme() {
  const saved = localStorage.getItem("chinese-training-theme");
  if (saved) {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("chinese-training-theme", next);
}

initTheme();
document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

// === Reset ===

document.getElementById("reset-btn").addEventListener("click", () => {
  if (confirm("Reset all progress? This cannot be undone.")) {
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    showView("dashboard");
  }
});

// === Navigation ===

let currentView = "dashboard";

function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  document.querySelector(`.nav-btn[data-view="${name}"]`).classList.add("active");

  switch (name) {
    case "dashboard":
      updateDashboard();
      break;
    case "flashcards":
      initFlashcards();
      break;
    case "reading":
      initReading();
      break;
    case "writing":
      initWriting();
      break;
    case "listening":
      initListening();
      break;
  }
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.querySelectorAll(".quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.mode));
});

// === SM-2 Algorithm ===

function rateSM2(card, rating) {
  // rating: "again" | "hard" | "good" | "easy"
  const qualityMap = { again: 1, hard: 3, good: 4, easy: 5 };
  const quality = qualityMap[rating];

  if (quality < 3) {
    // Reset
    card.repetitions = 0;
    card.interval = 0;
    card.status = "learning";
    card.nextReviewDate = getToday();
  } else {
    card.repetitions += 1;

    if (card.repetitions === 1) {
      card.interval = 1;
    } else if (card.repetitions === 2) {
      card.interval = 6;
    } else {
      card.interval = Math.round(card.interval * card.easeFactor);
    }

    // Update ease factor
    card.easeFactor += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    if (card.easeFactor < 1.3) card.easeFactor = 1.3;

    card.status = "review";
    const next = new Date();
    next.setDate(next.getDate() + card.interval);
    card.nextReviewDate = next.toISOString().slice(0, 10);
  }

  // Update stats
  state.stats.totalReviews += 1;
  const today = getToday();
  if (state.stats.lastReviewDate !== today) {
    if (
      state.stats.lastReviewDate &&
      daysBetween(state.stats.lastReviewDate, today) === 1
    ) {
      state.stats.streak += 1;
    } else if (state.stats.lastReviewDate !== today) {
      state.stats.streak = 1;
    }
    state.stats.lastReviewDate = today;
  }

  saveState();
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1 + "T00:00:00");
  const d2 = new Date(dateStr2 + "T00:00:00");
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

// === Text-to-Speech ===

let chineseVoice = null;
let ttsAvailable = false;

function initTTS() {
  if (!window.speechSynthesis) {
    document.getElementById("tts-warning").classList.remove("hidden");
    return;
  }

  function findVoice() {
    const voices = speechSynthesis.getVoices();
    chineseVoice =
      voices.find((v) => v.lang === "zh-CN") ||
      voices.find((v) => v.lang.startsWith("zh")) ||
      null;
    ttsAvailable = chineseVoice !== null;
    if (!ttsAvailable && voices.length > 0) {
      document.getElementById("tts-warning").classList.remove("hidden");
    } else if (ttsAvailable) {
      document.getElementById("tts-warning").classList.add("hidden");
    }
  }

  findVoice();
  speechSynthesis.addEventListener("voiceschanged", findVoice);
}

function speak(text) {
  if (!ttsAvailable) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = chineseVoice;
  utterance.lang = "zh-CN";
  utterance.rate = 0.85;
  speechSynthesis.speak(utterance);
}

initTTS();

// === Distractor Generation ===

function getDistractors(correctWord, count, field) {
  const pool = VOCABULARY.filter((w) => w.id !== correctWord.id);
  const distractors = [];
  const usedIds = new Set([correctWord.id]);

  // 1 from same category
  const sameCategory = pool.filter(
    (w) => w.category === correctWord.category && !usedIds.has(w.id)
  );
  if (sameCategory.length > 0) {
    const pick = sameCategory[Math.floor(Math.random() * sameCategory.length)];
    distractors.push(pick);
    usedIds.add(pick.id);
  }

  // Fill from same HSK level
  const sameHsk = pool.filter(
    (w) => w.hsk === correctWord.hsk && !usedIds.has(w.id)
  );
  shuffleArray(sameHsk);
  while (distractors.length < count && sameHsk.length > 0) {
    const pick = sameHsk.pop();
    // Ensure unique display values
    if (!distractors.some((d) => d[field] === pick[field]) && pick[field] !== correctWord[field]) {
      distractors.push(pick);
      usedIds.add(pick.id);
    }
  }

  // Fill from any
  const any = pool.filter((w) => !usedIds.has(w.id));
  shuffleArray(any);
  while (distractors.length < count && any.length > 0) {
    const pick = any.pop();
    if (!distractors.some((d) => d[field] === pick[field]) && pick[field] !== correctWord[field]) {
      distractors.push(pick);
      usedIds.add(pick.id);
    }
  }

  return distractors.slice(0, count);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// === Dashboard ===

function updateDashboard() {
  const today = getToday();
  let learned = 0;
  let due = 0;
  let hsk1Learned = 0;
  let hsk2Learned = 0;
  const hsk1Total = VOCABULARY.filter((w) => w.hsk === 1).length;
  const hsk2Total = VOCABULARY.filter((w) => w.hsk === 2).length;

  for (const word of VOCABULARY) {
    const card = state.cards[word.id];
    if (card && card.status !== "new") {
      learned++;
      if (word.hsk === 1) hsk1Learned++;
      if (word.hsk === 2) hsk2Learned++;
    }
    if (card && card.nextReviewDate && card.nextReviewDate <= today) {
      due++;
    }
  }

  // Count new cards as due (up to session limit)
  const newAvailable = VOCABULARY.filter((w) => !state.cards[w.id] || state.cards[w.id].status === "new").length;
  due += Math.min(newAvailable, NEW_CARDS_PER_SESSION);

  document.getElementById("stat-learned").textContent = learned;
  document.getElementById("stat-due").textContent = due;
  document.getElementById("stat-streak").textContent = state.stats.streak;
  document.getElementById("stat-reviews").textContent = state.stats.totalReviews;

  document.getElementById("hsk1-count").textContent = `${hsk1Learned} / ${hsk1Total}`;
  document.getElementById("hsk1-progress").style.width =
    hsk1Total > 0 ? `${(hsk1Learned / hsk1Total) * 100}%` : "0%";

  document.getElementById("hsk2-count").textContent = `${hsk2Learned} / ${hsk2Total}`;
  document.getElementById("hsk2-progress").style.width =
    hsk2Total > 0 ? `${(hsk2Learned / hsk2Total) * 100}%` : "0%";
}

// === Flashcards Mode ===

let fcQueue = [];
let fcIndex = 0;

function initFlashcards() {
  const today = getToday();

  // Learning cards first
  const learning = [];
  const dueReviews = [];
  const newCards = [];

  for (const word of VOCABULARY) {
    const card = getCardProgress(word.id);
    if (card.status === "learning") {
      learning.push(word);
    } else if (card.nextReviewDate && card.nextReviewDate <= today && card.status === "review") {
      dueReviews.push(word);
    } else if (card.status === "new") {
      newCards.push(word);
    }
  }

  shuffleArray(learning);
  shuffleArray(dueReviews);
  shuffleArray(newCards);

  fcQueue = [...learning, ...dueReviews, ...newCards.slice(0, NEW_CARDS_PER_SESSION)];
  fcIndex = 0;

  if (fcQueue.length === 0) {
    document.getElementById("fc-card").classList.add("hidden");
    document.getElementById("fc-empty").classList.remove("hidden");
  } else {
    document.getElementById("fc-card").classList.remove("hidden");
    document.getElementById("fc-empty").classList.add("hidden");
    showFlashcard();
  }

  updateFcProgress();
}

function showFlashcard() {
  if (fcIndex >= fcQueue.length) {
    document.getElementById("fc-card").classList.add("hidden");
    document.getElementById("fc-empty").classList.remove("hidden");
    document.getElementById("fc-empty").innerHTML =
      "<p>Session complete!</p><p>Great work. Come back later for more reviews.</p>";
    return;
  }

  const word = fcQueue[fcIndex];
  document.getElementById("fc-chinese").textContent = word.chinese;
  document.getElementById("fc-pinyin").textContent = word.pinyin;
  document.getElementById("fc-english").textContent = word.english;

  document.getElementById("fc-back").classList.add("hidden");
  document.getElementById("fc-show").classList.remove("hidden");
  document.getElementById("fc-ratings").classList.add("hidden");

  updateFcProgress();
}

function updateFcProgress() {
  document.getElementById("fc-progress").textContent =
    `${Math.min(fcIndex + 1, fcQueue.length)} / ${fcQueue.length}`;
}

document.getElementById("fc-show").addEventListener("click", () => {
  document.getElementById("fc-back").classList.remove("hidden");
  document.getElementById("fc-show").classList.add("hidden");
  document.getElementById("fc-ratings").classList.remove("hidden");
});

document.getElementById("fc-speak").addEventListener("click", () => {
  if (fcIndex < fcQueue.length) speak(fcQueue[fcIndex].chinese);
});

document.getElementById("fc-ratings").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-rating]");
  if (!btn) return;

  const word = fcQueue[fcIndex];
  const card = getCardProgress(word.id);
  rateSM2(card, btn.dataset.rating);

  fcIndex++;
  showFlashcard();
});

// === Quiz Helpers ===

function createChoiceButtons(container, choices, correctId, displayField, cssClass, onAnswer) {
  container.innerHTML = "";
  let answered = false;

  choices.forEach((choice, index) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn" + (cssClass ? " " + cssClass : "");
    btn.textContent = choice[displayField];
    btn.dataset.index = index + 1;

    btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;

      const isCorrect = choice.id === correctId;

      // Highlight all buttons
      container.querySelectorAll(".choice-btn").forEach((b) => {
        b.classList.add("disabled");
        const bChoice = choices[parseInt(b.dataset.index) - 1];
        if (bChoice.id === correctId) {
          b.classList.add("correct");
        }
      });

      if (!isCorrect) {
        btn.classList.add("incorrect");
      }

      onAnswer(isCorrect, choice);
    });

    container.appendChild(btn);
  });
}

function buildQuizChoices(correctWord, field) {
  const distractors = getDistractors(correctWord, 3, field);
  const choices = [correctWord, ...distractors];
  return shuffleArray(choices);
}

// === Reading Mode ===

let rdWords = [];
let rdIndex = 0;
let rdCorrect = 0;
let rdTotal = 0;

function initReading() {
  rdWords = shuffleArray([...VOCABULARY]);
  rdIndex = 0;
  rdCorrect = 0;
  rdTotal = 0;
  showReadingQuestion();
}

function showReadingQuestion() {
  if (rdIndex >= rdWords.length) rdIndex = 0;
  const word = rdWords[rdIndex];

  document.getElementById("rd-chinese").textContent = word.chinese;
  document.getElementById("rd-feedback").classList.add("hidden");
  document.getElementById("rd-feedback").className = "quiz-feedback hidden";
  document.getElementById("rd-next").classList.add("hidden");

  const choices = buildQuizChoices(word, "english");
  createChoiceButtons(
    document.getElementById("rd-choices"),
    choices,
    word.id,
    "english",
    "",
    (isCorrect) => {
      rdTotal++;
      if (isCorrect) rdCorrect++;

      const feedback = document.getElementById("rd-feedback");
      feedback.classList.remove("hidden");
      feedback.className = "quiz-feedback " + (isCorrect ? "correct" : "incorrect");
      feedback.textContent = isCorrect
        ? "Correct!"
        : `Incorrect. The answer is: ${word.english}`;

      document.getElementById("rd-next").classList.remove("hidden");
      updateRdScore();
    }
  );

  updateRdScore();
}

function updateRdScore() {
  document.getElementById("rd-score").textContent = `${rdCorrect} / ${rdTotal}`;
}

document.getElementById("rd-speak").addEventListener("click", () => {
  if (rdIndex < rdWords.length) speak(rdWords[rdIndex].chinese);
});

document.getElementById("rd-next").addEventListener("click", () => {
  rdIndex++;
  showReadingQuestion();
});

// === Writing Mode ===

let wrWords = [];
let wrIndex = 0;
let wrCorrect = 0;
let wrTotal = 0;

function initWriting() {
  wrWords = shuffleArray([...VOCABULARY]);
  wrIndex = 0;
  wrCorrect = 0;
  wrTotal = 0;
  showWritingQuestion();
}

function showWritingQuestion() {
  if (wrIndex >= wrWords.length) wrIndex = 0;
  const word = wrWords[wrIndex];

  document.getElementById("wr-english").textContent = word.english;
  document.getElementById("wr-feedback").classList.add("hidden");
  document.getElementById("wr-feedback").className = "quiz-feedback hidden";
  document.getElementById("wr-pinyin").textContent = "";
  document.getElementById("wr-next").classList.add("hidden");

  const choices = buildQuizChoices(word, "chinese");
  createChoiceButtons(
    document.getElementById("wr-choices"),
    choices,
    word.id,
    "chinese",
    "chinese",
    (isCorrect) => {
      wrTotal++;
      if (isCorrect) wrCorrect++;

      const feedback = document.getElementById("wr-feedback");
      feedback.classList.remove("hidden");
      feedback.className = "quiz-feedback " + (isCorrect ? "correct" : "incorrect");
      feedback.innerHTML = isCorrect
        ? "Correct!"
        : `Incorrect. The answer is: ${word.chinese}`;

      document.getElementById("wr-pinyin").textContent = word.pinyin;

      speak(word.chinese);

      document.getElementById("wr-next").classList.remove("hidden");
      updateWrScore();
    }
  );

  updateWrScore();
}

function updateWrScore() {
  document.getElementById("wr-score").textContent = `${wrCorrect} / ${wrTotal}`;
}

document.getElementById("wr-next").addEventListener("click", () => {
  wrIndex++;
  showWritingQuestion();
});

// === Listening Mode ===

let lsWords = [];
let lsIndex = 0;
let lsCorrect = 0;
let lsTotal = 0;

function initListening() {
  lsWords = shuffleArray([...VOCABULARY]);
  lsIndex = 0;
  lsCorrect = 0;
  lsTotal = 0;
  showListeningQuestion();
}

function showListeningQuestion() {
  if (lsIndex >= lsWords.length) lsIndex = 0;
  const word = lsWords[lsIndex];

  document.getElementById("ls-feedback").classList.add("hidden");
  document.getElementById("ls-feedback").className = "quiz-feedback hidden";
  document.getElementById("ls-next").classList.add("hidden");

  const hint = document.getElementById("ls-hint");
  if (!ttsAvailable) {
    hint.classList.remove("hidden");
    hint.textContent = word.chinese;
  } else {
    hint.classList.add("hidden");
    // Auto-play
    setTimeout(() => speak(word.chinese), 300);
  }

  const choices = buildQuizChoices(word, "chinese");
  createChoiceButtons(
    document.getElementById("ls-choices"),
    choices,
    word.id,
    "chinese",
    "chinese",
    (isCorrect) => {
      lsTotal++;
      if (isCorrect) lsCorrect++;

      const feedback = document.getElementById("ls-feedback");
      feedback.classList.remove("hidden");
      feedback.className = "quiz-feedback " + (isCorrect ? "correct" : "incorrect");
      feedback.textContent = isCorrect
        ? "Correct!"
        : `Incorrect. The answer is: ${word.chinese} (${word.pinyin})`;

      document.getElementById("ls-next").classList.remove("hidden");
      updateLsScore();
    }
  );

  updateLsScore();
}

function updateLsScore() {
  document.getElementById("ls-score").textContent = `${lsCorrect} / ${lsTotal}`;
}

document.getElementById("ls-speak").addEventListener("click", () => {
  if (lsIndex < lsWords.length) speak(lsWords[lsIndex].chinese);
});

document.getElementById("ls-next").addEventListener("click", () => {
  lsIndex++;
  showListeningQuestion();
});

// === Keyboard Shortcuts ===

document.addEventListener("keydown", (e) => {
  // Ignore if user is typing in an input
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  const key = e.key.toLowerCase();

  if (currentView === "flashcards") {
    if (key === " " || key === "spacebar") {
      e.preventDefault();
      const showBtn = document.getElementById("fc-show");
      if (!showBtn.classList.contains("hidden")) {
        showBtn.click();
      } else {
        // Replay audio
        if (fcIndex < fcQueue.length) speak(fcQueue[fcIndex].chinese);
      }
    }
    if (key >= "1" && key <= "4") {
      const ratings = document.getElementById("fc-ratings");
      if (!ratings.classList.contains("hidden")) {
        const btns = ratings.querySelectorAll("[data-rating]");
        const idx = parseInt(key) - 1;
        if (btns[idx]) btns[idx].click();
      }
    }
  }

  if (currentView === "reading") {
    if (key === " " || key === "spacebar") {
      e.preventDefault();
      if (rdIndex < rdWords.length) speak(rdWords[rdIndex].chinese);
    }
    if (key >= "1" && key <= "4") {
      const btns = document.getElementById("rd-choices").querySelectorAll(".choice-btn:not(.disabled)");
      const idx = parseInt(key) - 1;
      if (btns[idx]) btns[idx].click();
    }
    if (key === "n") {
      const nextBtn = document.getElementById("rd-next");
      if (!nextBtn.classList.contains("hidden")) nextBtn.click();
    }
  }

  if (currentView === "writing") {
    if (key >= "1" && key <= "4") {
      const btns = document.getElementById("wr-choices").querySelectorAll(".choice-btn:not(.disabled)");
      const idx = parseInt(key) - 1;
      if (btns[idx]) btns[idx].click();
    }
    if (key === "n") {
      const nextBtn = document.getElementById("wr-next");
      if (!nextBtn.classList.contains("hidden")) nextBtn.click();
    }
  }

  if (currentView === "listening") {
    if (key === " " || key === "spacebar") {
      e.preventDefault();
      document.getElementById("ls-speak").click();
    }
    if (key >= "1" && key <= "4") {
      const btns = document.getElementById("ls-choices").querySelectorAll(".choice-btn:not(.disabled)");
      const idx = parseInt(key) - 1;
      if (btns[idx]) btns[idx].click();
    }
    if (key === "n") {
      const nextBtn = document.getElementById("ls-next");
      if (!nextBtn.classList.contains("hidden")) nextBtn.click();
    }
  }
});

// === Init ===

showView("dashboard");
