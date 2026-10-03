import { useMemo, useRef, useState } from 'react';
import { Bars, C, Card, Heatmap, type HeatRow, Legend, LineChart } from '../components/charts';
import {
  type AnalysisOpts, DEFAULT_ANALYSIS, acc, benchmarkSubsets, confusion, methylationEffect, milestones, modelAccuracy,
  phaseStats, rollingAccuracy, rollingRt, rollingSeries, streamLearners,
} from '../lib/analysis';
import type { HistoryEntry } from '../lib/history';
import { BASES, type Dataset, type Session, type Win } from '../lib/types';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const ms = (v: number) => `${Math.round(v)} ms`;
const PCT_TICKS = [0, 0.25, 0.5, 0.75, 1];
const MODEL_COLORS: Record<string, string> = { level: '#9cc3e6', knn: '#199e70', logreg: '#c98500', cnn: '#3987e5', fast: '#e87ba4', hac: '#d95926', sup: '#f4f4f0' };
const BASE_COLORS: Record<string, string> = { A: '#3987e5', C: '#d95926', G: '#199e70', T: '#c98500' };
const FEEDBACK_LABEL: Record<string, string> = { none: 'no feedback', correctness: 'right / wrong', sequence: 'right / wrong + sequence', explain: 'right / wrong + expected traces' };

export function Analysis({ session, data, byId, prior }: { session: Session; data: Dataset; byId: Map<number, Win>; prior: HistoryEntry[] }) {
  const [o, setO] = useState<AnalysisOpts>(DEFAULT_ANALYSIS);
  const n = session.trials.length;
  const priorN = prior.reduce((a, e) => a + e.n_trials, 0);
  const priorIds = useMemo(() => prior.flatMap((e) => e.window_ids), [prior]);
  const lastPrior = prior[prior.length - 1];
  const xDomain: [number, number] = [1, Math.max(2, n)];

  const r = useMemo(() => {
    const phases = phaseStats(session, o);
    const stream = streamLearners(session, byId, 7, priorIds);
    const firstFeedback = phases.find((p) => p.feedback !== 'none');
    return {
      phases,
      acc: rollingAccuracy(session, o),
      rt: rollingRt(session, o),
      stream: stream.map((sl) => ({ ...sl, series: rollingSeries(session.trials, sl.correct, o.window) })),
      subsets: benchmarkSubsets(session),
      meth: methylationEffect(session, o),
      ms: firstFeedback ? milestones(firstFeedback.trials, o) : [],
    };
  }, [session, byId, o, priorIds]);

  const markers = r.phases.slice(1).map((p) => ({ x: p.start - 0.5, label: p.label.replace(/ \(.*\)/, '') }));
  const refs = { acc: useRef<SVGSVGElement>(null), rt: useRef<SVGSVGElement>(null), stream: useRef<SVGSVGElement>(null), bench: useRef<SVGSVGElement>(null), mc: useRef<SVGSVGElement>(null), bases: useRef<SVGSVGElement>(null) };
  const dmTrials = session.trials.filter((t) => t.sample === 'DM');
  const hasMeth = session.trials.some((t) => t.sample === 'MSssI');
  const shift = (pts: { x: number; y: number }[]) => pts.map((p) => ({ x: p.x + priorN, y: p.y }));
  const de = data.dataEfficiency;
  const confRows = (mat: number[][]): HeatRow[] => mat.map((row, i) => {
    const tot = row.reduce((a, b) => a + b, 0) || 1;
    return { label: BASES[i], values: row.map((v) => v / tot), texts: row.map((v) => (v ? pct(v / tot) : '·')), marks: row.map((_, j) => (i === j ? 'target' : null)), title: row.map((v, j) => `${BASES[i]} shown → ${BASES[j]} pressed: ${v}`) };
  });
  const pre = r.phases.find((p) => p.name === 'pretest'), post = r.phases.find((p) => p.name === 'posttest');

  return (
    <div>
      <div className="controls">
        <label>Rolling window <select value={o.window} onChange={(e) => setO({ ...o, window: Number(e.target.value) })}>{[20, 30, 50, 100].map((w) => <option key={w}>{w}</option>)}</select></label>
        <label><input type="checkbox" checked={o.excludeIncorrectRt} onChange={(e) => setO({ ...o, excludeIncorrectRt: e.target.checked })} /> RT: correct only</label>
        <label><input type="checkbox" checked={o.useMinRt} onChange={(e) => setO({ ...o, useMinRt: e.target.checked })} /> exclude RT &lt;<input type="number" value={o.minRt} onChange={(e) => setO({ ...o, minRt: Number(e.target.value) })} /> ms</label>
        <label><input type="checkbox" checked={o.useMaxRt} onChange={(e) => setO({ ...o, useMaxRt: e.target.checked })} /> exclude RT &gt;<input type="number" value={o.maxRt} onChange={(e) => setO({ ...o, maxRt: Number(e.target.value) })} /> ms</label>
      </div>

      <div className="kpis">
        <Kpi label="Experience" value={`${priorN + n}`} sub={priorN ? `${priorN} before this session + ${n} now` : `${n} trials`} />
        {r.phases.slice(0, 4).map((p) => <Kpi key={p.name} label={p.label} value={pct(p.acc)} sub={`n=${p.n} · ${FEEDBACK_LABEL[p.feedback]}`} />)}
        <Kpi label="1D CNN on your unmethylated windows" value={pct(modelAccuracy(dmTrials, byId, 'cnn'))} sub={`Dorado sup ${pct(modelAccuracy(dmTrials, byId, 'sup'))}`} />
      </div>

      <Card title="By part" sub="Accuracy with 95% interval, by base. Two-choice parts have 50% chance; models there pick the better-ranked of the two offered bases. The top row is how the previous session ended (last 100 trials with feedback).">
        <table className="data phase-table">
          <thead><tr><th>Part</th><th>Feedback</th><th className="num">n</th><th className="num">Chance</th><th className="num">Accuracy</th><th className="num">95% CI</th>{BASES.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Median RT</th></tr></thead>
          <tbody>
            {lastPrior && (
              <tr className="muted"><td>Previous session (end)</td><td>right / wrong</td><td className="num">100</td><td className="num">25%</td><td className="num">{pct(lastPrior.final.acc)}</td><td />{BASES.map((b) => <td key={b} className="num">{pct(lastPrior.final.byBase[b])}</td>)}<td /></tr>
            )}
            {r.phases.map((p) => (
              <tr key={p.name}>
                <td><b>{p.label}</b></td><td className="muted">{FEEDBACK_LABEL[p.feedback]}</td><td className="num">{p.n}</td><td className="num muted">{pct(p.chance)}</td>
                <td className="num"><b>{pct(p.acc)}</b></td><td className="num muted">{pct(p.ci[0])}–{pct(p.ci[1])}</td>
                {BASES.map((b) => <td key={b} className="num">{pct(p.byBase[b])}</td>)}
                <td className="num">{p.rt ? ms(p.rt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pre && post && <p className="note" style={{ marginTop: 10 }}>Pre-test → post-test: {pct(pre.acc)} → {pct(post.acc)} overall; C {pct(pre.byBase.C)} → {pct(post.byBase.C)}, G {pct(pre.byBase.G)} → {pct(post.byBase.G)}.</p>}
        <Bars svgRef={refs.bases} label="Accuracy by base, per part" domain={[0, 1]} format={pct} height={240}
          bars={r.phases.flatMap((p) => BASES.map((b) => ({ label: `${p.label.split(' ')[0]} ${b}`, value: p.byBase[b], color: BASE_COLORS[b] })))} />
      </Card>

      <div className="grid2">
        <Card title="Accuracy over trials" sub={`Rolling mean of ${o.window} trials (restarts at each part). Dotted: models on the same unmethylated windows.`} svgRef={refs.acc} exportName="accuracy_vs_trial">
          <LineChart svgRef={refs.acc} series={[{ name: 'You', color: C.yellow, points: r.acc, width: 3 }]} xDomain={xDomain} yDomain={[0, 1]} yTicks={PCT_TICKS} yFormat={pct} xLabel="Trial" yLabel="Accuracy" markers={markers}
            refLines={[{ y: 0.25, label: 'chance' }, ...['level', 'cnn'].map((m) => ({ y: modelAccuracy(dmTrials, byId, m) ?? 0, label: data.models.find((x) => x.name === m)?.label ?? m, at: 'start' as const }))]} />
        </Card>
        <Card title="Reaction time" sub={`Rolling median over ${o.window} trials${o.excludeIncorrectRt ? ', correct only' : ''}.`} svgRef={refs.rt} exportName="rt_vs_trial">
          <LineChart svgRef={refs.rt} series={[{ name: 'Median RT', color: C.yellow, points: r.rt, width: 2.5 }]} xDomain={xDomain} yFormat={ms} xLabel="Trial" yLabel="Median RT" markers={markers} />
        </Card>
      </div>

      <Card title="Same experience" svgRef={refs.stream} exportName="same_experience"
        sub={`x = total trials of experience${priorN ? ` (including your ${priorN} earlier trials)` : ''}. The learners saw every trace you saw, in order, with the same right/wrong feedback, and nothing during no-feedback parts — but not the sequence reveal, which only you got. Dots: CNN trained on that many random examples.`}>
        <Legend items={[{ name: 'You', color: C.yellow }, ...r.stream.map((s, i) => ({ name: s.label, color: ['#9cc3e6', '#199e70', '#3987e5'][i] })), { name: 'CNN, n examples', color: '#e87ba4', square: true }]} />
        <LineChart svgRef={refs.stream} height={320}
          series={[{ name: 'You', color: C.yellow, points: shift(r.acc), width: 3 }, ...r.stream.map((s, i) => ({ name: s.label, color: ['#9cc3e6', '#199e70', '#3987e5'][i], points: shift(s.series), width: 1.8 })),
            { name: 'CNN (n examples)', color: '#e87ba4', points: de.n.map((x, i) => ({ x, y: de.cnn[i] })).filter((p) => p.x <= priorN + n), dots: true, width: 1.5, dash: '4 4' }]}
          xDomain={[Math.max(1, priorN), priorN + n]} yDomain={[0, 1]} yTicks={PCT_TICKS} yFormat={pct} xLabel="Total trials of experience" yLabel="Accuracy"
          markers={markers.map((m) => ({ ...m, x: m.x + priorN }))} refLines={[{ y: 0.25, label: 'chance' }]} />
      </Card>

      <Card title="Benchmark on identical windows" sub="Every model answered exactly the traces you answered. Simple models and the CNN see only the window; Dorado sees the whole read." svgRef={refs.bench} exportName="benchmark">
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead><tr><th>Who</th>{r.subsets.map((s) => <th key={s.key} className="num">{s.label} <span className="muted">({s.trials.length})</span></th>)}</tr></thead>
            <tbody>
              <tr><td><b style={{ color: C.yellow }}>You</b></td>{r.subsets.map((s) => <td key={s.key} className="num"><b>{pct(acc(s.trials))}</b></td>)}</tr>
              {data.models.map((m) => (
                <tr key={m.name}><td><span style={{ color: MODEL_COLORS[m.name] }}>●</span> {m.label} <span className="tag">{m.kind}</span></td>
                  {r.subsets.map((s) => <td key={s.key} className="num">{pct(modelAccuracy(s.trials, byId, m.name))}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <Bars svgRef={refs.bench} label={`All ${n} traces from this session`} domain={[0, 1]} format={pct} height={240}
          bars={[{ label: 'You', value: acc(session.trials), color: C.yellow }, ...data.models.map((m) => ({ label: m.label.replace(/^Dorado /, ''), value: modelAccuracy(session.trials, byId, m.name), color: MODEL_COLORS[m.name] }))]} />
      </Card>

      <div className="grid2">
        <Card title="Methylated C" sub="Traces from DNA where every CpG is methylated. The right answer for a methylated C is still C." svgRef={refs.mc} exportName="methylation">
          {!hasMeth ? <div className="empty">No methylated DNA in this session.</div> : (
            <>
              <Bars svgRef={refs.mc} label="Your accuracy on C" domain={[0, 1]} format={pct}
                bars={[{ label: 'normal C (unmethylated DNA)', value: r.meth.preC.acc, color: C.s1, sub: `n=${r.meth.preC.n}` }, { label: 'normal C (methylated DNA)', value: r.meth.postC.acc, color: C.s1, sub: `n=${r.meth.postC.n}` }, { label: 'methylated C', value: r.meth.mc.acc, color: C.s2, sub: `n=${r.meth.mc.n}` }]} />
              <p className="note">On methylated C you pressed: {BASES.map((b) => `${b} ${r.meth.mc.pressed[b]}`).join(' · ')}. Level-only model on the same windows: {pct(modelAccuracy(session.trials.filter((t) => t.centre_mC), byId, 'level'))}.</p>
            </>
          )}
        </Card>
        <Card title="Confusion by part" sub="Row = base shown, column = key pressed.">
          <div className="row" style={{ alignItems: 'flex-start', gap: 22 }}>
            {r.phases.map((p) => <Heatmap key={p.name} rows={confRows(confusion(p.trials, o))} cols={BASES} rowHeader="shown" colHeader={p.label.replace(/ \(.*\)/, '')} cell={38} />)}
          </div>
        </Card>
      </div>

      {r.ms.length > 0 && (
        <Card title="Learning speed" sub={`First trial (in the first part with feedback) at which rolling accuracy over ${o.window} trials reaches each level.`}>
          <table className="data"><thead><tr><th>Level</th><th className="num">Trial</th><th className="num">Median RT there</th></tr></thead>
            <tbody>{r.ms.map((m) => <tr key={m.level}><td>{pct(m.level)}</td><td className="num">{m.trial ?? '—'}</td><td className="num">{m.medianRt ? ms(m.medianRt) : '—'}</td></tr>)}</tbody></table>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="kpi"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{sub && <div className="kpi-sub">{sub}</div>}</div>;
}
