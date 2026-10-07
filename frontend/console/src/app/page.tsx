/**
 * `/` — the console: reception (`S-B-02`), the doctor (`S-B-05`), the ward
 * board (`S-B-06`), the emergency department (`S-B-07`), the lab (`S-B-08`),
 * the pharmacy (`S-B-09`), the hospital dashboard (`S-B-10`) and its settings
 * (`S-B-11`), hospital onboarding (`S-B-12`), or the national dashboard
 * (`S-B-13`).
 *
 * A client component in full. Every part of these screens is live: state
 * arrives over a socket, actions are applied optimistically against a local
 * outbox, and the whole thing has to keep working with the network gone
 * (`FR-OFF-01`). None of that survives server rendering, and pretending
 * otherwise would mean a first paint showing a queue or a board that is
 * already wrong.
 *
 * ## Who is let in (pilot step 21)
 *
 * On a demonstration deployment the picker (`S-B-01`) opens any console
 * without a password, as it always has; `?login=1` shows `S-B-00` instead.
 * Anywhere else — once `GET /demo/status` has said so — the console shows
 * `S-B-00` until somebody signs in, then `S-B-00c` if their password
 * was set by an administrator, then `S-B-00d` if they are an administrator
 * with no second factor yet (pilot step 28), then the picker limited to their
 * own facility and roles. A signed-in session is kept fresh in the background, and one the
 * server stops accepting returns here to `S-B-00`.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import { AdminDashboard } from '@/components/AdminDashboard';
import { ChangePassword } from '@/components/ChangePassword';
import { ConsolePicker, type ConsoleChoice } from '@/components/ConsolePicker';
import { ConsoleStarting } from '@/components/ConsoleStarting';
import { DoctorConsole } from '@/components/DoctorConsole';
import { EmergencyConsole } from '@/components/EmergencyConsole';
import { GovDashboard } from '@/components/GovDashboard';
import { HospitalApplication } from '@/components/HospitalApplication';
import { HospitalImport } from '@/components/HospitalImport';
import { HospitalSettings } from '@/components/HospitalSettings';
import { LabConsole } from '@/components/LabConsole';
import { PharmacyConsole } from '@/components/PharmacyConsole';
import { PlatformConsole } from '@/components/PlatformConsole';
import { ReceptionConsole } from '@/components/ReceptionConsole';
import { RegistrationConsole } from '@/components/RegistrationConsole';
import { StaffLogin } from '@/components/StaffLogin';
import { TwoFactorSetup } from '@/components/TwoFactorSetup';
import { WardBoard } from '@/components/WardBoard';
import { readDemoSession } from '@/lib/demo';
import { askDemoMode, keepSessionFresh } from '@/lib/staffAuth';

import type { ReactNode } from 'react';

/**
 * Roles whose console belongs to the hospital rather than to a chamber.
 *
 * A principal holding one of these has no chamber to open, so the picker is
 * what it gets when the URL names none.
 */
const HOSPITAL_ROLES = new Set([
  'ward',
  'emergency',
  'lab',
  'pharmacy',
  'hospital_admin',
  // Not a hospital's at all, but the same answer: no chamber to open (`S-B-13`).
  'gov_viewer',
  // Nor the platform's administrator (`S-B-12`).
  'platform_admin',
]);

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
  settings: 'settings',
  gov: 'gov',
  platform: 'platform',
};

export default function Page(): ReactNode {
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  /** Null until `GET /demo/status` answers. False only when the server said so. */
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [statusWaking, setStatusWaking] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const askStatus = useCallback(() => {
    setStatusFailed(false);
    setStatusWaking(false);
    void askDemoMode(() => {
      setStatusWaking(true);
    }).then((answer) => {
      if (answer === null) setStatusFailed(true);
      else setDemoMode(answer);
    });
  }, []);
  const [loginAsked, setLoginAsked] = useState(false);
  /** `?apply=1`: a hospital applying by itself (`FR-ONB-09`). Nobody is signed in for it. */
  const [applyAsked, setApplyAsked] = useState(false);
  /** A signed-in session the server stopped accepting. */
  const [ended, setEnded] = useState(false);
  /**
   * The second factor was just turned on and the recovery codes are showing.
   * The stored session already says it is on, so without this the page would
   * move to the console before the person has seen the codes.
   */
  const [enrolling, setEnrolling] = useState(false);
  /** Bumped when the stored session changes, so this page reads it again. */
  const [, setSessionVersion] = useState(0);
  const sessionChanged = useCallback(() => {
    setSessionVersion((version) => version + 1);
  }, []);

  // Read after mount: the server has no `location` and no `sessionStorage`,
  // and reading either during render makes the first client render disagree
  // with the server's.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    setSessionId(params.get('session'));
    setView(params.get('view'));
    setLoginAsked(params.get('login') === '1');
    setApplyAsked(params.get('apply') === '1');
    setReady(true);
    askStatus();
  }, [askStatus]);

  // A signed-in session is renewed in the background (`lib/staffAuth.ts`);
  // one the server refuses brings this page back to `S-B-00`.
  useEffect(
    () =>
      keepSessionFresh(() => {
        setEnded(true);
        sessionChanged();
      }),
    [sessionChanged],
  );

  const signedIn = useCallback(() => {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('login');
    globalThis.history.replaceState(null, '', url.toString());
    setLoginAsked(false);
    setEnded(false);
    sessionChanged();
  }, [sessionChanged]);

  const signedOut = useCallback(() => {
    globalThis.location.assign('/');
  }, []);

  const enrolled = useCallback(() => {
    setEnrolling(false);
    if (view === '2fa') {
      const url = new URL(globalThis.location.href);
      url.searchParams.delete('view');
      globalThis.history.replaceState(null, '', url.toString());
      setView(null);
    }
    sessionChanged();
  }, [sessionChanged, view]);

  const leaveSetup = useCallback(() => {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('view');
    globalThis.history.replaceState(null, '', url.toString());
    setView(null);
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
  const staff = session?.authKind === 'staff';

  // `S-B-00c`: a password an administrator set comes before any console.
  if (staff && session?.mustChangePassword === true) {
    return <ChangePassword onChanged={sessionChanged} onSignedOut={signedOut} />;
  }

  // `S-B-00d`: an administrator's second factor comes before any console; and
  // anybody may open it from the picker (`?view=2fa`) while theirs is off.
  const twoFactor = staff ? session?.twoFactor : undefined;
  const setupRequired = twoFactor?.required === true && !twoFactor.enabled;
  if (
    staff &&
    (enrolling ||
      setupRequired ||
      (view === '2fa' && twoFactor !== undefined && !twoFactor.enabled))
  ) {
    return (
      <TwoFactorSetup
        required={setupRequired}
        onEnabled={() => {
          setEnrolling(true);
        }}
        onDone={enrolled}
        {...(setupRequired ? {} : { onCancel: leaveSetup })}
        onSignedOut={signedOut}
      />
    );
  }

  // `S-B-00a`: the application form. Public on every deployment, so it needs
  // no answer about the demonstration first, and it is never shown to
  // somebody already signed in.
  if (!staff && session === null && applyAsked) {
    return <HospitalApplication />;
  }

  // `S-B-00`: always off the demo, and on it when asked for.
  if (!staff && (loginAsked || ended || demoMode === false)) {
    return <StaffLogin demo={demoMode === true} ended={ended} onSignedIn={signedIn} />;
  }

  // Nobody is in yet and whether this is a demo is still on its way. Drawing
  // the picker now would offer a password-less way in that a real deployment
  // refuses, and drawing sign-in would ask a demo for a password it does not
  // need — so the screen says it is starting, or waking, or could not reach
  // the server. A session already in this tab needs no answer: a demo token
  // exists only where the demo does.
  if (session === null && demoMode === null) {
    return <ConsoleStarting waking={statusWaking} failed={statusFailed} onRetry={askStatus} />;
  }

  // The ward board opens on a hospital, with no chamber (`S-B-06`).
  if (view === 'ward' && session?.role === 'ward') return <WardBoard />;

  // So does the ER (`S-B-07`), the lab (`S-B-08`) and the pharmacy (`S-B-09`).
  if (view === 'er' && session?.role === 'emergency') return <EmergencyConsole />;
  if (view === 'lab' && session?.role === 'lab') return <LabConsole />;
  if (view === 'pharmacy' && session?.role === 'pharmacy') return <PharmacyConsole />;
  if (view === 'admin' && session?.role === 'hospital_admin') return <AdminDashboard />;
  // The registration desk (`S-B-03`, pilot step 23), from the rail.
  if (view === 'registration' && session?.role === 'receptionist') return <RegistrationConsole />;
  // Opened from the dashboard's header (pilot step 22).
  if (view === 'settings' && session?.role === 'hospital_admin') return <HospitalSettings />;
  // And the import, opened from the settings (pilot step 24, S-B-14).
  if (view === 'imports' && session?.role === 'hospital_admin') return <HospitalImport />;

  // The national layer (`S-B-13`, step 20): no hospital, no chamber.
  if (view === 'gov' && session?.role === 'gov_viewer') return <GovDashboard />;

  // Hospital onboarding (`S-B-12`, V3.2): the platform's administrator, who
  // also works for no hospital.
  if (view === 'platform' && session?.role === 'platform_admin') return <PlatformConsole />;

  // A chamber in the URL *and* a chamber principal in storage is a console
  // ready to open. Anything else means the picker (`S-B-01`): every facility
  // on the demo, or the signed-in person's own facility and roles.
  if (sessionId === null || session === null || HOSPITAL_ROLES.has(session.role)) {
    return (
      <ConsolePicker onChosen={chosen} mode={staff ? 'staff' : 'demo'} onSignedOut={signedOut} />
    );
  }

  // The role decides which console, because `S-B-02` and `S-B-05` are two
  // screens onto the same chamber. Anything else lands on reception: a console
  // that renders nothing would be worse than one that shows the queue.
  return session.role === 'doctor' ? <DoctorConsole /> : <ReceptionConsole />;
}
