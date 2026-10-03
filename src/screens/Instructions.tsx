import { useEffect } from 'react';
import { BASES } from '../lib/types';

export function Instructions({ keys, onBegin }: { keys: string[]; onBegin: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); onBegin(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onBegin]);
  return (
    <div className="screen">
      <div className="instructions">
        <p>You'll see the electrical current as a strand of DNA moves through a nanopore.</p>
        <p>Press the key for the base in the highlighted stretch.</p>
        <p>Use the feedback to learn. Respond as quickly and accurately as possible.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 40, gap: 14 }}>
          {BASES.map((b, i) => (
            <div key={b} className="keycap keycap-labelled">
              {b}
              {keys[i] !== b && <small>{keys[i]}</small>}
            </div>
          ))}
        </div>
        <div className="hint pulse">Press <kbd>Space</kbd> to begin</div>
      </div>
    </div>
  );
}
