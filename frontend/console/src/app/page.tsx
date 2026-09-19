/**
 * `/` — the reception console (`S-B-02`).
 *
 * A client component in full. Every part of this screen is live: the queue
 * arrives over a socket, actions are applied optimistically against a local
 * queue, and the whole thing has to keep working with the network gone
 * (`FR-OFF-01`). None of that survives server rendering, and pretending
 * otherwise would mean a first paint showing a queue that is already wrong.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import { ConsolePicker } from '@/components/ConsolePicker';
import { DoctorConsole } from '@/components/DoctorConsole';
import { ReceptionConsole } from '@/components/ReceptionConsole';
import { readDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

export default function Page(): ReactNode {
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Read after mount: the server has no `location` and no `sessionStorage`,
  // and reading either during render makes the first client render disagree
  // with the server's.
  useEffect(() => {
    const fromUrl = new URLSearchParams(globalThis.location.search).get('session');
    setSessionId(fromUrl);
    setReady(true);
  }, []);

  const chosen = useCallback((id: string) => {
    // The session id lives in the URL so the console is linkable and a reload
    // keeps the chamber — the same reason it was read from there before this
    // screen existed.
    const url = new URL(globalThis.location.href);
    url.searchParams.set('session', id);
    globalThis.history.replaceState(null, '', url.toString());
    setSessionId(id);
  }, []);

  if (!ready) return null;

  // A chamber in the URL *and* a principal in storage is a console ready to
  // open. Either one missing means the picker, which is `S-B-01` standing in
  // for the login this version does not have (CLAUDE.md §4.1).
  const session = readDemoSession();
  if (sessionId === null || session === null) {
    return <ConsolePicker onChosen={chosen} />;
  }

  // The role decides which console, because `S-B-02` and `S-B-05` are two
  // screens onto the same chamber. Until now the picker offered a role and then
  // opened reception whatever was chosen, which made the doctor button a lie.
  //
  // Unrecognised roles land on reception deliberately: `hospital_admin` is
  // `S-B-10` and is build step 19, and a console that renders nothing would be
  // worse than one that shows the queue.
  return session.role === 'doctor' ? <DoctorConsole /> : <ReceptionConsole />;
}
