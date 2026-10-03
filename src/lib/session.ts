import { freshSeed, makeRng, type Rng, shuffle } from './rng';
import { BASES, type Base, type Config, type Dataset, type PhaseSpec, type PriorExperience, type Session, type SessionMeta, type TrialRecord, type Win } from './types';

export const APP_VERSION = '2.0.0';

export interface ResponseInput {
  win: Win;
  block: number;
  pressedKey: string;
  rtMs: number;
  onsetPerf: number;
  responsePerf: number;
  wallOnset: Date;
  elapsedMs: number;
}

/** Draws windows without replacement — either in shuffled order, or nearest to a target easiness. */
class Pool {
  private items: Win[];
  private used = new Set<number>();
  private drawn: number[] = [];
  private i = 0;
  constructor(items: Win[], rng: Rng) { this.items = shuffle(items, rng); }
  next(): Win | null {
    while (this.i < this.items.length && this.used.has(this.items[this.i].id)) this.i++;
    return this.i < this.items.length ? this.take(this.items[this.i]) : null;
  }
  /** Unused window whose easiness is closest to target (pool is pre-shuffled, so ties are random). */
  nextNear(target: number): Win | null {
    let best: Win | null = null, bd = Infinity;
    for (const w of this.items) {
      if (this.used.has(w.id)) continue;
      const d = Math.abs(w.easy - target);
      if (d < bd) { bd = d; best = w; if (d === 0) break; }
    }
    return best ? this.take(best) : null;
  }
  putBack() { const id = this.drawn.pop(); if (id !== undefined) { this.used.delete(id); this.i = 0; } }
  private take(w: Win) { this.used.add(w.id); this.drawn.push(w.id); return w; }
}

/**
 * All experiment rules, no DOM. The session runs through the protocol's parts in
 * order. Within a part, trials come in base-balanced blocks (each base repsPerBlock
 * times, never 4 of a base in a row) from that part's sample. Windows are never
 * repeated — within the session or from earlier sessions (excluded ids).
 */
export class SessionCore {
  readonly config: Config;
  readonly meta: SessionMeta;
  readonly trials: TrialRecord[] = [];
  phaseIdx = 0;
  private inPhase = 0;
  private rng: Rng;
  private blockQueue: Base[] = [];
  private block = 0;
  private recentBases: Base[] = [];
  private canon: Record<'DM' | 'MSssI', Record<Base, Pool>>;
  private methCentre: Pool;
  readonly byId: Map<number, Win>;

  constructor(config: Config, data: Dataset, opts: { seed?: number; simulated?: boolean; startTime?: Date; exclude?: Set<number>; prior?: PriorExperience } = {}) {
    this.config = structuredClone(config);
    const seed = opts.seed ?? freshSeed();
    this.rng = makeRng(seed);
    this.byId = new Map(data.windows.map((w) => [w.id, w]));
    const ex = config.excludeSeen ? opts.exclude ?? new Set<number>() : new Set<number>();
    const avail = data.windows.filter((w) => !ex.has(w.id));
    const pools = (sample: 'DM' | 'MSssI') =>
      Object.fromEntries(BASES.map((b) => [b, new Pool(avail.filter((w) => w.sample === sample && w.label === b && !w.centreMC), this.rng)])) as Record<Base, Pool>;
    this.canon = { DM: pools('DM'), MSssI: pools('MSssI') };
    this.methCentre = new Pool(avail.filter((w) => w.sample === 'MSssI' && w.centreMC), this.rng);
    const start = opts.startTime ?? new Date();
    this.meta = {
      app: 'nanopore-reading', app_version: APP_VERSION,
      session_id: `${start.toISOString().replace(/[:.]/g, '-')}_${seed.toString(16)}`,
      seed, simulated: !!opts.simulated, config: this.config, dataset_version: data.version,
      phase_starts: { [config.phases[0].name]: 1 },
      prior: opts.prior ?? { sessions: 0, trials: 0, session_ids: [], excluded_windows: 0 },
      start_time: start.toISOString(), end_time: null, end_reason: null, total_trials: 0, active_duration_ms: 0, paused_ms: 0,
      environment: {
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
        estimated_frame_ms: null,
        screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}@${devicePixelRatio}x` : 'n/a',
      },
      timing_notes: 'Trace made visible inside a requestAnimationFrame callback; onset_perf_ms = performance.now() there. response_perf_ms = keydown event timeStamp (same clock). rt_ms = response − onset.',
    };
  }

  get phase(): PhaseSpec | null { return this.config.phases[this.phaseIdx] ?? null; }
  get done() { return this.phaseIdx >= this.config.phases.length; }

  keyToBase(key: string): Base | null {
    const i = this.config.keys.indexOf(key.toUpperCase());
    return i >= 0 ? BASES[i] : null;
  }

  /** Bases offered in the current part. */
  get choices(): Base[] { return this.phase?.choices ?? BASES; }

  /** Key → base, but only for bases offered in the current part. */
  allowedBase(key: string): Base | null {
    const b = this.keyToBase(key);
    return b && this.choices.includes(b) ? b : null;
  }

  private makeBlock(): Base[] {
    const fresh = () => shuffle(this.choices.flatMap((b) => Array<Base>(this.config.repsPerBlock).fill(b)), this.rng);
    for (let attempt = 0; attempt < 500; attempt++) {
      const seq = fresh(), all = [...this.recentBases, ...seq];
      let ok = true;
      for (let i = 3; i < all.length; i++) if (all[i] === all[i - 1] && all[i] === all[i - 2] && all[i] === all[i - 3]) { ok = false; break; }
      if (ok) return seq;
    }
    return fresh();
  }

  /** Returns null when the protocol is finished or a pool is exhausted. */
  nextStimulus(): { win: Win; block: number } | null {
    const ph = this.phase;
    if (!ph) return null;
    if (!this.blockQueue.length) { this.blockQueue = this.makeBlock(); this.block++; }
    const base = this.blockQueue.shift()!;
    this.recentBases = [...this.recentBases, base].slice(-3);
    let w: Win | null;
    // easy → hard: target easiness slides from 95 to 25 over the part
    const target = 95 - 70 * Math.min(1, this.inPhase / Math.max(1, ph.trials - 1));
    const draw = (p: Pool) => (ph.order === 'easyFirst' ? p.nextNear(target) : p.next());
    if (ph.sample === 'MSssI' && base === 'C' && this.rng() < this.config.mCFraction) w = draw(this.methCentre) ?? draw(this.canon.MSssI.C);
    else w = draw(this.canon[ph.sample][base]);
    return w ? { win: w, block: this.block } : null;
  }

  pushBack(w: Win) {
    this.blockQueue.unshift(w.label);
    this.recentBases.pop();
    if (w.centreMC) this.methCentre.putBack();
    else this.canon[w.sample][w.label].putBack();
  }

  /** Rolling accuracy within the current part (null until the window is full). */
  phaseRolling(window: number): number | null {
    if (this.inPhase < window) return null;
    let c = 0;
    for (let i = this.trials.length - window; i < this.trials.length; i++) if (this.trials[i].correct) c++;
    return c / window;
  }

  /** Live readout: accuracy over the last trials of the current part — only in parts with feedback. */
  liveAccuracy(window: number): number | null {
    if (!this.phase || this.phase.feedback === 'none' || !this.inPhase) return null;
    const w = Math.min(window, this.inPhase);
    let c = 0;
    for (let i = this.trials.length - w; i < this.trials.length; i++) if (this.trials[i].correct) c++;
    return c / w;
  }

  record(r: ResponseInput): { trial: TrialRecord; next: PhaseSpec | null; finished: boolean } {
    const ph = this.phase!;
    const pressed = this.keyToBase(r.pressedKey)!;
    const trial: TrialRecord = {
      trial: this.trials.length + 1, timestamp: r.wallOnset.toISOString(), elapsed_ms: Math.round(r.elapsedMs),
      phase: ph.name, feedback: ph.feedback, ...(ph.choices && ph.choices.length < 4 ? { choices: ph.choices.join('') } : {}), easiness: r.win.easy, block: r.block, window_id: r.win.id, sample: r.win.sample, label: r.win.label,
      pressed, pressed_key: r.pressedKey.toUpperCase(), correct: pressed === r.win.label, rt_ms: Math.round(r.rtMs * 10) / 10,
      centre_mC: r.win.centreMC, n_mC_context: r.win.nMCContext, dwell_samples: r.win.ce - r.win.cs, rolling_accuracy: null,
      onset_perf_ms: Math.round(r.onsetPerf * 100) / 100, response_perf_ms: Math.round(r.responsePerf * 100) / 100,
    };
    this.trials.push(trial);
    this.inPhase++;
    trial.rolling_accuracy = this.phaseRolling(ph.endOnCriterion?.window ?? 100);
    this.meta.total_trials = this.trials.length;

    const crit = ph.endOnCriterion;
    const critMet = !!crit && this.inPhase >= crit.minTrials && (this.phaseRolling(crit.window) ?? 0) >= crit.threshold - 1e-9;
    if (this.inPhase >= ph.trials || critMet) {
      this.phaseIdx++; this.inPhase = 0; this.blockQueue = [];
      const next = this.phase;
      if (next) this.meta.phase_starts![next.name] = trial.trial + 1;
      return { trial, next, finished: !next };
    }
    return { trial, next: null, finished: false };
  }

  endReason(activeMs: number): string | null {
    if (this.done) return 'protocol_complete';
    if (activeMs >= this.config.maxDurationMin * 60_000) return 'max_duration';
    return null;
  }

  finish(reason: string, activeMs: number, pausedMs: number, endTime = new Date()): Session {
    Object.assign(this.meta, { end_time: endTime.toISOString(), end_reason: reason, active_duration_ms: Math.round(activeMs), paused_ms: Math.round(pausedMs) });
    return this.snapshot();
  }

  snapshot(): Session { return { meta: structuredClone(this.meta), trials: this.trials.map((t) => ({ ...t })) }; }
}
