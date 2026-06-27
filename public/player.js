const socket = io();
let myName = localStorage.getItem('quiz-name') || '';
let joined = false;

// ── Screen management ────────────────────────────────────────────────────────
const screens = ['join','lobby','question','waiting','standings','gameover'];
function show(name) {
  screens.forEach((s) => document.getElementById(`screen-${s}`).classList.add('hidden'));
  document.getElementById(`screen-${name}`).classList.remove('hidden');
}

// ── Elements ─────────────────────────────────────────────────────────────────
const inputName    = document.getElementById('input-name');
const btnJoin      = document.getElementById('btn-join');
const joinError    = document.getElementById('join-error');
const lobbyPlayers = document.getElementById('lobby-players');

const qSectionBadge = document.getElementById('q-section-badge');
const qProgress     = document.getElementById('q-progress');
const qText         = document.getElementById('q-text');
const timerRing     = document.getElementById('timer-ring');
const timerArc      = document.getElementById('timer-arc');
const timerNumber   = document.getElementById('timer-number');
const answerArea    = document.getElementById('answer-area');
const inputAnswer   = document.getElementById('input-answer');
const btnSubmit     = document.getElementById('btn-submit');
const answerSubmitted = document.getElementById('answer-submitted-msg');
const timerWaiting  = document.getElementById('timer-waiting');
const answerLocked  = document.getElementById('answer-locked-msg');

const standingsTitle = document.getElementById('standings-title');
const standingsBody  = document.getElementById('standings-body');
const gameoverBody   = document.getElementById('gameover-body');
const waitingMsg     = document.getElementById('waiting-msg');

// ── Join ─────────────────────────────────────────────────────────────────────
btnJoin.addEventListener('click', () => { unlockAudio(); joinGame(); });
inputName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { unlockAudio(); joinGame(); } });

function joinGame() {
  const name = inputName.value.trim();
  if (!name) return;
  joinError.style.display = 'none';
  socket.emit('join', { name });
}

socket.on('server-hello', ({ sessionId }) => {
  const storedSession = localStorage.getItem('quiz-session');
  if (storedSession !== sessionId) {
    // Server restarted — discard stale identity
    localStorage.removeItem('quiz-name');
    localStorage.removeItem('quiz-session');
    myName = '';
    joined = false;
  }
  localStorage.setItem('quiz-session', sessionId);
  if (myName && !joined) socket.emit('join', { name: myName });
});

socket.on('disconnect', () => { joined = false; });

socket.on('join-ok', ({ name }) => {
  myName = name;
  joined = true;
  localStorage.setItem('quiz-name', name);
  show('lobby');
});

socket.on('rejoin-ok', ({ name, gameState }) => {
  myName = name;
  joined = true;
  localStorage.setItem('quiz-name', name);
  restoreState(gameState);
});

function restoreState(gs) {
  if (gs.phase === 'lobby') { show('lobby'); return; }
  if (gs.phase === 'question' || gs.phase === 'timer') {
    if (gs.question) {
      qSectionBadge.textContent = `Section ${gs.question.sectionIndex + 1}: ${gs.question.sectionTitle}`;
      qProgress.textContent = `Question ${gs.question.questionIndex + 1} of ${gs.question.totalQuestions}`;
      qText.textContent = gs.question.questionText;
    }
    timerRing.classList.add('hidden');
    answerSubmitted.classList.add('hidden');
    answerLocked.classList.add('hidden');
    if (gs.phase === 'timer') {
      timerWaiting.classList.add('hidden');
      answerArea.classList.remove('hidden');
      timerRing.classList.remove('hidden');
      inputAnswer.disabled = false;
      btnSubmit.disabled = false;
      updateTimerDisplay(gs.timerRemaining ?? 30);
    } else {
      timerWaiting.classList.remove('hidden');
      answerArea.classList.add('hidden');
    }
    show('question');
    return;
  }
  if (gs.phase === 'review') { waitingMsg.textContent = 'Waiting for host to review answers...'; show('waiting'); return; }
  if (gs.phase === 'standings' && gs.scores) {
    standingsTitle.textContent = 'Standings';
    standingsBody.innerHTML = gs.scores.map((s, i) =>
      `<tr><td class="rank">${i + 1}</td><td>${s.name}</td><td>${s.score}</td></tr>`
    ).join('');
    show('standings');
    return;
  }
  if (gs.phase === 'done') { show('gameover'); return; }
  waitingMsg.textContent = 'Reconnected — waiting for next event...';
  show('waiting');
}

socket.on('join-error', (msg) => {
  joinError.textContent = msg;
  joinError.style.display = 'block';
});

// ── Lobby ─────────────────────────────────────────────────────────────────────
socket.on('player-list', (names) => {
  lobbyPlayers.innerHTML = names.map((n) => `<span class="player-pill">${n}</span>`).join('');
});

// ── Question ─────────────────────────────────────────────────────────────────
socket.on('show-question', (data) => {
  qSectionBadge.textContent = `Section ${data.sectionIndex + 1}: ${data.sectionTitle}`;
  qProgress.textContent = `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
  qText.textContent = data.questionText;

  timerRing.classList.add('hidden');
  answerArea.classList.add('hidden');
  answerSubmitted.classList.add('hidden');
  answerLocked.classList.add('hidden');
  timerWaiting.classList.remove('hidden');
  inputAnswer.value = '';
  btnSubmit.disabled = false;

  show('question');
});

// ── Timer ─────────────────────────────────────────────────────────────────────
socket.on('timer-start', ({ seconds }) => {
  timerWaiting.classList.add('hidden');
  timerRing.classList.remove('hidden');
  answerArea.classList.remove('hidden');
  answerSubmitted.classList.add('hidden');
  answerLocked.classList.add('hidden');
  inputAnswer.disabled = false;
  btnSubmit.disabled = false;
  updateTimerDisplay(seconds);
});

socket.on('timer-tick', ({ remaining }) => {
  updateTimerDisplay(remaining);
  if (remaining <= 5 && remaining > 0) playTick();
});

function updateTimerDisplay(remaining) {
  updateTimerRing(timerArc, timerNumber, remaining);
}

// ── Submit answer ─────────────────────────────────────────────────────────────
btnSubmit.addEventListener('click', submitAnswer);
inputAnswer.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAnswer(); });

function submitAnswer() {
  const answer = inputAnswer.value.trim();
  if (!answer) return;
  socket.emit('submit-answer', { answer });
}

socket.on('answer-ack', ({ answer }) => {
  inputAnswer.value = answer;
  answerSubmitted.classList.remove('hidden');
});

// ── Question ended (timer stopped) ───────────────────────────────────────────
socket.on('question-ended', () => {
  playBell();
  timerRing.classList.add('hidden');
  timerWaiting.classList.add('hidden');
  inputAnswer.disabled = true;
  btnSubmit.disabled = true;
  answerLocked.classList.remove('hidden');
  answerSubmitted.classList.add('hidden');
});

// ── Waiting ───────────────────────────────────────────────────────────────────
socket.on('show-waiting', ({ message }) => {
  waitingMsg.textContent = message;
  show('waiting');
});

// ── Standings ─────────────────────────────────────────────────────────────────
socket.on('show-standings', ({ scores, sectionTitle, isLast }) => {
  standingsTitle.textContent = `Standings after: ${sectionTitle}`;
  standingsBody.innerHTML = scores.map((s, i) =>
    `<tr><td class="rank">${i + 1}</td><td>${s.name}</td><td>${s.score}</td></tr>`
  ).join('');
  show('standings');
});

// ── Game over ─────────────────────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  localStorage.removeItem('quiz-name');
  gameoverBody.innerHTML = scores.map((s, i) =>
    `<tr><td class="rank">${i + 1}</td><td>${s.name}</td><td>${s.score}</td></tr>`
  ).join('');
  show('gameover');
});
