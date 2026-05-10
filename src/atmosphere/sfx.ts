/** 轻量 Web Audio 反馈（需用户先点一次「音效」以解锁浏览器策略） */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function unlockAudio(): Promise<void> {
  const c = getCtx();
  if (c?.state === 'suspended') await c.resume();
}

function beep(freq: number, dur: number, type: OscillatorType, gain: number, when?: number): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t0 = when ?? c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playUiTick(): void {
  beep(880, 0.06, 'sine', 0.06);
}

export function playCommit(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  beep(520, 0.08, 'square', 0.04, t);
  beep(780, 0.1, 'sine', 0.05, t + 0.06);
}

export function playIntelChime(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  beep(660, 0.12, 'sine', 0.045, t);
  beep(990, 0.15, 'sine', 0.035, t + 0.1);
}

export function playTurnResolve(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.45);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.55);
}

export function playTension(): void {
  beep(220, 0.25, 'triangle', 0.06);
}

let ambientOsc: OscillatorNode | null = null;

export function setAmbientEnabled(on: boolean): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  if (on) {
    if (ambientOsc) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.value = 58;
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    g.gain.value = 0.018;
    osc.connect(filter).connect(g).connect(c.destination);
    osc.start();
    ambientOsc = osc;
  } else {
    ambientOsc?.stop();
    ambientOsc = null;
  }
}
