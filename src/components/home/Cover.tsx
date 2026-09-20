'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import HandoffSketch from './HandoffSketch';

const LEAVE_MS = 720;

/**
 * The cover is the front page (`/`). Begin lifts it: the paper fades and drifts up, then the
 * project list at `/projects` takes its place (that page fades in). `/projects` links back here.
 */
export default function Cover() {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'leaving'>('idle');
  const beginRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    router.prefetch('/projects');
  }, [router]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => router.push('/projects'), reduced ? 0 : LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  useEffect(() => {
    if (phase !== 'idle') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && document.activeElement !== beginRef.current) setPhase('leaving');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  return (
    <div className={phase === 'leaving' ? 'cover leaving' : 'cover'} data-cover>
      <div className="cover-inner">
        <div className="cover-word">
          <h1 className="cover-title">Handoff</h1>
          <p className="cover-punch">Stop pasting your whole codebase into the prompt.</p>
          <p className="cover-line">
            Handoff maintains the rules, decisions, and known bugs behind your code, and gives a person/agent only the info their task needs.
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
    </div>
  );
}
