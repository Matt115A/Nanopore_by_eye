import { useEffect, useMemo, useState } from 'react';
import { C, LineChart } from '../components/charts';
import { Trace } from '../components/Trace';
import { DEFAULT_ANALYSIS, modelAnswer, phaseList, rollingAccuracy } from '../lib/analysis';
import { BASES, type Base, type Dataset, type Session, type Win } from '../lib/types';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const SPEEDS = [1, 3, 8, 20];

export function Replay({ session, data, byId }: { session: Session; data: Dataset; byId: Map<number, Win> }) {
  const trials = session.trials, n = trials.length;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);
  const [ctx, setCtx] = useState(true);
  const accS = useMemo(() => rollingAccuracy(session, { ...DEFAULT_ANALYSIS, window: 30 }), [session]);
  const accAt = useMemo(() => new Map(accS.map((p) => [p.x, p.y])), [accS]);
  const t = trials[idx];
  const w = t ? byId.get(t.window_id)! : null;
  const parts = useMemo(() => phaseList(session), [session]);
  const part = parts.find((p) => p.name === t?.phase);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setIdx((i) => (i >= n - 1 ? (setPlaying(false), i) : i + 1)), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, n]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(n - 1, i + (e.shiftKey ? 10 : 1)));
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - (e.shiftKey ? 10 : 1)));
      else if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [n]);

  if (!t || !w) return <div className="empty">No trials recorded.</div>;
  return (
    <div>
      <div className="card" style={{ padding: '14px 18px' }}>
        <div className="scrub">
          <button className="btn btn-sm" style={{ width: 74 }} onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <input type="range" min={0} max={n - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} />
          <span className="muted" style={{ minWidth: 90, textAlign: 'right' }}>{t.trial} / {n}</span>
          <select className="btn btn-sm" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s} trials/s</option>)}</select>
          <select className="btn btn-sm" value={part?.name} onChange={(e) => setIdx(parts.find((p) => p.name === e.target.value)!.start - 1)}>{parts.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}</select>
          <label className="muted" style={{ fontSize: 13 }}><input type="checkbox" checked={ctx} onChange={(e) => setCtx(e.target.checked)} /> show sequence</label>
        </div>
        <div className="note" style={{ marginTop: 6 }}>← → step · Shift+← → ×10 · Space play/pause</div>
      </div>
      <div className="replay">
        <section className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className={`phase-pill ${t.sample === 'MSssI' ? 'relearn' : ''}`}>{part?.label}</span>{t.feedback === 'none' && <span className="phase-pill">no feedback shown</span>}
            {t.centre_mC && <span className="phase-pill relearn">methylated C</span>}
          </div>
          <Trace win={w} state={t.correct ? 'correct' : 'wrong'} showContext={ctx} className="trace-small" explain={data.kmer ? { kmer: data.kmer, pressed: t.pressed, choices: (t.choices ?? 'ACGT').split('') as Base[], band: session.meta.config.phases?.find((p) => p.name === t.phase)?.band } : undefined} />
          <div className="replay-stage" style={{ minHeight: 0, padding: '18px 0 6px' }}>
            <div className="keys" style={{ marginTop: 0 }}>
              {BASES.map((b) => <div key={b} className={`keycap ${b === t.pressed ? (t.correct ? 'kc-correct' : 'kc-wrong') : b === t.label ? 'kc-reveal' : ''}`}>{b}</div>)}
            </div>
            <div className="rp-meta">
              <div className="kpi"><div className="kpi-label">Trial</div><div className="kpi-value">{t.trial}</div></div>
              <div className="kpi"><div className="kpi-label">You</div><div className="kpi-value" style={{ color: t.correct ? C.good : C.bad }}>{t.pressed}</div></div>
              <div className="kpi"><div className="kpi-label">RT</div><div className="kpi-value">{Math.round(t.rt_ms)} ms</div></div>
              <div className="kpi"><div className="kpi-label">Accuracy (30)</div><div className="kpi-value">{accAt.has(t.trial) ? pct(accAt.get(t.trial)!) : '—'}</div></div>
            </div>
          </div>
          <LineChart height={130} series={[{ name: 'Accuracy', color: C.yellow, points: accS }]} xDomain={[1, n]} yDomain={[0, 1]} yTicks={[0, 0.25, 0.5, 1]} yFormat={pct}
            markers={parts.slice(1).map((p) => ({ x: p.start - 0.5, label: '' }))} cursorX={t.trial} hover={false} refLines={[{ y: 0.25, label: '' }]} />
        </section>
        <section className="card">
          <h3 className="card-title">The machines on this trace</h3>
          <p className="card-sub">Answer: <b>{t.label}</b>. Same window for everyone; Dorado also sees the rest of the read.</p>
          <div className="model-row" style={{ marginTop: 14 }}>
            <span><b style={{ color: C.yellow }}>You</b></span><span className={`badge ${t.correct ? 'badge-good' : 'badge-bad'}`}>{t.pressed} {t.correct ? '✓' : '✗'}</span>
            {data.models.map((m) => {
              const p = modelAnswer(t, w, m.name), ok = p === t.label;
              return [<span key={m.name}>{m.label} <span className="tag">{m.kind}</span></span>, <span key={m.name + 'p'} className={`badge ${ok ? 'badge-good' : 'badge-bad'}`}>{p === '-' ? 'skipped' : p} {ok ? '✓' : '✗'}</span>];
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
