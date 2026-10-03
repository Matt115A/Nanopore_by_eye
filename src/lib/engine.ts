import { saveLocal } from './export';
import type { SessionCore } from './session';
import { SimLearner } from './simulate';
import { expectedLevels } from './dataset';
import { BASES, type Base, type FeedbackMode, type KmerTable, type PhaseSpec, type Session, type TrialRecord, type Win } from './types';

/** Trace geometry (SVG viewBox units). Fixed scale so level is comparable across trials. */
export const TRACE = { W: 1000, H: 440, PX_PER_SAMPLE: 6, Y_PER_UNIT: 58, Y_RANGE: 3.6 }; // 161 samples × 6 ≈ full width

export function traceX(w: Win, i: number) { return TRACE.W / 2 + (i - (w.cs + w.ce) / 2) * TRACE.PX_PER_SAMPLE; }

export const traceY = (v: number) => TRACE.H / 2 - Math.max(-TRACE.Y_RANGE, Math.min(TRACE.Y_RANGE, v)) * TRACE.Y_PER_UNIT;
/** Extended highlight: the centre band plus ~1 base after it — a fixed 25 samples, so its width carries no information. */
export const EXTENDED_BAND = 25;

export function tracePath(w: Win, band: 'centre' | 'extended' = 'centre'): { d: string; x0: number; x1: number } {
  const Y = traceY;
  let d = '';
  for (let i = 0; i < w.signal.length; i++) {
    const x = traceX(w, i);
    if (x < -10 || x > TRACE.W + 10) continue;
    d += (d ? 'L' : 'M') + x.toFixed(1) + ' ' + Y(w.signal[i]).toFixed(1);
  }
  return { d, x0: traceX(w, w.cs), x1: traceX(w, band === 'extended' ? w.cs + EXTENDED_BAND : w.ce) };
}

/** SVG markup for the true sequence laid under the trace (each base under its own stretch of signal). */
export function sequenceMarkup(w: Win, correct: boolean | null): string {
  if (w.bounds.length !== 14) return '';
  let out = '';
  for (let i = 0; i < 13; i++) {
    const a = w.bounds[i], b = w.bounds[i + 1];
    if (b <= 0 || a >= w.signal.length) continue;
    const x0 = traceX(w, a), x1 = traceX(w, b), xm = (x0 + x1) / 2;
    if (xm < 8 || xm > TRACE.W - 8) continue;
    const centre = i === 6;
    const col = centre ? (correct === false ? '#ef5350' : '#3ccf7e') : '#c3c2b7';
    out += `<line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="18" y2="${TRACE.H - 46}" stroke="#3a3a36" stroke-width="1.2" stroke-dasharray="3 5"/>`;
    out += `<text x="${xm.toFixed(1)}" y="${TRACE.H - 14}" text-anchor="middle" font-family="SF Mono, Menlo, monospace" font-weight="${centre ? 800 : 600}" font-size="${centre ? 34 : 26}" fill="${col}">${w.context[i]}</text>`;
  }
  return out;
}

/** The base to contrast with in explain feedback: what was pressed if wrong; otherwise the other choice / the CNN's runner-up. */
export function contrastBase(w: Win, pressed: Base, choices: Base[]): Base {
  if (pressed !== w.label) return pressed;
  if (choices.length === 2) return choices.find((b) => b !== w.label)!;
  return ([...(w.ranks.cnn || 'ACGT')].find((b) => b !== w.label) as Base) ?? 'A';
}

/** Expected trace for the true base vs the alternative in this exact context, plus the neighbouring bases. */
export function explainMarkup(w: Win, k: KmerTable | null, alt: Base, correct: boolean): string {
  if (!k || w.bounds.length !== 14) return sequenceMarkup(w, correct);
  const ctxAlt = w.context.slice(0, 6) + alt + w.context.slice(7);
  const eT = expectedLevels(w.context, k), eA = expectedLevels(ctxAlt, k);
  let lines = '', letters = '';
  for (let i = 3; i <= 9; i++) {
    const a = w.bounds[i], b = w.bounds[i + 1];
    if (b <= 0 || a >= w.signal.length || Number.isNaN(eT[i])) continue;
    const x0 = traceX(w, Math.max(0, a)), x1 = traceX(w, Math.min(w.signal.length, b));
    const differs = Math.abs(eT[i] - eA[i]) > 1e-6;
    if (differs) lines += `<line x1="${x0.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${traceY(eA[i]).toFixed(1)}" y2="${traceY(eA[i]).toFixed(1)}" stroke="#f08a5d" stroke-width="6" stroke-dasharray="10 7" stroke-linecap="round" opacity="0.95"/>`;
    lines += `<line x1="${x0.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${traceY(eT[i]).toFixed(1)}" y2="${traceY(eT[i]).toFixed(1)}" stroke="#3ccf7e" stroke-width="${differs ? 7 : 4}" stroke-linecap="round" opacity="${differs ? 0.95 : 0.45}"/>`;
    if (i >= 4 && i <= 8) {
      const xm = (x0 + x1) / 2, centre = i === 6;
      letters += `<text x="${xm.toFixed(1)}" y="${TRACE.H - 16}" text-anchor="middle" font-family="SF Mono, Menlo, monospace" font-weight="${centre ? 800 : 600}" font-size="${centre ? 36 : 28}" fill="${centre ? '#3ccf7e' : '#c3c2b7'}">${w.context[i]}</text>`;
    }
  }
  const legend = `<g font-family="-apple-system, sans-serif" font-size="20"><line x1="24" x2="64" y1="28" y2="28" stroke="#3ccf7e" stroke-width="6"/><text x="74" y="35" fill="#c3c2b7">expected if ${w.label}</text>` +
    `<line x1="250" x2="290" y1="28" y2="28" stroke="#f08a5d" stroke-width="6" stroke-dasharray="10 7"/><text x="300" y="35" fill="#c3c2b7">expected if ${alt}</text></g>`;
  return lines + letters + legend;
}

export interface EngineEls {
  path: SVGPathElement;
  band: SVGRectElement;
  traceGroup: SVGGElement;
  seq: SVGGElement;
  keycaps: Record<string, HTMLElement>;
  message: HTMLElement;
  hudTrial: HTMLElement;
  hudTime: HTMLElement;
  hudAcc: HTMLElement;
  hudPart: HTMLElement;
  debug: HTMLElement | null;
}

export interface EngineOpts { debug: boolean; autoplay: boolean; autoplaySpeed: number; kmer: KmerTable | null; onEnd: (s: Session) => void; onPauseChange: (paused: boolean) => void }

type State = 'idle' | 'intro' | 'waiting' | 'feedback' | 'iti' | 'paused' | 'ended';

export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Runs trials imperatively; React is not involved until the session ends. */
export class TrialEngine {
  private state: State = 'idle';
  private timers: number[] = [];
  private raf = 0;
  private current: { win: Win; block: number; onset: number; wall: Date; elapsed: number } | null = null;
  private prepared: { win: Win; block: number; d: string; x0: number; x1: number } | null = null;
  private activeAccum = 0;
  private activeSince = 0;
  private pausedAccum = 0;
  private pauseSince = 0;
  private clockTimer = 0;
  private learner: SimLearner | null = null;

  constructor(private core: SessionCore, private els: EngineEls, private opts: EngineOpts) {
    if (opts.autoplay) this.learner = new SimLearner(core.meta.seed ^ 0x51ed);
  }

  start() {
    window.addEventListener('keydown', this.onKey, true);
    this.estimateFrame();
    this.activeSince = performance.now();
    this.updateHud();
    this.clockTimer = window.setInterval(() => {
      if (this.state !== 'waiting' && this.state !== 'paused') this.els.hudTime.textContent = fmtClock(this.activeMs());
    }, 250);
    this.prepare();
    this.beginPhase(this.core.phase!, 900);
  }

  destroy() { window.removeEventListener('keydown', this.onKey, true); this.clearTimers(); clearInterval(this.clockTimer); }
  activeMs() { return this.activeAccum + (this.state === 'paused' || this.state === 'ended' ? 0 : performance.now() - this.activeSince); }
  private schedule(fn: () => void, ms: number) { this.timers.push(window.setTimeout(fn, ms)); }
  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; cancelAnimationFrame(this.raf); }
  private get speed() { return this.learner ? this.opts.autoplaySpeed : 1; }

  private estimateFrame() {
    const deltas: number[] = []; let last = 0;
    const tick = (t: number) => {
      if (last) deltas.push(t - last);
      last = t;
      if (deltas.length < 60) requestAnimationFrame(tick);
      else { deltas.sort((a, b) => a - b); this.core.meta.environment.estimated_frame_ms = Math.round(deltas[30] * 100) / 100; }
    };
    requestAnimationFrame(tick);
  }

  /** Intro screen for a part (Space to continue), then trials. */
  private beginPhase(ph: PhaseSpec, delay: number) {
    this.els.hudPart.textContent = ph.label;
    const offered = ph.choices ?? BASES;
    BASES.forEach((b, i) => this.els.keycaps[this.core.config.keys[i]]?.classList.toggle('kc-off', !offered.includes(b)));
    if (!ph.intro || this.learner) { this.state = 'iti'; this.schedule(() => this.present(), delay / this.speed); return; }
    this.state = 'intro';
    this.els.message.innerHTML = `<div class="intro">${ph.intro.split('\n').map((l, i) => (i ? `<p>${esc(l)}</p>` : `<h2>${esc(l)}</h2>`)).join('')}<p class="hint pulse">Press <kbd>Space</kbd> to continue</p></div>`;
    this.els.message.classList.add('show');
  }

  private prepare() {
    const s = this.core.nextStimulus();
    if (!s) { this.prepared = null; return; }
    const { d, x0, x1 } = tracePath(s.win, this.core.phase?.band);
    this.prepared = { ...s, d, x0, x1 };
  }

  private present() {
    const reason = this.core.endReason(this.activeMs()) ?? (this.prepared ? null : 'pool_exhausted');
    if (reason) return this.end(reason);
    const p = this.prepared!;
    this.els.path.setAttribute('d', p.d);
    this.els.band.setAttribute('x', p.x0.toFixed(1));
    this.els.band.setAttribute('width', Math.max(2, p.x1 - p.x0).toFixed(1));
    this.raf = requestAnimationFrame(() => {
      this.els.traceGroup.style.visibility = 'visible';
      const onset = performance.now();
      this.current = { win: p.win, block: p.block, onset, wall: new Date(), elapsed: this.activeMs() };
      this.prepared = null;
      this.state = 'waiting';
      if (this.learner) {
        const { base, rt } = this.learner.respond(p.win, this.core.choices);
        this.schedule(() => this.respond(this.core.config.keys[BASES.indexOf(base)], onset + rt), rt / this.speed);
      }
    });
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.state === 'paused') this.resume();
      else if (!['ended', 'idle', 'intro'].includes(this.state)) this.pause();
      return;
    }
    if (this.state === 'intro' && e.code === 'Space') {
      e.preventDefault();
      this.els.message.classList.remove('show');
      this.state = 'iti';
      this.schedule(() => this.present(), 700);
      return;
    }
    if (e.repeat || this.learner || e.metaKey || e.ctrlKey) return;
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (!this.core.keyToBase(key)) return;
    e.preventDefault();
    if (!this.core.allowedBase(key)) return;   // keys for bases not offered in this part do nothing
    if (this.state !== 'waiting' || !this.current) return;
    const now = performance.now();
    this.respond(key, e.timeStamp > this.current.onset && e.timeStamp <= now + 1 ? e.timeStamp : now);
  };

  private respond(key: string, responsePerf: number) {
    const cur = this.current;
    if (this.state !== 'waiting' || !cur) return;
    this.state = 'feedback';
    this.current = null;
    const ph = this.core.phase!;
    const { trial, next, finished } = this.core.record({
      win: cur.win, block: cur.block, pressedKey: key, rtMs: responsePerf - cur.onset,
      onsetPerf: cur.onset, responsePerf, wallOnset: cur.wall, elapsedMs: cur.elapsed,
    });
    this.showFeedback(trial, cur.win, ph.feedback);
    this.updateHud();
    if (ph.feedback !== 'none') this.learner?.learn(cur.win);
    this.schedule(() => {
      this.clearStage();
      this.state = 'iti';
      if (finished) return this.end('protocol_complete');
      this.prepare();
      if (next || trial.trial % 10 === 0) saveLocal(this.core.snapshot());
      if (next) this.beginPhase(next, this.core.config.itiMs);
      else this.schedule(() => this.present(), this.core.config.itiMs / this.speed);
    }, ph.feedbackMs / this.speed);
  }

  private showFeedback(t: TrialRecord, w: Win, mode: FeedbackMode) {
    const k = (b: string) => this.els.keycaps[this.core.config.keys[BASES.indexOf(b as never)]];
    if (mode === 'none') { k(t.pressed)?.classList.add('kc-pressed'); return; }
    if (t.correct) k(t.pressed)?.classList.add('kc-correct');
    else { k(t.pressed)?.classList.add('kc-wrong'); k(t.label)?.classList.add('kc-reveal'); }
    this.els.band.classList.add(t.correct ? 'band-correct' : 'band-wrong');
    if (mode === 'sequence') this.els.seq.innerHTML = sequenceMarkup(w, t.correct);
    if (mode === 'explain') this.els.seq.innerHTML = explainMarkup(w, this.opts.kmer, contrastBase(w, t.pressed, this.core.choices), t.correct);
  }

  private clearStage() {
    this.els.traceGroup.style.visibility = 'hidden';
    Object.values(this.els.keycaps).forEach((k) => k.classList.remove('kc-correct', 'kc-wrong', 'kc-reveal', 'kc-pressed'));
    this.els.band.classList.remove('band-correct', 'band-wrong');
    this.els.seq.innerHTML = '';
  }

  private updateHud() {
    const c = this.core;
    this.els.hudTrial.textContent = String(c.trials.length + 1);
    const acc = c.liveAccuracy(c.config.hudWindow);
    this.els.hudAcc.textContent = acc === null ? '—' : `${Math.round(acc * 100)}%`;
    this.els.hudTime.textContent = fmtClock(this.activeMs());
    if (this.opts.debug && this.els.debug) {
      const last = c.trials[c.trials.length - 1];
      this.els.debug.innerHTML = `<div class="dbg-title">DEBUG</div>
        <div>part: <b>${c.phase?.name ?? 'done'}</b> (${c.phaseIdx + 1}/${c.config.phases.length})</div>
        <div>last: ${last ? `${last.label} → ${last.pressed} · ${last.rt_ms.toFixed(0)} ms${last.centre_mC ? ' · <b>mC</b>' : ''}` : '—'}</div>
        <div>prior: ${c.meta.prior?.trials ?? 0} trials, ${c.meta.prior?.excluded_windows ?? 0} windows excluded</div>
        <div>frame ≈ ${c.meta.environment.estimated_frame_ms ?? '?'} ms</div>`;
    }
  }

  pause() {
    if (this.state === 'paused' || this.state === 'ended') return;
    this.clearTimers();
    if (this.current) { this.core.pushBack(this.current.win); this.current = null; this.prepared = null; }
    else if (this.prepared) { this.core.pushBack(this.prepared.win); this.prepared = null; }
    this.activeAccum += performance.now() - this.activeSince;
    this.pauseSince = performance.now();
    this.state = 'paused';
    this.clearStage();
    this.opts.onPauseChange(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.pausedAccum += performance.now() - this.pauseSince;
    this.activeSince = performance.now();
    this.state = 'iti';
    this.opts.onPauseChange(false);
    this.prepare();
    this.schedule(() => this.present(), 900);
  }

  end(reason: string) {
    if (this.state === 'ended') return;
    if (this.state === 'paused') this.pausedAccum += performance.now() - this.pauseSince;
    else this.activeAccum += performance.now() - this.activeSince;
    this.state = 'ended';
    this.destroy();
    const session = this.core.finish(reason, this.activeAccum, this.pausedAccum);
    saveLocal(session);
    this.opts.onEnd(session);
  }
}
