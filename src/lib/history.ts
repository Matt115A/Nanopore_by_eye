import type { Session } from './types';

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
  return h;
}

export function removeFromHistory(id: string): HistoryEntry[] {
  const h = loadHistory().filter((e) => e.session_id !== id);
  save(h);
  return h;
}

/** History entries that started before this session (what the participant had already done). */
export function priorTo(h: HistoryEntry[], s: Session): HistoryEntry[] {
  return h.filter((e) => e.session_id !== s.meta.session_id && e.start_time < s.meta.start_time);
}
