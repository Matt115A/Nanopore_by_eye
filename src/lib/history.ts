import { loadLocal } from './export';
import type { Session } from './types';
import { backfillSessions, buildContribution, forgetSessions } from './bioai';

/** Past sessions on this machine: which windows were seen, so they're never reused, and how much experience the participant has. */
export interface HistoryEntry {
  session_id: string;
  start_time: string;
  n_trials: number;
  window_ids: number[];
  /** Accuracy over the last 100 trials with feedback, overall and by base (for the retention comparison). */
  final: { acc: number | null; byBase: Record<string, number | null> };
  simulated: boolean;
}

const KEY = 'nano.history';
/** Full copies of past sessions, keyed by session id, so the analysis can be cumulative (as the other games do). */
const ARCHIVE = 'nano.sessions';

function loadArchive(): Record<string, Session> {
  try { return JSON.parse(localStorage.getItem(ARCHIVE) ?? '{}') as Record<string, Session>; } catch { return {}; }
}
function saveArchive(a: Record<string, Session>) {
  // newest first; if storage is full, drop the oldest copies (the history entry itself is kept)
  let ids = Object.keys(a).sort((x, y) => a[y].meta.start_time.localeCompare(a[x].meta.start_time));
  while (ids.length) {
    try { localStorage.setItem(ARCHIVE, JSON.stringify(Object.fromEntries(ids.map((i) => [i, a[i]])))); return; } catch { ids = ids.slice(0, -1); }
  }
  try { localStorage.removeItem(ARCHIVE); } catch { /* storage unavailable */ }
}
export function loadArchived(id: string): Session | null { return loadArchive()[id] ?? null; }

export function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryEntry[]; } catch { return []; }
}

function save(h: HistoryEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* storage unavailable — history just isn't kept */ }
}

export function entryFromSession(s: Session): HistoryEntry {
  const withFeedback = s.trials.filter((t) => (t.feedback ?? 'correctness') !== 'none' && t.sample === 'DM' && !t.choices).slice(-100);
  const acc = (ts: typeof withFeedback) => (ts.length ? ts.filter((t) => t.correct).length / ts.length : null);
  return {
    session_id: s.meta.session_id,
    start_time: s.meta.start_time,
    n_trials: s.trials.length,
    window_ids: s.trials.map((t) => t.window_id),
    final: { acc: acc(withFeedback), byBase: Object.fromEntries(['A', 'C', 'G', 'T'].map((b) => [b, acc(withFeedback.filter((t) => t.label === b))])) },
    simulated: s.meta.simulated,
  };
}

/** Add (or replace) a session. Simulated sessions are never added — they aren't real experience. */
export function addToHistory(s: Session): HistoryEntry[] {
  if (s.meta.simulated) return loadHistory();
  const h = loadHistory().filter((e) => e.session_id !== s.meta.session_id);
  h.push(entryFromSession(s));
  h.sort((a, b) => a.start_time.localeCompare(b.start_time));
  save(h);
  saveArchive({ ...loadArchive(), [s.meta.session_id]: s });
  return h;
}

export function removeFromHistory(id: string): HistoryEntry[] {
  forgetSessions({ ids: [id] });
  const h = loadHistory().filter((e) => e.session_id !== id);
  save(h);
  const a = loadArchive(); delete a[id]; saveArchive(a);
  return h;
}

/** History entries that started before this session (what the participant had already done). */
export function priorTo(h: HistoryEntry[], s: Session): HistoryEntry[] {
  return h.filter((e) => e.session_id !== s.meta.session_id && e.start_time < s.meta.start_time);
}

/** This session as a BioAI by eye datapoint (may be short: the results card pools short sessions). */
export function sessionContribution(s: Session) {
  return buildContribution('nanopore', String(s.meta.app_version ?? ''), String(s.meta.dataset_version ?? ''), ['pretest', 'training', 'learning', 'cg', 'ag', 'mixed', 'posttest', 'methylated'],
    s.trials.map((t) => ({ item: t.window_id, response: t.pressed, phase: t.phase, rt: t.rt_ms })));
}

/** Let sessions saved before cumulative contributions existed count too: only ones still in history (not deleted), never simulated. */
export function backfillPastSessions() {
  const kept = new Set(loadHistory().map((e) => e.session_id));
  const seen = new Set<string>();
  backfillSessions([...Object.values(loadArchive()), loadLocal()].filter((s): s is Session => !!s?.meta && !s.meta.simulated && kept.has(s.meta.session_id))
    .filter((s) => !seen.has(s.meta.session_id) && !!seen.add(s.meta.session_id))
    .map((s) => ({ id: s.meta.session_id, startedAt: Date.parse(s.meta.start_time), c: sessionContribution(s) })));
}

/** Every real session on this device for the same dataset — this one included — merged in the order they were
 *  played, so the results page can analyse everything the player has done rather than one run. Trials keep their own
 *  phase, so phase and learning statistics simply span more of them; `sessions` is how many went in. */
export function cumulativeSession(s: Session): { session: Session; sessions: number } {
  const all = [s, ...Object.values(loadArchive())]
    .filter((x): x is Session => !!x?.meta && !x.meta.simulated && x.meta.dataset_version === s.meta.dataset_version)
    .filter((x, i, a) => a.findIndex((y) => y.meta.session_id === x.meta.session_id) === i)   // the live copy of s wins
    .sort((a, b) => a.meta.start_time.localeCompare(b.meta.start_time));
  if (all.length < 2) return { session: s, sessions: 1 };
  const active = all.reduce((t, x) => t + (x.meta.active_duration_ms ?? 0), 0);
  return {
    session: { ...s, meta: { ...s.meta, start_time: all[0].meta.start_time, active_duration_ms: active }, trials: all.flatMap((x) => x.trials) },
    sessions: all.length,
  };
}
