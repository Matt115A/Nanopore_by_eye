import { useEffect, useState } from 'react';
import { loadDataset } from './lib/dataset';
import { PUBLIC } from './lib/env';
import { loadLocal, saveLocal } from './lib/export';
import { addToHistory, type HistoryEntry, loadHistory } from './lib/history';
import { SessionCore } from './lib/session';
import { simulateSession } from './lib/simulate';
import { DEFAULT_CONFIG, PRESETS, type Config, type Dataset, type PriorExperience, type Session } from './lib/types';
import { Experiment } from './screens/Experiment';
import { Instructions } from './screens/Instructions';
import { Results } from './screens/Results';
import { Setup } from './screens/Setup';

type Screen = 'setup' | 'instructions' | 'experiment' | 'results';
export interface DebugOpts { enabled: boolean; autoplay: boolean; autoplaySpeed: number }

/** Seed the history with a session that predates it (session 1 was saved before history existed). */
function initialHistory(): HistoryEntry[] {
  let h = loadHistory();
  const last = loadLocal();
  if (last && !last.meta.simulated && !h.some((e) => e.session_id === last.meta.session_id)) h = addToHistory(last);
  return h;
}

export function priorFrom(h: HistoryEntry[]): { exclude: Set<number>; prior: PriorExperience } {
  const exclude = new Set(h.flatMap((e) => e.window_ids));
  return { exclude, prior: { sessions: h.length, trials: h.reduce((a, e) => a + e.n_trials, 0), session_ids: h.map((e) => e.session_id), excluded_windows: exclude.size } };
}

/** Public build: session 1 for newcomers, session 2 once session 1 is in the history. */
function recommended(h: HistoryEntry[]): Config {
  if (!PUBLIC) return DEFAULT_CONFIG;
  const protocol = h.length ? 'pretrained' : 'first';
  return { ...DEFAULT_CONFIG, protocol, phases: structuredClone(PRESETS[protocol].phases) };
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('setup');
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [config, setConfig] = useState<Config>(() => recommended(history));
  const [core, setCore] = useState<SessionCore | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [debug, setDebug] = useState<DebugOpts>({ enabled: !PUBLIC && new URLSearchParams(location.search).has('debug'), autoplay: false, autoplaySpeed: 4 });

  useEffect(() => { loadDataset().then(setData).catch((e) => setErr(String(e))); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!PUBLIC && screen === 'setup' && e.shiftKey && e.key.toLowerCase() === 'd' && !(e.target instanceof HTMLInputElement)) setDebug((d) => ({ ...d, enabled: !d.enabled }));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [screen]);

  if (err) return <div className="screen"><h2>Couldn't load the dataset</h2><p className="muted">{err}</p></div>;
  if (!data) return <div className="screen"><p className="muted pulse">Loading nanopore traces…</p></div>;

  return (
    <>
      {screen === 'setup' && (
        <Setup data={data} initial={config} debug={debug} setDebug={setDebug} history={history} setHistory={setHistory}
          onStart={(c) => { setConfig(c); setCore(new SessionCore(c, data, priorFrom(history))); setScreen('instructions'); }}
          onSimulate={(c) => { setConfig(c); const s = simulateSession(c, data, undefined, priorFrom(history)); saveLocal(s); setSession(s); setScreen('results'); }}
          onOpenSession={(s) => { setSession(s); setScreen('results'); }} />
      )}
      {screen === 'instructions' && core && <Instructions keys={core.config.keys} onBegin={() => setScreen('experiment')} />}
      {screen === 'experiment' && core && (
        <Experiment core={core} debug={debug} kmer={data.kmer} onEnd={(s) => { const h = addToHistory(s); setHistory(h); if (PUBLIC) setConfig(recommended(h)); setSession(s); setCore(null); setScreen('results'); }} />
      )}
      {screen === 'results' && session && <Results session={session} data={data} history={history} onNew={() => setScreen('setup')} />}
    </>
  );
}
