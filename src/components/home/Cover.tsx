'use client';

import { useEffect, useRef, useState } from 'react';
import HandoffSketch from './HandoffSketch';

const LEAVE_MS = 720;

/**
 * The cover sits over the already-rendered project list. Begin lifts it: the paper fades and
 * drifts up, the list beneath is revealed in place, no navigation. Shown on every visit to `/`.
 */
export default function Cover() {
  const [phase, setPhase] = useState<'idle' | 'leaving' | 'gone'>('idle');
  const beginRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setPhase('gone'), reduced ? 0 : LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'idle') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && document.activeElement !== beginRef.current) setPhase('leaving');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div className={phase === 'leaving' ? 'cover leaving' : 'cover'} data-cover>
      <div className="cover-inner">
        <div className="cover-word">
          <h1 className="cover-title">Handoff</h1>
          <p className="cover-line">
            Project knowledge as a graph. The task decides which part of it an agent gets.
          </p>
          <button
            ref={beginRef}
            type="button"
            className="cover-begin"
            onClick={() => setPhase('leaving')}
            disabled={phase === 'leaving'}
          >
            Begin
            <span className="cover-begin-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
        <HandoffSketch />
      </div>
      <p className="cover-foot mono" aria-hidden="true">
        canonical · inferred · provenance · budget
      </p>
    </div>
  );
}
