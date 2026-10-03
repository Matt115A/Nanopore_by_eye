import { features, levelFeatures } from './dataset';
import { BASES, type Base, type Dataset, type Session, type TrialRecord, type Win } from './types';

export interface AnalysisOpts { window: number; excludeIncorrectRt: boolean; useMinRt: boolean; minRt: number; useMaxRt: boolean; maxRt: number }
export const DEFAULT_ANALYSIS: AnalysisOpts = { window: 50, excludeIncorrectRt: true, useMinRt: true, minRt: 150, useMaxRt: true, maxRt: 5000 };
export interface Pt { x: number; y: number }

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const inBounds = (t: TrialRecord, o: AnalysisOpts) => !(o.useMinRt && t.rt_ms < o.minRt) && !(o.useMaxRt && t.rt_ms > o.maxRt);
export const rtOk = (t: TrialRecord, o: AnalysisOpts) => inBounds(t, o) && (!o.excludeIncorrectRt || t.correct);
export const acc = (ts: { correct: boolean }[]) => (ts.length ? ts.filter((t) => t.correct).length / ts.length : null);

/** Trailing-window mean of a boolean series over trial number; restarts at the twist. */
export function rollingSeries(trials: TrialRecord[], ok: boolean[], w: number, include: (t: TrialRecord) => boolean = () => true): Pt[] {
  const out: Pt[] = []; let buf: boolean[] = []; let phase = trials[0]?.phase;
  trials.forEach((t, i) => {
    if (t.phase !== phase) { buf = []; phase = t.phase; }
    if (!include(t)) return;
    buf.push(ok[i]); if (buf.length > w) buf.shift();
    if (buf.length >= Math.min(10, w)) out.push({ x: t.trial, y: buf.filter(Boolean).length / buf.length });
  });
  return out;
}

export function rollingAccuracy(s: Session, o: AnalysisOpts) {
  return rollingSeries(s.trials, s.trials.map((t) => t.correct), o.window, (t) => inBounds(t, o));
}

export function rollingRt(s: Session, o: AnalysisOpts): Pt[] {
  const out: Pt[] = []; let buf: { t: number; rt: number }[] = []; let phase = s.trials[0]?.phase;
  for (const t of s.trials) {
    if (t.phase !== phase) { buf = []; phase = t.phase; }
    if (rtOk(t, o)) buf.push({ t: t.trial, rt: t.rt_ms });
    buf = buf.filter((b) => b.t > t.trial - o.window);
    if (buf.length >= 5) out.push({ x: t.trial, y: median(buf.map((b) => b.rt))! });
  }
  return out;
}

export function confusion(trials: TrialRecord[], o: AnalysisOpts): number[][] {
  const m = BASES.map(() => BASES.map(() => 0));
  trials.forEach((t) => { if (inBounds(t, o)) m[BASES.indexOf(t.label)][BASES.indexOf(t.pressed)]++; });
  return m;
}

export interface Milestone { level: number; trial: number | null; inPhase: number | null; medianRt: number | null }
export function milestones(trials: TrialRecord[], o: AnalysisOpts, levels = [0.4, 0.5, 0.6, 0.7]): Milestone[] {
  const ts = trials.filter((t) => inBounds(t, o));
  return levels.map((level) => {
    for (let i = o.window - 1; i < ts.length; i++) {
      const win = ts.slice(i - o.window + 1, i + 1);
      if (win.filter((t) => t.correct).length / o.window >= level - 1e-9)
        return { level, trial: ts[i].trial, inPhase: ts[i].trial - (trials[0]?.trial ?? 1) + 1, medianRt: median(win.filter((t) => rtOk(t, o)).map((t) => t.rt_ms)) };
    }
    return { level, trial: null, inPhase: null, medianRt: null };
  });
}

/** A model's answer on a trial: on two-choice trials, ML models pick whichever offered base they rank higher. */
export function modelAnswer(t: TrialRecord, w: Win, model: string): string {
  if (t.choices && t.choices.length < 4 && w.ranks[model]) return [...w.ranks[model]].find((b) => t.choices!.includes(b)) ?? w.preds[model];
  return w.preds[model];
}

/** Model accuracy on exactly the windows of the given trials. */
export function modelAccuracy(trials: TrialRecord[], byId: Map<number, Win>, model: string): number | null {
  if (!trials.length) return null;
  let c = 0;
  for (const t of trials) if (modelAnswer(t, byId.get(t.window_id)!, model) === t.label) c++;
  return c / trials.length;
}

export const chanceOf = (t: { choices?: string }) => 1 / (t.choices?.length || 4);

export interface Subset { key: string; label: string; trials: TrialRecord[] }

const LEGACY_LABELS: Record<string, string> = { learning: 'Learning', methylated: 'Methylated DNA' };

/** Parts in the order they occurred, with labels and start trials. */
export function phaseList(s: Session) {
  const out: { name: string; label: string; start: number; feedback: string; trials: TrialRecord[] }[] = [];
  for (const t of s.trials) {
    let cur = out[out.length - 1];
    if (!cur || cur.name !== t.phase) {
      const spec = s.meta.config.phases?.find((p) => p.name === t.phase);
      cur = { name: t.phase, label: spec?.label ?? LEGACY_LABELS[t.phase] ?? t.phase, start: t.trial, feedback: t.feedback ?? 'correctness', trials: [] };
      out.push(cur);
    }
    cur.trials.push(t);
  }
  return out;
}

/** Wilson 95% interval for a proportion. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function benchmarkSubsets(s: Session): Subset[] {
  const meth = s.trials.filter((t) => t.sample === 'MSssI');
  return [
    { key: 'all', label: 'All trials', trials: s.trials },
    ...phaseList(s).map((p) => ({ key: p.name, label: p.label, trials: p.trials })),
    { key: 'mc', label: 'Methylated-C windows', trials: meth.filter((t) => t.centre_mC) },
  ].filter((x) => x.trials.length);
}

// ── learners that see exactly the human's stream (predict trial t from trials < t) ──

function standardiser(ws: Win[]) {
  const f = ws.map((w) => features(w));
  const dim = f[0].length, mean = new Float32Array(dim), sd = new Float32Array(dim);
  f.forEach((v) => v.forEach((x, i) => (mean[i] += x / f.length)));
  f.forEach((v) => v.forEach((x, i) => (sd[i] += (x - mean[i]) ** 2 / f.length)));
  sd.forEach((v, i) => (sd[i] = Math.sqrt(v) || 1));
  return f.map((v) => v.map((x, i) => (x - mean[i]) / sd[i]));
}

export interface StreamLearner { key: string; label: string; correct: boolean[] }

export function streamLearners(s: Session, byId: Map<number, Win>, k = 7, priorIds: number[] = []): StreamLearner[] {
  // Prior sessions' windows are learned from first (no predictions recorded), so the learners
  // have had the same experience as the participant before this session started.
  const prior = priorIds.map((id) => byId.get(id)).filter((w): w is Win => !!w);
  const P = prior.length;
  const ws = [...prior, ...s.trials.map((t) => byId.get(t.window_id)!)];
  const F = standardiser(ws);
  const lab = ws.map((w) => BASES.indexOf(w.label));
  const dist = (a: Float32Array, b: Float32Array) => { let d = 0; for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2; return d; };
  // nearest centroid
  const sums = BASES.map(() => new Float32Array(F[0]?.length ?? 0)), cnt = [0, 0, 0, 0];
  const nc: boolean[] = [], knn: boolean[] = [], lv: boolean[] = [];
  // level-only Gaussian (per-base running mean/var of centre mean, sd, log dwell)
  const L = ws.map((w) => { const [m, sd, n] = levelFeatures(w); return [m, sd, Math.log(n)]; });
  const ls = BASES.map(() => [0, 0, 0]), lss = BASES.map(() => [0, 0, 0]);
  F.forEach((f, t) => {
    // predict
    if (t === 0) { nc.push(false); knn.push(false); lv.push(false); }
    else {
      const offered = t >= P ? (s.trials[t - P].choices ?? 'ACGT') : 'ACGT';
      const allowed = (b: number) => offered.includes(BASES[b]);
      let best = -1, bd = Infinity;
      cnt.forEach((c, b) => { if (!c || !allowed(b)) return; const cen = sums[b].map((x) => x / c); const d = dist(f, cen); if (d < bd) { bd = d; best = b; } });
      nc.push(best === lab[t]);
      const ds = F.slice(0, t).map((g, i) => [dist(f, g), lab[i]] as const).sort((a, b) => a[0] - b[0]).slice(0, k);
      const votes = [0, 0, 0, 0]; ds.forEach(([d, l]) => (votes[l] += 1 / (1 + d)));
      BASES.forEach((_, b) => { if (!allowed(b)) votes[b] = -1; });
      knn.push(votes.indexOf(Math.max(...votes)) === lab[t]);
      let lb = -1, lbest = -Infinity;
      cnt.forEach((c, b) => {
        if (c < 2 || !allowed(b)) return;
        let ll = 0;
        for (let j = 0; j < 3; j++) { const m = ls[b][j] / c, v = Math.max(1e-3, lss[b][j] / c - m * m); ll += -0.5 * Math.log(v) - (L[t][j] - m) ** 2 / (2 * v); }
        if (ll > lbest) { lbest = ll; lb = b; }
      });
      lv.push(lb === lab[t]);
    }
    // learn from feedback — but not from trials where the participant got none
    if (t >= P && (s.trials[t - P].feedback ?? 'correctness') === 'none') return;
    const b = lab[t]; cnt[b]++; f.forEach((x, i) => (sums[b][i] += x));
    for (let j = 0; j < 3; j++) { ls[b][j] += L[t][j]; lss[b][j] += L[t][j] ** 2; }
  });
  return [
    { key: 'stream_level', label: 'Level-only learner', correct: lv.slice(P) },
    { key: 'stream_centroid', label: 'Nearest-centroid learner', correct: nc.slice(P) },
    { key: 'stream_knn', label: `${k}-nearest-neighbour learner`, correct: knn.slice(P) },
  ];
}

/** Twist analysis: methylated-C windows vs canonical C, and what was pressed instead. */
export function methylationEffect(s: Session, o: AnalysisOpts) {
  const pre = s.trials.filter((t) => t.sample === 'DM' && inBounds(t, o));
  const post = s.trials.filter((t) => t.sample === 'MSssI' && inBounds(t, o));
  const preC = pre.filter((t) => t.label === 'C').slice(-60);
  const mc = post.filter((t) => t.centre_mC);
  const postC = post.filter((t) => t.label === 'C' && !t.centre_mC);
  const others = post.filter((t) => t.label !== 'C');
  const pressed = (ts: TrialRecord[]) => Object.fromEntries(BASES.map((b) => [b, ts.filter((t) => t.pressed === b).length])) as Record<Base, number>;
  return {
    preC: { n: preC.length, acc: acc(preC), pressed: pressed(preC) },
    mc: { n: mc.length, acc: acc(mc), pressed: pressed(mc) },
    postC: { n: postC.length, acc: acc(postC), pressed: pressed(postC) },
    othersCtxMC: { n: others.filter((t) => t.n_mC_context > 0).length, acc: acc(others.filter((t) => t.n_mC_context > 0)) },
    othersNoMC: { n: others.filter((t) => t.n_mC_context === 0).length, acc: acc(others.filter((t) => t.n_mC_context === 0)) },
  };
}

/** Per-part summary: accuracy (95% CI), per-base accuracy, median RT. */
export function phaseStats(s: Session, o: AnalysisOpts) {
  return phaseList(s).map((p) => {
    const ts = p.trials.filter((t) => inBounds(t, o));
    const k = ts.filter((t) => t.correct).length;
    const byBase = Object.fromEntries(BASES.map((b) => [b, acc(ts.filter((t) => t.label === b))])) as Record<Base, number | null>;
    return { ...p, chance: chanceOf(p.trials[0]), n: ts.length, acc: ts.length ? k / ts.length : null, ci: wilson(k, ts.length), byBase, rt: median(ts.filter((t) => rtOk(t, o)).map((t) => t.rt_ms)) };
  });
}

export function modelLabel(data: Dataset, key: string) { return data.models.find((m) => m.name === key)?.label ?? key; }
