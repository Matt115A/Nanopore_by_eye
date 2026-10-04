import { useMemo, useState } from 'react';
import { fmtClock } from '../lib/engine';
import { downloadCsv, downloadMetadata, downloadSessionJson } from '../lib/export';
import { type HistoryEntry, priorTo } from '../lib/history';
import type { Dataset, Session } from '../lib/types';
import { Analysis } from './Analysis';
import { ContributeCard } from '../components/ContributeCard';
import { buildContribution } from '../lib/bioai';
import { DataTab } from './DataTab';
import { Replay } from './Replay';

type Tab = 'analysis' | 'replay' | 'data';

export function Results({ session, data, history, onNew }: { session: Session; data: Dataset; history: HistoryEntry[]; onNew: () => void }) {
  const [tab, setTab] = useState<Tab>('analysis');
  const byId = useMemo(() => new Map(data.windows.map((w) => [w.id, w])), [data]);
  const prior = useMemo(() => priorTo(history, session), [history, session]);
  const m = session.meta;
  const missing = session.trials.some((t) => !byId.has(t.window_id));
  return (
    <div className="results">
      <div className="results-head">
        <div>
          <h1>Results</h1>
          <div className="muted" style={{ marginTop: 6, fontSize: 14 }}>
            {new Date(m.start_time).toLocaleString()} · {session.trials.length} trials · {fmtClock(m.active_duration_ms)} active
            {m.simulated && <span className="tag" style={{ marginLeft: 8 }}>simulated</span>}
            {!m.end_time && <span className="tag" style={{ marginLeft: 8 }}>incomplete</span>}
          </div>
        </div>
        <div className="tabs">
          {(['analysis', 'replay', 'data'] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'analysis' ? 'Analysis' : t === 'replay' ? 'Replay' : 'Data'}</button>
          ))}
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => downloadCsv(session)}>↓ Trials CSV</button>
          <button className="btn btn-sm" onClick={() => downloadMetadata(session)}>↓ Metadata JSON</button>
          <button className="btn btn-sm" onClick={() => downloadSessionJson(session)}>↓ Session JSON</button>
          <button className="btn btn-sm btn-primary" onClick={onNew}>New experiment</button>
        </div>
      </div>
      <ContributeCard sessionId={m.session_id} simulated={!!m.simulated} contribution={buildContribution('nanopore', String(m.app_version ?? ''), String(m.dataset_version ?? ''), ['pretest', 'training', 'learning', 'cg', 'ag', 'mixed', 'posttest', 'methylated'], session.trials.map((t) => ({ item: t.window_id, response: t.pressed, phase: t.phase, rt: t.rt_ms })))} />
      {missing ? (
        <div className="card empty">This session was recorded with a different dataset version ({m.dataset_version}); its windows aren't in the loaded dataset ({data.version}).</div>
      ) : (
        <>
          {tab === 'analysis' && <Analysis session={session} data={data} byId={byId} prior={prior} />}
          {tab === 'replay' && <Replay session={session} data={data} byId={byId} />}
          {tab === 'data' && <DataTab session={session} />}
        </>
      )}
    </div>
  );
}
