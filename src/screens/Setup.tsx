import { useMemo, useRef, useState } from 'react';
import type { DebugOpts } from '../App';
import { PUBLIC, PUBLIC_PRESETS } from '../lib/env';
import { loadLocal } from '../lib/export';
import { addToHistory, type HistoryEntry, removeFromHistory } from '../lib/history';
import { type Config, type Dataset, DEFAULT_CONFIG, type FeedbackMode, type PhaseSpec, PRESETS, type Session } from '../lib/types';

interface Props {
  data: Dataset;
  initial: Config;
  debug: DebugOpts;
  setDebug: (d: DebugOpts) => void;
  history: HistoryEntry[];
  setHistory: (h: HistoryEntry[]) => void;
  onStart: (c: Config) => void;
  onSimulate: (c: Config) => void;
  onOpenSession: (s: Session) => void;
}

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const FEEDBACK_TEXT: Record<FeedbackMode, string> = { none: 'none', correctness: 'right / wrong', sequence: 'right / wrong + sequence', explain: 'right / wrong + expected traces' };

function validate(c: Config): string | null {
  if (c.keys.length !== 4 || new Set(c.keys).size !== 4) return 'Enter four different keys (for A, C, G, T).';
  if (!c.phases.length || c.phases.some((p) => p.trials < 1)) return 'Every part needs at least one trial.';
  return null;
}

async function readSession(f: File): Promise<Session | null> {
  try { const s = JSON.parse(await f.text()) as Session; return s.meta && Array.isArray(s.trials) ? s : null; } catch { return null; }
}

export function Setup({ initial, debug, setDebug, history, setHistory, onStart, onSimulate, onOpenSession }: Props) {
  const [c, setC] = useState<Config>(initial);
  const [keysText, setKeysText] = useState(initial.keys.join(''));
  const openRef = useRef<HTMLInputElement>(null);
  const histRef = useRef<HTMLInputElement>(null);
  const last = useMemo(() => loadLocal(), []);
  const cfg: Config = { ...c, keys: keysText.toUpperCase().replace(/\s+/g, '').split('') };
  const err = validate(cfg);
  const priorTrials = history.reduce((a, e) => a + e.n_trials, 0);
  const seen = new Set(history.flatMap((e) => e.window_ids)).size;
  const setPhase = (i: number, patch: Partial<PhaseSpec>) => setC({ ...c, phases: c.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const total = c.phases.reduce((a, p) => a + p.trials, 0);
  const estMin = c.phases.reduce((a, p) => a + p.trials * (1400 + p.feedbackMs + c.itiMs), 0) / 60000;

  return (
    <div className="screen">
      <div className="setup" style={{ width: 'min(900px, 100%)' }}>
        <h1 className="title">Reading DNA by eye</h1>
        <p className="subtitle">Real nanopore current from E. coli (R10.4.1) · learn to press the base in the highlighted stretch.</p>
        {PUBLIC && <About />}

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head"><div><h3 className="card-title">Your experience</h3>
            <p className="card-sub">{history.length ? `${priorTrials} trials over ${history.length} session${history.length > 1 ? 's' : ''}. ${c.excludeSeen ? `Those ${seen} windows won't be shown again.` : 'Seen windows may repeat.'}` : 'No previous sessions recorded on this machine.'}</p></div>
            <div className="card-actions">
              <button className="btn btn-sm" onClick={() => histRef.current?.click()}>Add past session file…</button>
              <input ref={histRef} type="file" accept=".json" hidden onChange={async (e) => { const s = e.target.files?.[0] && (await readSession(e.target.files[0])); if (s) setHistory(addToHistory(s)); else alert('Not a session JSON.'); }} />
            </div>
          </div>
          {history.length > 0 && (
            <table className="data"><thead><tr><th>Session</th><th className="num">Trials</th><th className="num">Final accuracy</th><th className="num">A · C · G · T</th><th /></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.session_id}><td>{new Date(h.start_time).toLocaleString()}</td><td className="num">{h.n_trials}</td><td className="num">{pct(h.final.acc)}</td>
                  <td className="num muted">{['A', 'C', 'G', 'T'].map((b) => pct(h.final.byBase[b])).join(' · ')}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => setHistory(removeFromHistory(h.session_id))}>remove</button></td></tr>
              ))}</tbody></table>
          )}
          <label className="row" style={{ gap: 8, marginTop: 10, fontSize: 14 }}><input type="checkbox" checked={c.excludeSeen} onChange={(e) => setC({ ...c, excludeSeen: e.target.checked })} /> Never show a window I've seen before</label>
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head"><div><h3 className="card-title">Protocol</h3><p className="card-sub">{PRESETS[c.protocol]?.description ?? 'Custom protocol.'}</p></div>
            <select className="btn btn-sm" value={c.protocol} onChange={(e) => setC({ ...c, protocol: e.target.value, phases: structuredClone(PRESETS[e.target.value].phases) })}>
              {(PUBLIC ? PUBLIC_PRESETS : Object.keys(PRESETS)).map((k) => <option key={k} value={k}>{PRESETS[k].title}</option>)}
            </select>
          </div>
          <table className="data">
            <thead><tr><th>Part</th><th>DNA</th><th>Bases</th><th className="num">Trials</th><th>Feedback</th><th className="num">Feedback shown for</th></tr></thead>
            <tbody>{c.phases.map((p, i) => (
              <tr key={p.name}>
                <td>{i + 1}. {p.label}{p.endOnCriterion && <span className="muted"> (ends early at {pct(p.endOnCriterion.threshold)})</span>}</td>
                <td className="muted">{p.sample === 'DM' ? 'unmethylated' : 'CpG-methylated'}</td><td className="muted">{(p.choices ?? ['A', 'C', 'G', 'T']).join(' ')}{p.order === 'easyFirst' ? ' · easy first' : ''}</td>
                <td className="num">{PUBLIC ? p.trials : <input type="number" style={{ width: 70 }} value={p.trials} onChange={(e) => setPhase(i, { trials: Number(e.target.value) })} />}</td>
                <td>{PUBLIC ? FEEDBACK_TEXT[p.feedback] : (
                  <select value={p.feedback} onChange={(e) => setPhase(i, { feedback: e.target.value as FeedbackMode })}>
                    {Object.entries(FEEDBACK_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>)}</td>
                <td className="num">{PUBLIC ? p.feedbackMs : <input type="number" style={{ width: 70 }} value={p.feedbackMs} onChange={(e) => setPhase(i, { feedbackMs: Number(e.target.value) })} />} ms</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="note" style={{ marginTop: 8 }}>{total} trials · roughly {Math.round(estMin)} min. Session stops at {c.maxDurationMin} min regardless.</p>
        </div>

        <div className="setup-grid">
          <div className="field"><label>Keys for A · C · G · T {PUBLIC && <span className="muted">(e.g. FJKL if you prefer)</span>}</label><input type="text" value={keysText} maxLength={4} onChange={(e) => setKeysText(e.target.value.toUpperCase())} /></div>
          {!PUBLIC && <>
          <div className="field"><label>Inter-trial interval</label><div className="field-inline"><input type="number" value={c.itiMs} onChange={(e) => setC({ ...c, itiMs: Number(e.target.value) })} /><span className="unit">ms</span></div></div>
          <div className="field"><label>Methylated share of C trials</label><div className="field-inline"><input type="number" value={Math.round(c.mCFraction * 100)} onChange={(e) => setC({ ...c, mCFraction: Number(e.target.value) / 100 })} /><span className="unit">%</span></div></div>
          <div className="field"><label>Max session duration</label><div className="field-inline"><input type="number" value={c.maxDurationMin} onChange={(e) => setC({ ...c, maxDurationMin: Number(e.target.value) })} /><span className="unit">min</span></div></div>
          </>}
        </div>

        {debug.enabled && (
          <div className="debug-panel">
            <h4>DEBUG MODE (Shift+D to hide)</h4>
            <div className="row">
              <button className="btn btn-sm" disabled={!!err} onClick={() => onSimulate(cfg)}>Simulate full session instantly</button>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={debug.autoplay} onChange={(e) => setDebug({ ...debug, autoplay: e.target.checked })} /> Auto-play the live run</label>
              <label className="row" style={{ gap: 6 }}>speed <select value={debug.autoplaySpeed} onChange={(e) => setDebug({ ...debug, autoplaySpeed: Number(e.target.value) })}>{[1, 2, 4, 10, 25].map((v) => <option key={v} value={v}>{v}×</option>)}</select></label>
            </div>
            <p className="note">Simulated sessions are never added to your history.</p>
          </div>
        )}
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <button className="btn btn-primary" disabled={!!err} onClick={() => onStart(cfg)} style={{ padding: '12px 26px', fontSize: 16 }}>Start experiment</button>
            {!PUBLIC && <button className="btn btn-ghost" onClick={() => { setC(DEFAULT_CONFIG); setKeysText(DEFAULT_CONFIG.keys.join('')); }}>Reset defaults</button>}
          </div>
          <div className="row">
            {last && <button className="btn btn-sm" onClick={() => onOpenSession(last)}>Open last session ({last.trials.length} trials)</button>}
            <button className="btn btn-sm" onClick={() => openRef.current?.click()}>Open session file…</button>
            <input ref={openRef} type="file" accept=".json" hidden onChange={async (e) => { const s = e.target.files?.[0] && (await readSession(e.target.files[0])); if (s) onOpenSession(s); else alert('Not a session JSON.'); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const touchOnly = typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

function About() {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3 className="card-title">What is this?</h3>
      <p className="card-sub" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
        A nanopore sequencer reads DNA by pulling it through a tiny pore and measuring the electrical current, which changes with the bases inside.
        Each trial shows a real stretch of that current. Press <kbd>A</kbd> <kbd>C</kbd> <kbd>G</kbd> <kbd>T</kbd> to guess the base in the highlighted stretch.
        There are no instructions beyond that; you learn from the feedback on your guess, like a machine-learning model would. At the end you're compared,
        on exactly the same traces, with simple models, a neural network, and Oxford Nanopore's own basecaller.
      </p>
      <p className="card-sub" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
        <b>Session 1</b> (≈25–35 min) first; come back for <b>Session 2</b> (≈30 min) (the app remembers what you've seen).
        Everything stays in this browser: nothing is uploaded. Download your results at the end if you want to keep them. Press <kbd>Esc</kbd> to pause.
      </p>
      {touchOnly && <p className="error" style={{ margin: '8px 0 0' }}>This needs a physical keyboard — please use a laptop or desktop.</p>}
      <p className="note" style={{ marginTop: 8 }}>
        Data: ONT methylation benchmark (Kulkarni et al., 2024; MIT licence) — E. coli R10.4.1 reads. See the{' '}
        <a href="https://github.com/Matt115A/Nanopore_by_eye" target="_blank" rel="noopener noreferrer">project page</a> for more details, or read our walkthrough of an example session{' '}
        <a href="https://substack.com/home/post/p-218656615" target="_blank" rel="noopener noreferrer">here</a>.
      </p>
    </div>
  );
}
