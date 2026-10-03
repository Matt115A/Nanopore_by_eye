import { levelFeatures } from './dataset';
import { makeRng, type Rng } from './rng';
import { SessionCore } from './session';
import { BASES, type Base, type Config, type Dataset, type PriorExperience, type Session, type Win } from './types';

/**
 * Toy "human" for debug runs and tests: watches the level of the highlighted stretch
 * (mean and spread), keeps a running Gaussian per base from feedback, and picks the
 * most likely base with perceptual noise and occasional lapses. Gets faster as it
 * gets more confident.
 */
export class SimLearner {
  private rng: Rng;
  private stats = new Map<Base, { n: number; s: number[]; ss: number[] }>();
  constructor(seed: number, private p = { noise: 0.25, lapse: 0.06, temp: 1.2 }) { this.rng = makeRng(seed); }

  private feat(w: Win) { const [m, sd] = levelFeatures(w); return [m + (this.rng() - 0.5) * this.p.noise, sd]; }

  respond(w: Win, choices: Base[] = BASES): { base: Base; rt: number } {
    const f = this.feat(w);
    const ll = BASES.map((b) => {
      if (!choices.includes(b)) return -Infinity;
      const st = this.stats.get(b);
      if (!st || st.n < 3) return -2 + this.rng();
      let l = 0;
      for (let j = 0; j < f.length; j++) { const m = st.s[j] / st.n, v = Math.max(0.02, st.ss[j] / st.n - m * m); l += -0.5 * Math.log(v) - (f[j] - m) ** 2 / (2 * v); }
      return l;
    });
    const mx = Math.max(...ll);
    const ex = ll.map((l) => Math.exp((l - mx) / this.p.temp));
    const z = ex.reduce((a, b) => a + b, 0);
    const probs = ex.map((e) => e / z);
    let idx = 0;
    if (this.rng() < this.p.lapse) idx = BASES.indexOf(choices[Math.floor(this.rng() * choices.length)]);
    else { let r = this.rng(); for (idx = 0; idx < 3; idx++) { r -= probs[idx]; if (r < 0 && probs[idx] > 0) break; } }
    if (!choices.includes(BASES[idx])) idx = probs.indexOf(Math.max(...probs));
    const conf = Math.max(...probs);
    const noise = Math.exp((this.rng() + this.rng() + this.rng() - 1.5) * 0.35);
    return { base: BASES[idx], rt: (700 + 1500 * (1 - conf)) * noise };
  }

  learn(w: Win) {
    const [m, sd] = levelFeatures(w), f = [m, sd];
    const st = this.stats.get(w.label) ?? { n: 0, s: [0, 0], ss: [0, 0] };
    st.n++; f.forEach((x, j) => { st.s[j] += x; st.ss[j] += x * x; });
    this.stats.set(w.label, st);
  }
}

export function simulateSession(config: Config, data: Dataset, seed?: number, opts: { exclude?: Set<number>; prior?: PriorExperience } = {}): Session {
  const start = new Date();
  const core = new SessionCore(config, data, { seed, simulated: true, startTime: start, ...opts });
  const learner = new SimLearner(core.meta.seed ^ 0x9e3779b9);
  let t = 0, perf = 1000, reason: string | null = null;
  while (!(reason = core.endReason(t))) {
    const ph = core.phase!;
    const s = core.nextStimulus();
    if (!s) { reason = 'pool_exhausted'; break; }
    const { base, rt } = learner.respond(s.win, core.choices);
    core.record({ win: s.win, block: s.block, pressedKey: config.keys[BASES.indexOf(base)], rtMs: rt, onsetPerf: perf, responsePerf: perf + rt, wallOnset: new Date(start.getTime() + t), elapsedMs: t });
    if (ph.feedback !== 'none') learner.learn(s.win);
    const step = rt + ph.feedbackMs + config.itiMs;
    t += step; perf += step;
  }
  return core.finish(reason, t, 0, new Date(start.getTime() + t));
}
