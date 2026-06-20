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

const PORT = 3000;
const SESSION_ID = require('crypto').randomUUID();
const quiz = loadQuiz(path.join(__dirname, 'quiz.md'));

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

function computeScores() {
  return Object.values(players).map((p) => {
    let score = 0;
    for (const section of p.answers) {
      for (const q of section) {
        if (q.correct) score++;
      }
    }
    return { name: p.name, score };
  }).sort((a, b) => b.score - a.score);
}

function currentQuestion() {
  return quiz[state.sectionIndex]?.questions[state.questionIndex];
}

function currentSection() {
  return quiz[state.sectionIndex];
}

function stopTimer() {
  if (state.timerHandle) {
    clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
}

function gradeAnswer(playerAnswer, correctAnswer) {
  const normalize = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const pa = normalize(playerAnswer);
  const ca = normalize(correctAnswer);
  if (pa === ca) return true;
  // Accept if the correct answer contains the player's answer as a whole word (e.g. last name)
  const words = ca.split(' ');
  return words.some((w) => w === pa);
}

// ── HTTP routes ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/qr', async (req, res) => {
  const ip = getLocalIp();
  const url = `http://${ip}:${PORT}`;
  const svg = await QRCode.toString(url, { type: 'svg' });
  res.type('image/svg+xml').send(svg);
});

app.get('/local-ip', (req, res) => {
  res.json({ ip: getLocalIp(), port: PORT });
});

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('server-hello', { sessionId: SESSION_ID });
  // ── Player joins / rejoins ──
  socket.on('join', ({ name }) => {
    const trimmed = name.trim();
    if (!trimmed) { socket.emit('join-error', 'Name cannot be empty.'); return; }

    const key = trimmed.toLowerCase();

    // Rejoin: moved to disconnected map
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

    if (state.phase !== 'lobby') {
      socket.emit('join-error', 'Game already started.');
      return;
    }

    if (Object.values(players).some((p) => p.name.toLowerCase() === key)) {
      socket.emit('join-error', 'Name already taken.');
      return;
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
      state: publicState(),
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
      if (state.timerRemaining <= 0) {
        stopTimer();
        endQuestion();
      }
    }, 1000);
  });

  // ── Host: stop timer early ──
  socket.on('stop-timer', () => {
    if (socket.id !== state.hostSocketId) return;
    stopTimer();
    endQuestion();
  });

  // ── Host: next question ──
  socket.on('next-question', () => {
    if (socket.id !== state.hostSocketId) return;
    state.questionIndex++;
    if (state.questionIndex >= quiz[state.sectionIndex].questions.length) {
      // All questions done — go to review
      state.phase = 'review';
      const reviewData = buildReviewData();
      socket.emit('show-review', reviewData);
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
    const correctAnswer = quiz[sectionIdx].questions[questionIdx].answer;
    const correct = gradeAnswer(newAnswer, correctAnswer);
    player.answers[sectionIdx][questionIdx] = { answer: newAnswer, correct };
    socket.emit('answer-updated', { playerName, sectionIdx, questionIdx, answer: newAnswer, correct });
  });

  // ── Host: override correct flag directly ──
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

  // ── Host: confirm review, show standings ──
  socket.on('confirm-review', () => {
    if (socket.id !== state.hostSocketId) return;
    state.phase = 'standings';
    const scores = computeScores();
    const isLast = state.sectionIndex >= quiz.length - 1;
    io.emit('show-standings', { scores, sectionTitle: currentSection().title, isLast });
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
function playerList() {
  return Object.values(players).map((p) => p.name);
}

function playerStatusList() {
  const online = Object.values(players).map((p) => ({ name: p.name, online: true }));
  const offline = Object.values(disconnected).map((p) => ({ name: p.name, online: false }));
  return [...online, ...offline].sort((a, b) => a.name.localeCompare(b.name));
}

function publicState() {
  return {
    phase: state.phase,
    sectionIndex: state.sectionIndex,
    questionIndex: state.questionIndex,
  };
}

function emitQuestion() {
  const q = currentQuestion();
  const s = currentSection();
  // Send correct answer only to host; players get a separate event without it
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
  state.phase = 'question'; // waiting for host to click next
  io.emit('question-ended');
}

function currentStateSnapshot() {
  const snap = { phase: state.phase, sectionIndex: state.sectionIndex, questionIndex: state.questionIndex };
  if (state.phase === 'question' || state.phase === 'timer') {
    const q = currentQuestion();
    const s = currentSection();
    snap.question = {
      sectionTitle: s.title,
      sectionIndex: state.sectionIndex,
      questionIndex: state.questionIndex,
      totalSections: quiz.length,
      totalQuestions: s.questions.length,
      questionText: q.text,
    };
    if (state.phase === 'timer') snap.timerRemaining = state.timerRemaining;
  }
  if (state.phase === 'standings') snap.scores = computeScores();
  return snap;
}

function buildReviewData() {
  const section = quiz[state.sectionIndex];
  return {
    sectionTitle: section.title,
    sectionIndex: state.sectionIndex,
    questions: section.questions.map((q, qi) => ({
      text: q.text,
      answer: q.answer,
      questionIndex: qi,
    })),
    players: Object.values(players).map((p) => ({
      name: p.name,
      answers: p.answers[state.sectionIndex],
    })),
  };
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz server running at http://localhost:${PORT}`);
  console.log(`Host panel: http://localhost:${PORT}/host`);
  console.log(`Local IP: ${getLocalIp()}`);
  console.log('Press Ctrl+C to stop.');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopTimer();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});
