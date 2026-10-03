import { describe, expect, it } from 'vitest';
import { benchmarkSubsets, modelAccuracy, modelAnswer, phaseList, phaseStats, DEFAULT_ANALYSIS, streamLearners } from '../src/lib/analysis';
import { contrastBase, explainMarkup } from '../src/lib/engine';
import { features } from '../src/lib/dataset';
import { CSV_COLUMNS, trialsToCsv } from '../src/lib/export';
import { entryFromSession } from '../src/lib/history';
import { makeRng } from '../src/lib/rng';
import { SessionCore } from '../src/lib/session';
import { simulateSession } from '../src/lib/simulate';
import { BASES, type Base, type Config, DEFAULT_CONFIG, type Dataset, PRESETS, type Session, type Win } from '../src/lib/types';

/** Synthetic dataset with a learnable level per base, so tests don't need the real files. */
function fakeData(nPerBase = 1500, nMeth = 600): Dataset {
  const rng = makeRng(7);
  const level: Record<Base, number> = { A: -0.5, C: 0.4, G: 0, T: 1 };
  let id = 0;
  const mk = (sample: 'DM' | 'MSssI', label: Base, centreMC = false): Win => {
    const signal = new Float32Array(161).map((_, i) => (Math.abs(i - 80) < 7 ? level[label] + (centreMC ? -0.6 : 0) : 0) + (rng() - 0.5) * 0.8);
    return { id: id++, sample, label, context: 'ACGTAC' + label + 'GTACGT', signal, cs: 74, ce: 87, centreMC, nMCContext: centreMC ? 1 : 0,
      bounds: Array.from({ length: 14 }, (_, i) => 2 + i * 12), easy: Math.floor(rng() * 100),
      ranks: { level: label + BASES.filter((b) => b !== label).join(''), knn: label + 'ACGT'.replace(label, ''), logreg: BASES.filter((b) => b !== label).join('') + label, cnn: label + 'ACGT'.replace(label, '') },
      preds: { level: label, knn: label, logreg: BASES[(BASES.indexOf(label) + 1) % 4], cnn: label, fast: label, hac: label, sup: label } };
  };
  const windows: Win[] = [];
  BASES.forEach((b) => { for (let i = 0; i < nPerBase; i++) windows.push(mk('DM', b)); });
  BASES.forEach((b) => { for (let i = 0; i < nMeth; i++) windows.push(mk('MSssI', b)); });
  for (let i = 0; i < nMeth; i++) windows.push(mk('MSssI', 'C', true));
  const kmer = { before: 2, after: 2, mean: 0, levels: Object.fromEntries(Array.from({ length: 1024 }, (_, i) => [Array.from({ length: 5 }, (_, j) => 'ACGT'[(i >> (2 * (4 - j))) & 3]).join(''), ((i % 7) - 3) / 3])) };
  return { version: 'test', source: {}, models: [], modelAccuracy: {}, dataEfficiency: { n: [], cnn: [], logreg: [] }, kmer, windows };
}

const data = fakeData();
const answer = (core: SessionCore, n: number, correct: (i: number) => boolean) => {
  for (let i = 0; i < n && !core.done; i++) {
    const s = core.nextStimulus()!;
    const offered = core.choices;
    const base = correct(i) ? s.win.label : offered[(offered.indexOf(s.win.label) + 1) % offered.length];
    core.record({ win: s.win, block: s.block, pressedKey: core.config.keys[BASES.indexOf(base)], rtMs: 700, onsetPerf: i * 2000, responsePerf: i * 2000 + 700, wallOnset: new Date(), elapsedMs: i * 2000 });
  }
};
const single = (trials: number): Config => ({ ...DEFAULT_CONFIG, phases: [{ name: 'only', label: 'Only', trials, sample: 'DM', feedback: 'correctness', feedbackMs: 500, intro: '' }] });

describe('session', () => {
  it('balances bases per block, never repeats a window, never 4 of a base in a row', () => {
    const core = new SessionCore(single(480), data, { seed: 1 });
    answer(core, 480, () => true);
    const t = core.trials;
    for (let b = 0; b < 15; b++) BASES.forEach((base) => expect(t.slice(b * 32, b * 32 + 32).filter((x) => x.label === base)).toHaveLength(8));
    expect(new Set(t.map((x) => x.window_id)).size).toBe(t.length);
    for (let i = 3; i < t.length; i++) expect(t[i].label === t[i - 1].label && t[i].label === t[i - 2].label && t[i].label === t[i - 3].label).toBe(false);
  });

  const S2: Config = { ...DEFAULT_CONFIG, protocol: 'pretrained', phases: PRESETS.pretrained.phases };
  it('runs the session-2 protocol in order with the right DNA and feedback per part', () => {
    const core = new SessionCore(S2, data, { seed: 2 });
    expect(core.liveAccuracy(50)).toBeNull();
    answer(core, 10_000, (i) => i % 2 === 0);
    expect(core.done).toBe(true);
    expect(core.endReason(0)).toBe('protocol_complete');
    const parts = phaseList({ meta: core.meta, trials: core.trials } as Session);
    expect(parts.map((p) => [p.name, p.trials.length, p.start])).toEqual([['pretest', 64, 1], ['training', 320, 65], ['posttest', 64, 385], ['methylated', 192, 449]]);
    expect(core.meta.phase_starts).toEqual({ pretest: 1, training: 65, posttest: 385, methylated: 449 });
    parts.forEach((p) => {
      const spec = PRESETS.pretrained.phases.find((x) => x.name === p.name)!;
      expect(p.trials.every((t) => t.sample === spec.sample && t.feedback === spec.feedback)).toBe(true);
    });
    const cs = parts[3].trials.filter((t) => t.label === 'C');
    const share = cs.filter((t) => t.centre_mC).length / cs.length;
    expect(share).toBeGreaterThan(0.55); expect(share).toBeLessThan(0.95);
  });

  it('hides live accuracy in no-feedback parts and shows it when feedback returns', () => {
    const core = new SessionCore(S2, data, { seed: 3 });
    answer(core, 30, () => true);
    expect(core.liveAccuracy(50)).toBeNull();
    answer(core, 40, () => true);
    expect(core.phase!.name).toBe('training');
    expect(core.liveAccuracy(50)).toBe(1);
  });

  it('ends a criterion part early (session-1 preset)', () => {
    const core = new SessionCore({ ...DEFAULT_CONFIG, protocol: 'first', phases: PRESETS.first.phases }, data, { seed: 4 });
    answer(core, 299, () => true);
    expect(core.phase!.name).toBe('learning');
    answer(core, 1, () => true);
    expect(core.phase!.name).toBe('methylated');
    expect(core.meta.phase_starts!.methylated).toBe(301);
  });

  it('session 3: five parts, two-choice parts only show/accept their bases, easy traces first', () => {
    const core = new SessionCore(DEFAULT_CONFIG, data, { seed: 21 });
    answer(core, 64, () => true);
    expect(core.phase!.name).toBe('cg');
    expect(core.allowedBase('C')).toBe('C'); expect(core.allowedBase('A')).toBeNull(); expect(core.allowedBase('T')).toBeNull();
    answer(core, 10_000, (i) => i % 2 === 0);
    expect(core.endReason(0)).toBe('protocol_complete');
    const parts = phaseList({ meta: core.meta, trials: core.trials } as Session);
    expect(parts.map((p) => [p.name, p.trials.length])).toEqual([['pretest', 64], ['cg', 160], ['ag', 96], ['mixed', 192], ['posttest', 64]]);
    expect(parts[1].trials.every((t) => 'CG'.includes(t.label) && t.choices === 'CG' && 'CG'.includes(t.pressed))).toBe(true);
    expect(parts[2].trials.every((t) => 'AG'.includes(t.label) && t.choices === 'AG')).toBe(true);
    expect(parts[3].trials.every((t) => !t.choices)).toBe(true);
    BASES.filter((b) => 'CG'.includes(b)).forEach((b) => expect(parts[1].trials.filter((t) => t.label === b)).toHaveLength(80));
    const mean = (ts: { easiness?: number }[]) => ts.reduce((a, t) => a + (t.easiness ?? 0), 0) / ts.length;
    expect(mean(parts[1].trials.slice(0, 32))).toBeGreaterThan(80);   // starts easy
    expect(mean(parts[1].trials.slice(-32))).toBeLessThan(45);        // ends hard
  });

  it('two-choice scoring: models pick the better-ranked offered base; explain overlay renders', () => {
    const w = data.windows.find((x) => x.label === 'C')!;
    const t = { choices: 'CG', label: 'C' } as never;
    expect(modelAnswer(t, w, 'logreg')).toBe('G');   // logreg ranks the true base last → picks G of {C,G}
    expect(modelAnswer(t, w, 'cnn')).toBe('C');
    expect(contrastBase(w, 'C', ['C', 'G'])).toBe('G');
    expect(contrastBase(w, 'T', ['A', 'C', 'G', 'T'])).toBe('T');
    const svg = explainMarkup(w, data.kmer, 'G', true);
    expect(svg).toContain('expected if C'); expect(svg).toContain('expected if G'); expect(svg).toContain('stroke-dasharray');
  });

  it('never shows windows from earlier sessions', () => {
    const exclude = new Set(data.windows.filter((w) => w.sample === 'DM' && w.id % 3 === 0).map((w) => w.id));
    const core = new SessionCore(DEFAULT_CONFIG, data, { seed: 5, exclude, prior: { sessions: 1, trials: 484, session_ids: ['x'], excluded_windows: exclude.size } });
    answer(core, 640, () => true);
    expect(core.trials.some((t) => exclude.has(t.window_id))).toBe(false);
    expect(core.meta.prior!.trials).toBe(484);
  });

  it('logs consistently and maps custom keys to bases', () => {
    const core = new SessionCore({ ...DEFAULT_CONFIG, keys: ['F', 'J', 'K', 'L'] }, data, { seed: 6 });
    answer(core, 100, (i) => i % 3 !== 0);
    core.trials.forEach((t, i) => {
      expect(t.trial).toBe(i + 1);
      expect(t.correct).toBe(t.pressed === t.label);
      expect(t.pressed).toBe(BASES['FJKL'.indexOf(t.pressed_key)]);
    });
  });
});

describe('analysis, history, export', () => {
  const s = simulateSession({ ...DEFAULT_CONFIG, protocol: 'pretrained', phases: PRESETS.pretrained.phases }, data, 11);
  const byId = new Map(data.windows.map((w) => [w.id, w]));
  it('simulated session completes the protocol; CSV has every trial', () => {
    expect(s.meta.end_reason).toBe('protocol_complete');
    const lines = trialsToCsv(s).trim().split('\n');
    expect(lines).toHaveLength(s.trials.length + 1);
    expect(lines[0].split(',')).toEqual(['session_id', ...CSV_COLUMNS]);
  });
  it('per-part stats and benchmarks on exactly the trials shown', () => {
    const ps = phaseStats(s, DEFAULT_ANALYSIS);
    expect(ps.map((p) => p.name)).toEqual(['pretest', 'training', 'posttest', 'methylated']);
    ps.forEach((p) => { expect(p.ci[0]).toBeLessThanOrEqual(p.acc!); expect(p.ci[1]).toBeGreaterThanOrEqual(p.acc!); });
    const subs = benchmarkSubsets(s);
    expect(modelAccuracy(subs[0].trials, byId, 'sup')).toBe(1);
    expect(modelAccuracy(subs[0].trials, byId, 'logreg')).toBe(0);
  });
  it('same-experience learners are warm-started on prior sessions and skip no-feedback trials', () => {
    const priorIds = data.windows.filter((w) => w.sample === 'DM').slice(0, 400).map((w) => w.id);
    const cold = streamLearners(s, byId, 7, []), warm = streamLearners(s, byId, 7, priorIds);
    cold.forEach((l) => expect(l.correct).toHaveLength(s.trials.length));
    const first = (l: { correct: boolean[] }) => l.correct.slice(0, 64).filter(Boolean).length;
    expect(first(warm[1])).toBeGreaterThan(first(cold[1]));
    expect(first(cold[1])).toBeLessThan(30);
  });
  it('history entry: final accuracy uses feedback trials only', () => {
    const e = entryFromSession(s);
    expect(e.n_trials).toBe(s.trials.length);
    expect(e.window_ids).toHaveLength(s.trials.length);
    const fb = s.trials.filter((t) => t.feedback !== 'none' && t.sample === 'DM').slice(-100);
    expect(e.final.acc).toBeCloseTo(fb.filter((t) => t.correct).length / fb.length);
  });
  it('still reads session-1 data (no feedback field, legacy phase names)', () => {
    const legacy = { ...s, meta: { ...s.meta, config: { ...s.meta.config, phases: undefined as never } }, trials: s.trials.map(({ feedback: _f, ...t }) => ({ ...t, phase: t.sample === 'DM' ? 'learning' : 'methylated' })) } as Session;
    expect(phaseList(legacy).map((p) => p.label)).toEqual(['Learning', 'Methylated DNA']);
    expect(streamLearners(legacy, byId, 7, [])[0].correct).toHaveLength(legacy.trials.length);
  });
  it('features match the Python representation (128 resampled + 128 mask)', () => {
    expect(features(data.windows[0])).toHaveLength(256);
  });
});
