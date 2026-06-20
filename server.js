const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');
const path = require('path');
const { loadQuiz } = require('./quiz-loader');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || null;
const SESSION_ID = require('crypto').randomUUID();

const theme = require('./config/theme.json');
const quiz  = loadQuiz(path.join(__dirname, 'config', 'quiz.md'));

// ── Game state ──────────────────────────────────────────────────────────────
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

function getLocalIp() {
  const preferred = [/^192\.168\./, /^10\./];
  const fallback  = [/^172\.(1[6-9]|2\d|3[01])\./];
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal);
  return (
    all.find((i) => preferred.some((r) => r.test(i.address)))?.address ||
    all.find((i) => fallback.some((r) => r.test(i.address)))?.address ||
    '127.0.0.1'
  );
}

function getPublicUrl() {
  return PUBLIC_URL || `http://${getLocalIp()}:${PORT}`;
}

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

function gradeAnswer(playerAnswer, correctAnswer) {
  const normalize = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const pa = normalize(playerAnswer);
  const ca = normalize(correctAnswer);
  if (pa === ca) return true;
  return ca.split(' ').some((w) => w === pa);
}

// ── HTTP routes ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// Theme as CSS custom properties — linked from HTML
app.get('/custom.css', (req, res) => {
  res.type('text/css').sendFile(path.join(__dirname, 'config', 'custom.css'));
});

app.get('/theme.css', (req, res) => {
  const c = theme.colors;
  res.type('text/css').send(`
:root {
  --accent:   ${c.accent};
  --green:    ${c.primary};
  --red:      ${c.danger};
  --bg:       ${c.bg};
  --surface:  ${c.surface};
  --surface2: ${c.surface2};
  --text:     ${c.text};
  --muted:    ${c.muted};
  --gold:     ${c.accent};
}`.trim());
});

// Theme metadata for JS
app.get('/api/theme', (req, res) => res.json({
  title: theme.title,
  subtitle: theme.subtitle,
  emoji: theme.emoji,
}));

app.get('/qr', async (req, res) => {
  const svg = await QRCode.toString(getPublicUrl(), { type: 'svg' });
  res.type('image/svg+xml').send(svg);
});

app.get('/api/join-url', (req, res) => res.json({ url: getPublicUrl() }));

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('server-hello', { sessionId: SESSION_ID });

  // ── Player joins / rejoins ──
  socket.on('join', ({ name }) => {
    const trimmed = name.trim();
    if (!trimmed) { socket.emit('join-error', 'Name cannot be empty.'); return; }
    const key = trimmed.toLowerCase();

    if (disconnected[key]) {
      const data = disconnected[key];
      delete disconnected[key];
      players[socket.id] = data;
      socket.join('players');
      socket.emit('rejoin-ok', { name: data.name, gameState: currentStateSnapshot() });
      io.emit('player-list', playerList());
      io.to('host').emit('player-status', playerStatusList());
      return;
    }

    if (state.phase !== 'lobby') { socket.emit('join-error', 'Game already started.'); return; }
    if (Object.values(players).some((p) => p.name.toLowerCase() === key)) {
      socket.emit('join-error', 'Name already taken.'); return;
    }

    players[socket.id] = { name: trimmed, answers: quiz.map((s) => s.questions.map(() => ({ answer: '', correct: false }))) };
    socket.join('players');
    socket.emit('join-ok', { name: trimmed });
    io.emit('player-list', playerList());
    io.to('host').emit('player-status', playerStatusList());
  });

  // ── Host registers ──
  socket.on('host-connect', () => {
    state.hostSocketId = socket.id;
    socket.join('host');
    socket.emit('host-ok', {
      sections: quiz.map((s) => s.title),
      playerList: playerList(),
      playerStatus: playerStatusList(),
      snapshot: hostStateSnapshot(),
    });
  });

  // ── Host: start section ──
  socket.on('start-section', () => {
    if (socket.id !== state.hostSocketId) return;
    if (Object.keys(players).length === 0) return;
    state.phase = 'question';
    state.questionIndex = 0;
    emitQuestion();
  });

  // ── Host: start timer ──
  socket.on('start-timer', () => {
    if (socket.id !== state.hostSocketId) return;
    if (state.phase !== 'question') return;
    state.phase = 'timer';
    state.timerRemaining = 30;
    io.emit('timer-start', { seconds: 30 });
    state.timerHandle = setInterval(() => {
      state.timerRemaining--;
      io.emit('timer-tick', { remaining: state.timerRemaining });
      if (state.timerRemaining <= 0) { stopTimer(); endQuestion(); }
    }, 1000);
  });

  // ── Host: stop timer early ──
  socket.on('stop-timer', () => {
    if (socket.id !== state.hostSocketId) return;
    stopTimer(); endQuestion();
  });

  // ── Host: next question ──
  socket.on('next-question', () => {
    if (socket.id !== state.hostSocketId) return;
    state.questionIndex++;
    if (state.questionIndex >= quiz[state.sectionIndex].questions.length) {
      state.phase = 'review';
      socket.emit('show-review', buildReviewData());
      io.to('players').emit('show-waiting', { message: 'Waiting for host to review answers...' });
    } else {
      state.phase = 'question';
      emitQuestion();
    }
  });

  // ── Host: edit answer ──
  socket.on('edit-answer', ({ playerName, sectionIdx, questionIdx, newAnswer }) => {
    if (socket.id !== state.hostSocketId) return;
    const player = Object.values(players).find((p) => p.name === playerName);
    if (!player) return;
    const correct = gradeAnswer(newAnswer, quiz[sectionIdx].questions[questionIdx].answer);
    player.answers[sectionIdx][questionIdx] = { answer: newAnswer, correct };
    socket.emit('answer-updated', { playerName, sectionIdx, questionIdx, answer: newAnswer, correct });
  });

  // ── Host: override correct flag ──
  socket.on('override-correct', ({ playerName, sectionIdx, questionIdx, correct }) => {
    if (socket.id !== state.hostSocketId) return;
    const player = Object.values(players).find((p) => p.name === playerName);
    if (!player) return;
    player.answers[sectionIdx][questionIdx].correct = correct;
    socket.emit('answer-updated', {
      playerName, sectionIdx, questionIdx,
      answer: player.answers[sectionIdx][questionIdx].answer,
      correct,
    });
  });

  // ── Host: confirm review → show standings ──
  socket.on('confirm-review', () => {
    if (socket.id !== state.hostSocketId) return;
    state.phase = 'standings';
    io.emit('show-standings', { scores: computeScores(), sectionTitle: currentSection().title, isLast: state.sectionIndex >= quiz.length - 1 });
  });

  // ── Host: next section ──
  socket.on('next-section', () => {
    if (socket.id !== state.hostSocketId) return;
    state.sectionIndex++;
    if (state.sectionIndex >= quiz.length) {
      state.phase = 'done';
      io.emit('game-over', { scores: computeScores() });
    } else {
      state.phase = 'question';
      state.questionIndex = 0;
      emitQuestion();
    }
  });

  // ── Player: submit answer ──
  socket.on('submit-answer', ({ answer }) => {
    if (state.phase !== 'timer') return;
    const player = players[socket.id];
    if (!player) return;
    const correct = gradeAnswer(answer, currentQuestion().answer);
    player.answers[state.sectionIndex][state.questionIndex] = { answer, correct };
    socket.emit('answer-ack', { answer });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      const data = players[socket.id];
      disconnected[data.name.toLowerCase()] = data;
      delete players[socket.id];
      io.emit('player-list', playerList());
      io.to('host').emit('player-status', playerStatusList());
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function playerList() { return Object.values(players).map((p) => p.name); }

function playerStatusList() {
  const online  = Object.values(players).map((p) => ({ name: p.name, online: true }));
  const offline = Object.values(disconnected).map((p) => ({ name: p.name, online: false }));
  return [...online, ...offline].sort((a, b) => a.name.localeCompare(b.name));
}

function publicState() {
  return { phase: state.phase, sectionIndex: state.sectionIndex, questionIndex: state.questionIndex };
}

function emitQuestion() {
  const q = currentQuestion();
  const s = currentSection();
  const base = {
    sectionTitle: s.title,
    sectionIndex: state.sectionIndex,
    questionIndex: state.questionIndex,
    totalSections: quiz.length,
    totalQuestions: s.questions.length,
    questionText: q.text,
  };
  io.to('host').emit('show-question', { ...base, correctAnswer: q.answer });
  io.to('players').emit('show-question', base);
}

function endQuestion() {
  state.phase = 'question';
  io.emit('question-ended');
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

function buildReviewData() {
  const section = quiz[state.sectionIndex];
  return {
    sectionTitle: section.title,
    sectionIndex: state.sectionIndex,
    questions: section.questions.map((q, qi) => ({ text: q.text, answer: q.answer, questionIndex: qi })),
    players: Object.values(players).map((p) => ({ name: p.name, answers: p.answers[state.sectionIndex] })),
  };
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Quiz server ready`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Host:    http://localhost:${PORT}/host`);
  if (PUBLIC_URL) console.log(`  Public:  ${PUBLIC_URL}`);
  else console.log(`  Network: ${getPublicUrl()}`);
  console.log('\n  Press Ctrl+C to stop.\n');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopTimer();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});
