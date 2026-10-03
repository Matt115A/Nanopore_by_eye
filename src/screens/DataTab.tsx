import { useState } from 'react';
import { Card } from '../components/charts';
import type { Session } from '../lib/types';

export function DataTab({ session }: { session: Session }) {
  const [all, setAll] = useState(false);
  const rows = all ? session.trials : session.trials.slice(-60);
  return (
    <div>
      <Card title="Session metadata" sub="Exactly what the Metadata JSON export contains.">
        <pre style={{ fontSize: 12, lineHeight: 1.5, maxHeight: 400, overflow: 'auto', margin: 0, color: 'var(--text-2)' }}>{JSON.stringify(session.meta, null, 2)}</pre>
      </Card>
      <Card title="Raw trials" sub={all ? `All ${session.trials.length} trials.` : `Last 60 of ${session.trials.length}. The CSV has every trial.`}
        extra={<button className="btn btn-sm" onClick={() => setAll((v) => !v)}>{all ? 'Show last 60' : 'Show all'}</button>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data" style={{ fontSize: 13 }}>
            <thead><tr>{['trial', 'phase', 'window', 'sample', 'shown', 'pressed', 'correct', 'RT ms', 'mC', 'dwell', 'rolling acc'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.trial}>
                  <td>{t.trial}</td><td className="muted">{t.phase}</td><td>{t.window_id}</td><td>{t.sample}</td><td>{t.label}</td><td>{t.pressed}</td>
                  <td style={{ color: t.correct ? 'var(--good)' : 'var(--bad)' }}>{t.correct ? '✓' : '✗'}</td><td>{t.rt_ms.toFixed(0)}</td>
                  <td>{t.centre_mC ? <span className="tag tag-remap">mC</span> : ''}</td><td>{t.dwell_samples}</td>
                  <td>{t.rolling_accuracy == null ? '' : `${(t.rolling_accuracy * 100).toFixed(0)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
