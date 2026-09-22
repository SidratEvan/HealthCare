/**
 * `/` — the console: reception (`S-B-02`), the doctor (`S-B-05`), or the ward
 * board (`S-B-06`).
 *
 * A client component in full. Every part of these screens is live: state
 * arrives over a socket, actions are applied optimistically against a local
 * outbox, and the whole thing has to keep working with the network gone
 * (`FR-OFF-01`). None of that survives server rendering, and pretending
 * otherwise would mean a first paint showing a queue or a board that is
 * already wrong.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import { ConsolePicker, type ConsoleChoice } from '@/components/ConsolePicker';
import { DoctorConsole } from '@/components/DoctorConsole';
import { ReceptionConsole } from '@/components/ReceptionConsole';
import { WardBoard } from '@/components/WardBoard';
import { readDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

export default function Page(): ReactNode {
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);

  // Read after mount: the server has no `location` and no `sessionStorage`,
  // and reading either during render makes the first client render disagree
  // with the server's.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    setSessionId(params.get('session'));
    setView(params.get('view'));
    setReady(true);
  }, []);

  const chosen = useCallback((choice: ConsoleChoice) => {
    // What was opened lives in the URL, so the console is linkable and a
    // reload keeps it — a chamber by its session, the ward board by name,
    // because a ward is a hospital's and not a chamber's.
    const url = new URL(globalThis.location.href);
    if (choice.kind === 'ward') {
      url.searchParams.delete('session');
      url.searchParams.set('view', 'ward');
      setSessionId(null);
      setView('ward');
    } else {
      url.searchParams.delete('view');
      url.searchParams.set('session', choice.sessionId);
      setSessionId(choice.sessionId);
      setView(null);
    }
    globalThis.history.replaceState(null, '', url.toString());
  }, []);

  if (!ready) return null;

  const session = readDemoSession();

  // The ward board opens on a hospital, with no chamber (`S-B-06`).
  if (view === 'ward' && session?.role === 'ward') return <WardBoard />;

  // A chamber in the URL *and* a chamber principal in storage is a console
  // ready to open. Anything else means the picker, which is `S-B-01` standing
  // in for the login this version does not have (CLAUDE.md §4.1).
  if (sessionId === null || session === null || session.role === 'ward') {
    return <ConsolePicker onChosen={chosen} />;
  }

  // The role decides which console, because `S-B-02` and `S-B-05` are two
  // screens onto the same chamber.
  //
  // Unrecognised roles land on reception deliberately: `hospital_admin` is
  // `S-B-10` and is build step 19, and a console that renders nothing would be
  // worse than one that shows the queue.
  return session.role === 'doctor' ? <DoctorConsole /> : <ReceptionConsole />;
}
