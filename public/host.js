const socket = io();

// ── Screen management ────────────────────────────────────────────────────────
const screens = ['lobby','question','review','standings','gameover'];
function show(name) {
  screens.forEach((s) => document.getElementById(`screen-${s}`).classList.add('hidden'));
  document.getElementById(`screen-${name}`).classList.remove('hidden');
}
function setPhase(label) {
  document.getElementById('phase-label').textContent = label;
}

// ── Elements ─────────────────────────────────────────────────────────────────
const lobbyPlayers   = document.getElementById('lobby-players');
const btnStartGame   = document.getElementById('btn-start-game');
const btnStartTimer  = document.getElementById('btn-start-timer');
const btnStopTimer   = document.getElementById('btn-stop-timer');
const btnNextQ       = document.getElementById('btn-next-question');
const btnConfirm     = document.getElementById('btn-confirm-review');
const btnNextSection = document.getElementById('btn-next-section');

const hSectionBadge = document.getElementById('h-section-badge');
const hProgress     = document.getElementById('h-progress');
const hQtext        = document.getElementById('h-qtext');
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

const CIRCUMFERENCE = 2 * Math.PI * 45;

// ── State ─────────────────────────────────────────────────────────────────────
let reviewData = null; // cached review payload for re-renders

// ── Init ──────────────────────────────────────────────────────────────────────
socket.emit('host-connect');

fetch('/api/join-url').then((r) => r.json()).then(({ url }) => {
  document.getElementById('url-label').textContent = url;
});

const playerStatusChips = document.getElementById('player-status-chips');

function renderPlayerStatus(list) {
  if (!list.length) { playerStatusChips.innerHTML = '<span style="color:var(--muted);font-size:.8rem">None yet</span>'; return; }
  playerStatusChips.innerHTML = list.map((p) =>
    `<span class="ps-chip ${p.online ? 'online' : 'offline'}"><span class="dot"></span>${esc(p.name)}</span>`
  ).join('');
}

socket.on('host-ok', ({ playerList, playerStatus, snapshot }) => {
  renderPlayerList(playerList);
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
socket.on('player-list', renderPlayerList);

function renderPlayerList(names) {
  if (!names.length) {
    lobbyPlayers.innerHTML = '<span style="color:var(--muted)">None yet...</span>';
    return;
  }
  lobbyPlayers.innerHTML = names.map((n) => `<span class="player-pill">${n}</span>`).join('');
}

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
  btnStartTimer.classList.remove('hidden');
  btnStopTimer.classList.add('hidden');
  btnStartTimer.disabled = false;
  setPhase('question');
  show('question');
});


// ── Timer ─────────────────────────────────────────────────────────────────────
btnStartTimer.addEventListener('click', () => {
  socket.emit('start-timer');
  btnStartTimer.classList.add('hidden');
  btnStopTimer.classList.remove('hidden');
  hTimerRing.classList.remove('hidden');
  setPhase('timer');
});

btnStopTimer.addEventListener('click', () => {
  socket.emit('stop-timer');
});

socket.on('timer-start', ({ seconds }) => {
  updateTimer(seconds);
});

socket.on('timer-tick', ({ remaining }) => {
  updateTimer(remaining);
});

function updateTimer(remaining) {
  const fraction = remaining / 30;
  const offset = CIRCUMFERENCE * (1 - fraction);
  hTimerArc.style.strokeDashoffset = offset;
  hTimerNumber.textContent = remaining;
  const urgent = remaining <= 10;
  hTimerArc.classList.toggle('urgent', urgent);
  hTimerNumber.classList.toggle('urgent', urgent);
}

socket.on('question-ended', () => {
  btnStopTimer.classList.add('hidden');
  hAfterTimer.classList.remove('hidden');
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

  // Header row: Q1..Q5 with correct answer
  reviewHead.innerHTML = `<tr>
    <th>Player</th>
    ${data.questions.map((q, qi) => `<th>Q${qi + 1}: ${q.text}<br><span style="color:var(--gold);font-weight:400">${q.answer}</span></th>`).join('')}
  </tr>`;

  // Body rows: one per player
  reviewBody.innerHTML = data.players.map((player) => `
    <tr data-player="${esc(player.name)}">
      <td class="player-name">${esc(player.name)}</td>
      ${player.answers.map((ans, qi) => renderAnswerCell(player.name, data.sectionIndex, qi, ans, data.questions[qi].answer)).join('')}
    </tr>
  `).join('');

  // Attach edit listeners
  reviewBody.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', handleEditClick);
  });
  reviewBody.querySelectorAll('.badge.correct, .badge.wrong, .badge.empty').forEach((badge) => {
    badge.addEventListener('click', handleBadgeToggle);
  });
}

function renderAnswerCell(playerName, sectionIdx, qi, ans, correctAnswer) {
  const badgeClass = ans.answer === '' ? 'empty' : (ans.correct ? 'correct' : 'wrong');
  const badgeText  = ans.answer === '' ? 'no answer' : (ans.correct ? '✓ correct' : '✗ wrong');
  return `<td class="answer-cell"
    data-player="${esc(playerName)}"
    data-section="${sectionIdx}"
    data-qi="${qi}"
    data-correct="${ans.correct}">
    <span class="ans">${esc(ans.answer || '—')}</span>
    <span class="badge ${badgeClass} correct-toggle" title="Click to toggle">${badgeText}</span>
    <button class="edit-btn" title="Edit answer">✏</button>
  </td>`;
}

function handleBadgeToggle(e) {
  const cell = e.target.closest('.answer-cell');
  const playerName = cell.dataset.player;
  const sectionIdx = parseInt(cell.dataset.section);
  const qi         = parseInt(cell.dataset.qi);
  const currentCorrect = cell.dataset.correct === 'true';
  socket.emit('override-correct', { playerName, sectionIdx, questionIdx: qi, correct: !currentCorrect });
}

function handleEditClick(e) {
  const cell = e.target.closest('.answer-cell');
  const existing = cell.querySelector('.inline-edit-form');
  if (existing) { existing.remove(); return; }

  const currentAnswer = cell.querySelector('.ans').textContent.replace('—','').trim();
  const form = document.createElement('div');
  form.className = 'inline-edit-form';
  form.innerHTML = `<input type="text" value="${esc(currentAnswer)}" maxlength="80" />
    <button class="btn-primary save-edit">Save</button>
    <button class="btn-ghost cancel-edit">✕</button>`;
  cell.appendChild(form);

  form.querySelector('.cancel-edit').addEventListener('click', () => form.remove());
  form.querySelector('.save-edit').addEventListener('click', () => {
    const newAnswer = form.querySelector('input').value.trim();
    if (!newAnswer) return;
    socket.emit('edit-answer', {
      playerName: cell.dataset.player,
      sectionIdx: parseInt(cell.dataset.section),
      questionIdx: parseInt(cell.dataset.qi),
      newAnswer,
    });
    form.remove();
  });
  form.querySelector('input').focus();
}

socket.on('answer-updated', ({ playerName, sectionIdx, questionIdx, answer, correct }) => {
  // Update local reviewData
  if (reviewData) {
    const player = reviewData.players.find((p) => p.name === playerName);
    if (player) player.answers[questionIdx] = { answer, correct };
  }
  // Update DOM cell
  const cell = reviewBody.querySelector(
    `td[data-player="${CSS.escape(playerName)}"][data-qi="${questionIdx}"]`
  );
  if (!cell) return;
  cell.dataset.correct = correct;
  cell.querySelector('.ans').textContent = answer || '—';
  const badge = cell.querySelector('.badge');
  badge.className = `badge ${answer === '' ? 'empty' : (correct ? 'correct' : 'wrong')} correct-toggle`;
  badge.textContent = answer === '' ? 'no answer' : (correct ? '✓ correct' : '✗ wrong');
  // Re-attach toggle listener (class was replaced)
  badge.addEventListener('click', handleBadgeToggle);
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

// ── Utility ───────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
