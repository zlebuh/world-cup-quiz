const socket = io();

// ── Screen management ────────────────────────────────────────────────────────
const screens = ['lobby','question','review','standings','gameover'];
const playerStatusBar = document.querySelector('.player-status-bar');

function show(name) {
  screens.forEach((s) => document.getElementById(`screen-${s}`).classList.add('hidden'));
  document.getElementById(`screen-${name}`).classList.remove('hidden');
  playerStatusBar.classList.toggle('hidden', name === 'lobby');
}
function setPhase(label) {
  document.getElementById('phase-label').textContent = label;
}

// ── Elements ─────────────────────────────────────────────────────────────────
const btnStartGame   = document.getElementById('btn-start-game');
const btnStartTimer  = document.getElementById('btn-start-timer');
const btnStopTimer   = document.getElementById('btn-stop-timer');
const btnNextQ       = document.getElementById('btn-next-question');
const btnConfirm     = document.getElementById('btn-confirm-review');
const btnNextSection = document.getElementById('btn-next-section');

const hSectionBadge = document.getElementById('h-section-badge');
const hProgress     = document.getElementById('h-progress');
const hQtext        = document.getElementById('h-qtext');
const hAnswerCount  = document.getElementById('h-answer-count');
const hTimerRing    = document.getElementById('h-timer-ring');
const hTimerArc     = document.getElementById('h-timer-arc');
const hTimerNumber  = document.getElementById('h-timer-number');
const hAfterTimer   = document.getElementById('h-after-timer');

const reviewTitle   = document.getElementById('review-title');
const reviewHead    = document.getElementById('review-head');
const reviewBody    = document.getElementById('review-body');

const hStandingsTitle = document.getElementById('h-standings-title');
const hStandingsBody  = document.getElementById('h-standings-body');
const hGameoverBody   = document.getElementById('h-gameover-body');

// ── State ─────────────────────────────────────────────────────────────────────
let reviewData = null; // cached review payload for re-renders

// ── Init ──────────────────────────────────────────────────────────────────────
socket.emit('host-connect');

const playerStatusChips = document.getElementById('player-status-chips');
let onlinePlayerCount = 0;

function renderPlayerStatus(list) {
  onlinePlayerCount = list.filter((p) => p.online).length;
  const chips = list.length
    ? list.map((p) => `<span class="ps-chip ${p.online ? 'online' : 'offline'}"><span class="dot"></span>${esc(p.name)}</span>`).join('')
    : '<span style="color:var(--muted);font-size:.8rem">None yet</span>';
  playerStatusChips.innerHTML = chips;
  const lobby = document.getElementById('lobby-player-chips');
  if (lobby) lobby.innerHTML = list.length
    ? list.map((p) => `<span class="ps-chip ${p.online ? 'online' : 'offline'}"><span class="dot"></span>${esc(p.name)}</span>`).join('')
    : '<span style="color:var(--muted);font-size:.88rem">None yet…</span>';
}

socket.on('host-ok', ({ playerStatus, snapshot }) => {
  renderPlayerStatus(playerStatus || []);
  restoreHostState(snapshot);
});

function restoreHostState(snap) {
  setPhase(snap.phase);
  if (snap.phase === 'lobby') { show('lobby'); return; }

  if (snap.phase === 'question' || snap.phase === 'timer') {
    const d = snap.question;
    hSectionBadge.textContent = `Section ${d.sectionIndex + 1}: ${d.sectionTitle}`;
    hProgress.textContent     = `Question ${d.questionIndex + 1} of ${d.totalQuestions}`;
    hQtext.textContent        = d.questionText;
    hTimerRing.classList.add('hidden');
    hAfterTimer.classList.add('hidden');
    if (snap.phase === 'timer') {
      btnStartTimer.classList.add('hidden');
      btnStopTimer.classList.remove('hidden');
      hTimerRing.classList.remove('hidden');
      updateTimer(snap.timerRemaining ?? 30);
    } else {
      btnStartTimer.classList.remove('hidden');
      btnStartTimer.disabled = false;
      btnStopTimer.classList.add('hidden');
    }
    show('question');
    return;
  }

  if (snap.phase === 'review') {
    renderReview(snap.review);
    show('review');
    return;
  }

  if (snap.phase === 'standings') {
    hStandingsTitle.textContent = `Standings after: ${snap.sectionTitle}`;
    hStandingsBody.innerHTML = snap.scores.map((s, i) =>
      `<tr><td class="rank">${i + 1}</td><td>${esc(s.name)}</td><td>${s.score}</td></tr>`
    ).join('');
    btnNextSection.textContent = snap.isLast ? 'Show Final Results' : 'Next Section →';
    show('standings');
    return;
  }

  if (snap.phase === 'done') {
    hGameoverBody.innerHTML = snap.scores.map((s, i) =>
      `<tr><td class="rank">${i + 1}</td><td>${esc(s.name)}</td><td>${s.score}</td></tr>`
    ).join('');
    show('gameover');
  }
}

socket.on('player-status', renderPlayerStatus);

// ── Lobby ─────────────────────────────────────────────────────────────────────
btnStartGame.addEventListener('click', () => {
  socket.emit('start-section');
});

// ── Question display ──────────────────────────────────────────────────────────
socket.on('show-question', (data) => {
  hSectionBadge.textContent = `Section ${data.sectionIndex + 1}: ${data.sectionTitle}`;
  hProgress.textContent = `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
  hQtext.textContent = data.questionText;
  hTimerRing.classList.add('hidden');
  hAfterTimer.classList.add('hidden');
  hAnswerCount.classList.add('hidden');
  hAnswerCount.textContent = '';
  btnStartTimer.classList.remove('hidden');
  btnStopTimer.classList.add('hidden');
  btnStartTimer.disabled = false;
  setPhase('question');
  show('question');
});


// ── Timer ─────────────────────────────────────────────────────────────────────
btnStartTimer.addEventListener('click', () => {
  unlockAudio();
  socket.emit('start-timer');
  btnStartTimer.classList.add('hidden');
  btnStopTimer.classList.remove('hidden');
  hTimerRing.classList.remove('hidden');
  hAnswerCount.classList.remove('hidden');
  hAnswerCount.textContent = `0 / ${onlinePlayerCount} answered`;
  setPhase('timer');
});

socket.on('answer-count', ({ submitted, total }) => {
  hAnswerCount.classList.remove('hidden');
  hAnswerCount.textContent = `${submitted} / ${total} answered`;
});

btnStopTimer.addEventListener('click', () => {
  socket.emit('stop-timer');
});

socket.on('timer-start', ({ seconds }) => {
  updateTimer(seconds);
});

socket.on('timer-tick', ({ remaining }) => {
  updateTimer(remaining);
  if (remaining <= 5 && remaining > 0) playTick();
});

function updateTimer(remaining) {
  updateTimerRing(hTimerArc, hTimerNumber, remaining);
}

socket.on('question-ended', () => {
  playBell();
  btnStopTimer.classList.add('hidden');
  hAfterTimer.classList.remove('hidden');
  hAnswerCount.classList.add('hidden');
  setPhase('answers locked');
});

btnNextQ.addEventListener('click', () => {
  hAfterTimer.classList.add('hidden');
  socket.emit('next-question');
});

// ── Review ────────────────────────────────────────────────────────────────────
socket.on('show-review', (data) => {
  reviewData = data;
  renderReview(data);
  setPhase('review');
  show('review');
});

function renderReview(data) {
  reviewTitle.textContent = `Review — Section ${data.sectionIndex + 1}: ${data.sectionTitle}`;

  // Table 1: questions + correct answers
  document.getElementById('review-questions-body').innerHTML = data.questions.map((q, qi) => `
    <tr>
      <td style="color:var(--muted);font-weight:600;text-align:center">Q${qi + 1}</td>
      <td>${esc(q.text)}</td>
      <td style="color:var(--accent);font-weight:600">${esc(q.answer)}</td>
    </tr>
  `).join('');

  // Table 2: player answers — Q1..QN as columns
  reviewHead.innerHTML = `<tr>
    <th>Player</th>
    ${data.questions.map((_, qi) => `<th>Q${qi + 1}</th>`).join('')}
  </tr>`;

  reviewBody.innerHTML = data.players.map((player) => `
    <tr data-player="${esc(player.name)}">
      <td class="player-name">${esc(player.name)}</td>
      ${player.answers.map((ans, qi) => renderAnswerCell(player.name, data.sectionIndex, qi, ans)).join('')}
    </tr>
  `).join('');

  reviewBody.querySelectorAll('.mark-correct').forEach((btn) => btn.addEventListener('click', () => emitOverride(btn, true)));
  reviewBody.querySelectorAll('.mark-wrong').forEach((btn) => btn.addEventListener('click', () => emitOverride(btn, false)));
}

function emitOverride(btn, correct) {
  const cell = btn.closest('.answer-cell');
  socket.emit('override-correct', {
    playerName: cell.dataset.player,
    sectionIdx: parseInt(cell.dataset.section),
    questionIdx: parseInt(cell.dataset.qi),
    correct,
  });
}

function renderAnswerCell(playerName, sectionIdx, qi, ans) {
  const stateClass = ans.answer === '' ? '' : (ans.correct ? 'state-correct' : 'state-wrong');
  return `<td class="answer-cell ${stateClass}"
    data-player="${esc(playerName)}"
    data-section="${sectionIdx}"
    data-qi="${qi}"
    data-correct="${ans.correct}">
    <span class="ans">${esc(ans.answer || '—')}</span>
    <div class="cell-actions">
      <button class="mark-correct mark-btn" title="Mark correct">✓</button>
      <button class="mark-wrong mark-btn" title="Mark wrong">✗</button>
    </div>
  </td>`;
}


socket.on('answer-updated', ({ playerName, sectionIdx, questionIdx, answer, correct }) => {
  if (reviewData) {
    const player = reviewData.players.find((p) => p.name === playerName);
    if (player) player.answers[questionIdx] = { answer, correct };
  }
  const cell = reviewBody.querySelector(
    `td[data-player="${CSS.escape(playerName)}"][data-qi="${questionIdx}"]`
  );
  if (!cell) return;
  cell.dataset.correct = correct;
  cell.querySelector('.ans').textContent = answer || '—';
  cell.classList.remove('state-correct', 'state-wrong');
  cell.classList.add(correct ? 'state-correct' : 'state-wrong');
});

btnConfirm.addEventListener('click', () => {
  socket.emit('confirm-review');
});

// ── Standings ─────────────────────────────────────────────────────────────────
socket.on('show-standings', ({ scores, sectionTitle, isLast }) => {
  hStandingsTitle.textContent = `Standings after: ${sectionTitle}`;
  hStandingsBody.innerHTML = scores.map((s, i) =>
    `<tr><td class="rank">${i + 1}</td><td>${esc(s.name)}</td><td>${s.score}</td></tr>`
  ).join('');
  btnNextSection.textContent = isLast ? 'Show Final Results' : 'Next Section →';
  setPhase('standings');
  show('standings');
});

btnNextSection.addEventListener('click', () => {
  socket.emit('next-section');
});

// ── Game over ─────────────────────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  hGameoverBody.innerHTML = scores.map((s, i) =>
    `<tr><td class="rank">${i + 1}</td><td>${esc(s.name)}</td><td>${s.score}</td></tr>`
  ).join('');
  setPhase('done');
  show('gameover');
});
