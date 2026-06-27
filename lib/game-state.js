// ── Game state ────────────────────────────────────────────────────────────────
const state = {
  phase: 'lobby',       // lobby | question | timer | review | standings | done
  sectionIndex: 0,
  questionIndex: 0,
  timerHandle: null,
  timerRemaining: 30,
  hostSocketId: null,
};

// players[socketId] = { name, answers: [[{answer,correct}×5]×5] }
const players = {};
// disconnected players kept by name so they can rejoin
const disconnected = {};

function createState(quiz) {
  function computeScores() {
    return Object.values(players).map((p) => {
      let score = 0;
      for (const section of p.answers) for (const q of section) if (q.correct) score++;
      return { name: p.name, score };
    }).sort((a, b) => b.score - a.score);
  }

  function currentQuestion() { return quiz[state.sectionIndex]?.questions[state.questionIndex]; }
  function currentSection()  { return quiz[state.sectionIndex]; }

  function stopTimer() {
    if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
  }

  function playerList() { return Object.values(players).map((p) => p.name); }

  function playerStatusList() {
    const online  = Object.values(players).map((p) => ({ name: p.name, online: true }));
    const offline = Object.values(disconnected).map((p) => ({ name: p.name, online: false }));
    return [...online, ...offline].sort((a, b) => a.name.localeCompare(b.name));
  }

  function buildReviewData() {
    const section = quiz[state.sectionIndex];
    return {
      sectionTitle: section.title,
      sectionIndex: state.sectionIndex,
      questions: section.questions.map((q, qi) => ({ text: q.text, answer: q.answer, questionIndex: qi })),
      players: Object.values(players).map((p) => ({ name: p.name, answers: p.answers[state.sectionIndex] })),
    };
  }

  function currentStateSnapshot() {
    const snap = { phase: state.phase, sectionIndex: state.sectionIndex, questionIndex: state.questionIndex };
    if (state.phase === 'question' || state.phase === 'timer') {
      const q = currentQuestion();
      const s = currentSection();
      snap.question = {
        sectionTitle: s.title, sectionIndex: state.sectionIndex, questionIndex: state.questionIndex,
        totalSections: quiz.length, totalQuestions: s.questions.length, questionText: q.text,
      };
      if (state.phase === 'timer') snap.timerRemaining = state.timerRemaining;
    }
    if (state.phase === 'standings') snap.scores = computeScores();
    return snap;
  }

  function hostStateSnapshot() {
    const snap = { phase: state.phase, sectionIndex: state.sectionIndex, questionIndex: state.questionIndex };
    if (state.phase === 'question' || state.phase === 'timer') {
      const q = currentQuestion();
      const s = currentSection();
      snap.question = {
        sectionTitle: s.title, sectionIndex: state.sectionIndex, questionIndex: state.questionIndex,
        totalSections: quiz.length, totalQuestions: s.questions.length,
        questionText: q.text, correctAnswer: q.answer,
      };
      if (state.phase === 'timer') snap.timerRemaining = state.timerRemaining;
    }
    if (state.phase === 'review') snap.review = buildReviewData();
    if (state.phase === 'standings' || state.phase === 'done') {
      snap.scores = computeScores();
      snap.sectionTitle = currentSection()?.title;
      snap.isLast = state.sectionIndex >= quiz.length - 1;
    }
    return snap;
  }

  return {
    state,
    players,
    disconnected,
    quiz,
    computeScores,
    currentQuestion,
    currentSection,
    stopTimer,
    playerList,
    playerStatusList,
    buildReviewData,
    currentStateSnapshot,
    hostStateSnapshot,
  };
}

function gradeAnswer(playerAnswer, correctAnswer) {
  const normalize = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const pa = normalize(playerAnswer);
  const ca = normalize(correctAnswer);
  if (pa === ca) return true;
  return ca.split(' ').some((w) => w === pa);
}

module.exports = { createState, gradeAnswer };
