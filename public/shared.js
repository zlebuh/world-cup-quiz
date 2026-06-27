// ── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx = null;
function unlockAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function playBell() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [[880, 0.5], [1108, 0.25], [1480, 0.12]].forEach(([freq, vol]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    osc.start(t);
    osc.stop(t + 1.5);
  });
}
function playTick() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 1100;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.22, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.start(t);
  osc.stop(t + 0.06);
}

// ── Timer ring ────────────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 45; // r=45

function updateTimerRing(arcEl, numberEl, remaining) {
  const fraction = remaining / 30;
  const offset = CIRCUMFERENCE * (1 - fraction);
  arcEl.style.strokeDashoffset = offset;
  numberEl.textContent = remaining;
  const urgent = remaining <= 10;
  arcEl.classList.toggle('urgent', urgent);
  numberEl.classList.toggle('urgent', urgent);
}

// ── HTML escaping ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
