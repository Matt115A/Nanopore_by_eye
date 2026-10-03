import { useEffect, useRef, useState } from 'react';
import type { DebugOpts } from '../App';
import { TRACE, TrialEngine } from '../lib/engine';
import type { SessionCore } from '../lib/session';
import { BASES, type KmerTable, type Session } from '../lib/types';

/** Mounts the stage once and hands it to the imperative TrialEngine. */
export function Experiment({ core, debug, kmer, onEnd }: { core: SessionCore; debug: DebugOpts; kmer: KmerTable | null; onEnd: (s: Session) => void }) {
  const path = useRef<SVGPathElement>(null);
  const band = useRef<SVGRectElement>(null);
  const traceGroup = useRef<SVGGElement>(null);
  const seq = useRef<SVGGElement>(null);
  const hudPart = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const hudTrial = useRef<HTMLDivElement>(null);
  const hudTime = useRef<HTMLDivElement>(null);
  const hudAcc = useRef<HTMLDivElement>(null);
  const dbg = useRef<HTMLDivElement>(null);
  const keyRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const engine = useRef<TrialEngine | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const e = new TrialEngine(core, {
      path: path.current!, band: band.current!, traceGroup: traceGroup.current!, seq: seq.current!, hudPart: hudPart.current!,
      message: message.current!, hudTrial: hudTrial.current!, hudTime: hudTime.current!, hudAcc: hudAcc.current!, debug: dbg.current,
      keycaps: Object.fromEntries(core.config.keys.map((k) => [k, keyRefs.current[k]!])),
    }, { debug: debug.enabled, autoplay: debug.enabled && debug.autoplay, autoplaySpeed: debug.autoplaySpeed, kmer, onEnd, onPauseChange: setPaused });
    engine.current = e;
    e.start();
    return () => e.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="exp">
      <div className="hud">
        <div className="hud-item"><div className="hud-label">Part</div><div className="hud-value hud-part" ref={hudPart}>—</div></div>
        <div className="hud-item"><div className="hud-label">Trial</div><div className="hud-value" ref={hudTrial}>1</div></div>
        <div className="hud-item"><div className="hud-label">Time</div><div className="hud-value" ref={hudTime}>0:00</div></div>
        <div className="hud-item"><div className="hud-label">Accuracy · last {core.config.hudWindow}</div><div className="hud-value" ref={hudAcc}>—</div></div>
      </div>

      <div className="trace-stage">
        <svg viewBox={`0 0 ${TRACE.W} ${TRACE.H}`} width="100%">
          {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
            <line key={v} x1={0} x2={TRACE.W} y1={TRACE.H / 2 - v * TRACE.Y_PER_UNIT} y2={TRACE.H / 2 - v * TRACE.Y_PER_UNIT} stroke="#1f1f1d" strokeWidth={v === 0 ? 2 : 1} />
          ))}
          <g ref={traceGroup} style={{ visibility: 'hidden' }}>
            <rect ref={band} y={0} height={TRACE.H} rx={6} className="band" />
            <path ref={path} fill="none" stroke="#f4f4f0" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            <g ref={seq} />
          </g>
        </svg>
      </div>

      <div className="keys">
        {BASES.map((b, i) => (
          <div key={b} className="keycap keycap-labelled" ref={(el) => void (keyRefs.current[core.config.keys[i]] = el)}>
            {b}
            {core.config.keys[i] !== b && <small>{core.config.keys[i]}</small>}
          </div>
        ))}
      </div>

      <div className="message" ref={message} />
      <div className="esc-hint">Esc to pause</div>
      {debug.enabled && <div className="debug-box" ref={dbg} />}
      {paused && (
        <div className="pause">
          <h2>Paused</h2>
          <p className="muted" style={{ margin: 0 }}>The timer is stopped. The interrupted trace will be shown again.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => engine.current?.resume()}>Resume (Esc)</button>
            <button className="btn" onClick={() => engine.current?.end('ended_by_user')}>End session &amp; analyse</button>
          </div>
        </div>
      )}
    </div>
  );
}
