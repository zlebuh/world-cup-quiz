const { gradeAnswer } = require('./game-state');

function registerSocketHandlers(io, game) {
  const { state, players, disconnected, quiz, computeScores, currentQuestion, currentSection,
    stopTimer, playerList, playerStatusList, buildReviewData, currentStateSnapshot, hostStateSnapshot,
  } = game;

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

  io.on('connection', (socket) => {
    socket.emit('server-hello', { sessionId: game.sessionId });

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
      const submitted = Object.values(players).filter(
        (p) => p.answers[state.sectionIndex][state.questionIndex].answer !== ''
      ).length;
      io.to('host').emit('answer-count', { submitted, total: Object.keys(players).length });
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
}

module.exports = { registerSocketHandlers };
