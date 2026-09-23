/**
 * `/` — the console: reception (`S-B-02`), the doctor (`S-B-05`), the ward
 * board (`S-B-06`), the emergency department (`S-B-07`), the lab (`S-B-08`),
 * the pharmacy (`S-B-09`) or the hospital dashboard (`S-B-10`).
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

import { AdminDashboard } from '@/components/AdminDashboard';
import { ConsolePicker, type ConsoleChoice } from '@/components/ConsolePicker';
import { DoctorConsole } from '@/components/DoctorConsole';
import { EmergencyConsole } from '@/components/EmergencyConsole';
import { LabConsole } from '@/components/LabConsole';
import { PharmacyConsole } from '@/components/PharmacyConsole';
import { ReceptionConsole } from '@/components/ReceptionConsole';
import { WardBoard } from '@/components/WardBoard';
import { readDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

/**
 * Roles whose console belongs to the hospital rather than to a chamber.
 *
 * A principal holding one of these has no chamber to open, so the picker is
 * what it gets when the URL names none.
 */
const HOSPITAL_ROLES = new Set(['ward', 'emergency', 'lab', 'pharmacy', 'hospital_admin']);

/**
 * What each of those is called in the URL.
 *
 * Keyed on the choice's own kinds rather than on `string`, so adding a
 * console to `ConsoleChoice` without naming its view fails to compile instead
 * of routing to `undefined`.
 */
const VIEW_OF: Readonly<Record<Exclude<ConsoleChoice['kind'], 'chamber'>, string>> = {
  ward: 'ward',
  emergency: 'er',
  lab: 'lab',
  pharmacy: 'pharmacy',
  admin: 'admin',
};

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
    if (choice.kind !== 'chamber') {
      const opened = VIEW_OF[choice.kind];
      url.searchParams.delete('session');
      url.searchParams.set('view', opened);
      setSessionId(null);
      setView(opened);
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

  // So does the ER (`S-B-07`), the lab (`S-B-08`) and the pharmacy (`S-B-09`).
  if (view === 'er' && session?.role === 'emergency') return <EmergencyConsole />;
  if (view === 'lab' && session?.role === 'lab') return <LabConsole />;
  if (view === 'pharmacy' && session?.role === 'pharmacy') return <PharmacyConsole />;
  if (view === 'admin' && session?.role === 'hospital_admin') return <AdminDashboard />;

  // A chamber in the URL *and* a chamber principal in storage is a console
  // ready to open. Anything else means the picker, which is `S-B-01` standing
  // in for the login this version does not have (CLAUDE.md §4.1).
  if (sessionId === null || session === null || HOSPITAL_ROLES.has(session.role)) {
    return <ConsolePicker onChosen={chosen} />;
  }

  // The role decides which console, because `S-B-02` and `S-B-05` are two
  // screens onto the same chamber. Anything else lands on reception: a console
  // that renders nothing would be worse than one that shows the queue.
  return session.role === 'doctor' ? <DoctorConsole /> : <ReceptionConsole />;
}
