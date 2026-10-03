import { TRACE, contrastBase, explainMarkup, sequenceMarkup, tracePath } from '../lib/engine';
import type { Base, KmerTable, Win } from '../lib/types';

/** React version of the trial display (used in replay and the data tab). */
export function Trace({ win, state, className, showContext, explain }: { win: Win; state?: 'correct' | 'wrong' | null; className?: string; showContext?: boolean; explain?: { kmer: KmerTable | null; pressed: Base; choices: Base[]; band?: 'centre' | 'extended' } }) {
  const { d, x0, x1 } = tracePath(win, explain?.band);
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${TRACE.W} ${TRACE.H}`} width="100%" style={{ display: 'block' }}>
        {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
          <line key={v} x1={0} x2={TRACE.W} y1={TRACE.H / 2 - v * TRACE.Y_PER_UNIT} y2={TRACE.H / 2 - v * TRACE.Y_PER_UNIT} stroke="#232321" strokeWidth={v === 0 ? 2 : 1} />
        ))}
        <rect x={x0} y={0} width={Math.max(2, x1 - x0)} height={TRACE.H} rx={6} className={`band ${state === 'correct' ? 'band-correct' : state === 'wrong' ? 'band-wrong' : ''}`} />
        <path d={d} fill="none" stroke="#f4f4f0" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {showContext && <g dangerouslySetInnerHTML={{ __html: explain ? explainMarkup(win, explain.kmer, contrastBase(win, explain.pressed, explain.choices), explain.pressed === win.label) : sequenceMarkup(win, state === 'correct' ? true : state === 'wrong' ? false : null) }} />}
      </svg>
    </div>
  );
}
