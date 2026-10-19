'use client';

/** Current server-confirmed staff entry (FR-ROLE-01, FR-REC-32, FR-SEC-06/10).
 * This is a presentation boundary; every API retains its own permission guard.
 */
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';

import {
  assignedDesks,
  deskChambers,
  workspaceRoles,
  workspaceView,
  workspaceRoleFor,
  workspaceRouteAllowed,
} from '@platform/client';
import { CONSOLE, formatClock, localName, numeralsFor, t } from '@platform/i18n';
import { BilingualLabel, ConsoleAction, ConsoleHelp, useLocale } from '@platform/ui';

import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { StaffAccessFrame } from '@/components/StaffAccessFrame';
import { readDemoSession, writeDemoSession } from '@/lib/demo';
import { checkStaffQueueRead, loadStaffWorkspaceContext, signOut } from '@/lib/staffAuth';

const LABEL = {
  receptionist: 'roleReceptionist',
  doctor: 'roleDoctor',
  ward: 'roleWard',
  emergency: 'roleEmergency',
  lab: 'roleLab',
  pharmacy: 'rolePharmacy',
  hospital_admin: 'roleHospitalAdmin',
  platform_admin: 'platformSection',
  gov_viewer: 'govSection',
};
const KIND = {
  reception: 'reception',
  ward: 'ward',
  er: 'emergency',
  lab: 'lab',
  pharmacy: 'pharmacy',
  admin: 'admin',
  settings: 'settings',
  platform: 'platform',
  gov: 'gov',
};
const StaffWorkspace = createContext(null);
export function useStaffWorkspace() {
  return useContext(StaffWorkspace);
}
function deskAllowed(context, deskId) {
  const own = assignedDesks(context.desks, context.profile.staff.id);
  return deskId == null
    ? own.length === 0 ||
        context.profile.roles.includes('doctor') ||
        context.profile.roles.includes('hospital_admin')
    : own.some((desk) => desk.id === deskId);
}
function allowed(context, view, sessionId, role) {
  if (
    (view === 'reception' || view === 'registration') &&
    !deskAllowed(context, readDemoSession()?.receptionDeskId)
  )
    return false;
  const requestedRole = workspaceRoleFor(view, sessionId, role);
  if (
    view === null &&
    sessionId !== null &&
    context.readableSessionId === sessionId &&
    requestedRole !== null &&
    workspaceRoles(
      context.profile.roles,
      context.profile.hospital?.id ?? null,
      context.modulesOff,
    ).includes(requestedRole)
  )
    return true;
  return workspaceRouteAllowed({
    roles: context.profile.roles,
    hospitalId: context.profile.hospital?.id ?? null,
    modulesOff: context.modulesOff,
    chambers: context.chambers,
    view,
    sessionId,
    selectedRole: role,
  });
}

export function StaffEntry({
  session,
  view,
  sessionId,
  onChosen,
  onChanged,
  onEnded,
  onSignedOut,
  children,
}) {
  const locale = useLocale();
  const [context, setContext] = useState(null);
  const [failure, setFailure] = useState(null);
  const [checking, setChecking] = useState(true);
  const generation = useRef(0);
  const target = `${view ?? ''}:${sessionId ?? ''}`;
  const [validatedTarget, setValidatedTarget] = useState(null);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setChecking(true);
    const outcome = await loadStaffWorkspaceContext({
      includeEnded: view === 'reception' || view === 'registration',
    });
    if (request !== generation.current) return;
    if (outcome.kind !== 'ready') setChecking(false);
    if (outcome.kind === 'ended') {
      setContext(null);
      onEnded();
      return;
    }
    if (outcome.kind === 'restricted') {
      setContext(null);
      onChanged();
      return;
    }
    if (outcome.kind === 'ready') {
      let confirmed = outcome.context;
      // The work list excludes ended chambers, but V1 permits scoped direct
      // reads. Ask the existing endpoint before admitting such a URL.
      const requestedRole = workspaceRoleFor(view, sessionId, readDemoSession()?.role ?? '');
      if (
        view === null &&
        sessionId !== null &&
        requestedRole !== null &&
        workspaceRoles(
          confirmed.profile.roles,
          confirmed.profile.hospital?.id ?? null,
          confirmed.modulesOff,
        ).includes(requestedRole) &&
        !confirmed.chambers.some((entry) => entry.id === sessionId) &&
        (await checkStaffQueueRead(sessionId))
      ) {
        confirmed = { ...confirmed, readableSessionId: sessionId };
      }
      if (request !== generation.current) return;
      setChecking(false);
      setContext(confirmed);
      setFailure(null);
      const stored = readDemoSession();
      if (stored !== null && allowed(confirmed, view, sessionId, stored.role)) {
        const role = workspaceRoleFor(view, sessionId, stored.role);
        const chamber = confirmed.chambers.find((entry) => entry.id === sessionId);
        // A permitted deep link may be absent from today's picker roster.
        // Record the server-verified target for offline continuation, without
        // borrowing the previous target's doctor label (FR-OFF-01/02).
        const { chamber: previousChamber, ...withoutChamber } = stored;
        writeDemoSession({
          ...withoutChamber,
          ...((sessionId === null || stored.chamberSessionId === sessionId) &&
          previousChamber !== undefined
            ? { chamber: previousChamber }
            : {}),
          ...(role === null ? {} : { role }),
          workspaceView: view,
          ...(sessionId === null ? {} : { chamberSessionId: sessionId }),
          ...(chamber === undefined
            ? {}
            : {
                chamberSessionId: chamber.id,
                chamber: {
                  doctorNameBn: chamber.doctorNameBn,
                  doctorNameEn: chamber.doctorNameEn,
                  departmentNameBn: chamber.departmentNameBn,
                  departmentNameEn: chamber.departmentNameEn,
                  room: chamber.room,
                },
              }),
        });
        setValidatedTarget(target);
      }
      onChanged();
    } else setFailure(outcome.kind);
  }, [onChanged, onEnded, sessionId, target, view]);
  useEffect(() => {
    void load();
    const recheck = () => {
      void load();
    };
    globalThis.addEventListener('focus', recheck);
    globalThis.addEventListener('online', recheck);
    const timer =
      view === 'reception' || view === 'registration'
        ? globalThis.setInterval(recheck, 30_000)
        : null;
    return () => {
      generation.current += 1;
      globalThis.removeEventListener('focus', recheck);
      globalThis.removeEventListener('online', recheck);
      if (timer !== null) globalThis.clearInterval(timer);
    };
  }, [load, session.token]);

  const requested = view !== null || sessionId !== null;
  const currentRole = workspaceRoleFor(view, sessionId, session.role);
  const cachedContinuation =
    requested &&
    failure === 'offline' &&
    currentRole === session.role &&
    session.roles?.includes(session.role) === true &&
    (view === null
      ? sessionId === session.chamberSessionId
      : view === session.workspaceView || session.workspaceView === undefined);
  // Keep an already-authorised workspace mounted during ordinary refresh/focus
  // checks. Replacing it with a spinner would destroy unsaved doctor notes.
  if (
    requested &&
    ((context !== null &&
      validatedTarget === target &&
      currentRole !== null &&
      session.roles?.includes(currentRole) === true &&
      allowed(context, view, sessionId, session.role)) ||
      cachedContinuation)
  )
    return <StaffWorkspace.Provider value={context}>{children}</StaffWorkspace.Provider>;

  if (context === null || (requested && validatedTarget !== target && checking))
    return (
      <StaffAccessFrame title="accessWorkspaceStep">
        <div
          className="cf-access cf-stack"
          data-testid={checking ? 'picker-loading' : 'picker-failed'}
        >
          <p role={failure === null ? 'status' : 'alert'}>
            {t(
              checking
                ? 'accessLoading'
                : failure === 'offline'
                  ? 'accessOfflineSelection'
                  : 'accessLoadFailed',
              locale,
            )}
          </p>
          {checking ? null : (
            <ConsoleAction
              label={CONSOLE.retry}
              onClick={() => {
                void load();
              }}
            />
          )}
          <ConsoleAction
            label={CONSOLE.signOut}
            variant="secondary"
            onClick={() => {
              void signOut().then(onSignedOut);
            }}
          />
        </div>
      </StaffAccessFrame>
    );
  return (
    <StaffWorkspacePicker
      context={context}
      denied={requested}
      onChosen={onChosen}
      onChanged={onChanged}
      onEnded={onEnded}
      onContext={setContext}
      onSignedOut={onSignedOut}
    />
  );
}

function StaffWorkspacePicker({
  context,
  denied,
  onChosen,
  onChanged,
  onEnded,
  onContext,
  onSignedOut,
}) {
  const locale = useLocale();
  const roles = workspaceRoles(
    context.profile.roles,
    context.profile.hospital?.id ?? null,
    context.modulesOff,
  );
  const [pickedRole, setPickedRole] = useState(null);
  const role =
    pickedRole !== null && roles.includes(pickedRole)
      ? pickedRole
      : roles.length === 1
        ? (roles[0] ?? null)
        : null;
  const desks = assignedDesks(context.desks, context.profile.staff.id);
  const [chosenDesk, setChosenDesk] = useState(null);
  const deskId =
    chosenDesk === '__all__'
      ? null
      : chosenDesk !== null && desks.some((desk) => desk.id === chosenDesk)
        ? chosenDesk
        : desks.length === 1
          ? (desks[0]?.id ?? null)
          : null;
  const needsDesk =
    role === 'receptionist' && desks.length > 1 && deskId === null && chosenDesk !== '__all__';
  const deskOverride =
    context.profile.roles.includes('doctor') || context.profile.roles.includes('hospital_admin');
  const chambers = context.chambers.filter(
    (entry) => entry.status !== 'ended' && entry.status !== 'cancelled',
  );
  const offered =
    role === 'receptionist'
      ? deskChambers(chambers, context.desks, context.profile.staff.id, deskId)
      : chambers;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const auto = useRef(false);

  const open = useCallback(
    async (chosenRole, id, automatic = false) => {
      if (busy) return;
      setBusy(true);
      setFailed(false);
      const result = automatic ? { kind: 'ready', context } : await loadStaffWorkspaceContext();
      if (result.kind === 'ended') {
        onEnded();
        return;
      }
      if (result.kind === 'restricted') {
        onChanged();
        return;
      }
      if (result.kind !== 'ready') {
        setFailed(true);
        setBusy(false);
        return;
      }
      const fresh = result.context;
      onContext(fresh);
      const targetView = workspaceView(chosenRole, fresh.modulesOff);
      if (chosenRole === 'receptionist') {
        const stored = readDemoSession();
        if (stored === null || !deskAllowed(fresh, deskId)) {
          setFailed(true);
          setBusy(false);
          return;
        }
        writeDemoSession({ ...stored, receptionDeskId: deskId });
      }
      if (!allowed(fresh, targetView, id, chosenRole)) {
        setFailed(true);
        setBusy(false);
        onChanged();
        return;
      }
      if (
        chosenRole === 'receptionist' &&
        targetView === null &&
        deskId !== null &&
        !deskChambers(fresh.chambers, fresh.desks, fresh.profile.staff.id, deskId).some(
          (entry) => entry.id === id,
        )
      ) {
        setFailed(true);
        setBusy(false);
        return;
      }
      const stored = readDemoSession();
      if (stored === null) {
        onEnded();
        return;
      }
      const chamber = fresh.chambers.find((entry) => entry.id === id);
      writeDemoSession({
        ...stored,
        role: chosenRole,
        workspaceView: targetView,
        ...(chamber === undefined
          ? {}
          : {
              chamberSessionId: chamber.id,
              chamber: {
                doctorNameBn: chamber.doctorNameBn,
                doctorNameEn: chamber.doctorNameEn,
                departmentNameBn: chamber.departmentNameBn,
                departmentNameEn: chamber.departmentNameEn,
                room: chamber.room,
              },
            }),
      });
      onChanged();
      if (targetView === null && id !== null) onChosen({ kind: 'chamber', sessionId: id });
      else if (targetView !== null && KIND[targetView] !== undefined)
        onChosen({ kind: KIND[targetView] });
      setBusy(false);
    },
    [busy, context, deskId, onChanged, onChosen, onEnded, onContext],
  );
  useEffect(() => {
    if (
      auto.current ||
      denied ||
      readDemoSession()?.workspaceView !== undefined ||
      roles.length !== 1 ||
      role === null ||
      role === 'doctor' ||
      needsDesk
    )
      return;
    auto.current = true;
    void open(role, null, true);
  }, [denied, needsDesk, offered, open, role, roles.length]);

  const session = readDemoSession();
  if (session === null) return null;
  return (
    <ConsoleWorkspaceFrame
      session={session}
      workspace={CONSOLE.accessWorkspaceStep}
      navigation={[]}
      actions={
        <ConsoleHelp
          topic={{
            id: 'workspaces',
            title: CONSOLE.accessHelpTitle,
            steps: [CONSOLE.accessHelpMfa, CONSOLE.accessDoctorChoice, CONSOLE.accessHelpShared],
          }}
        />
      }
    >
      <div className="cf-access cf-stack" data-testid="console-picker">
        <p data-testid="picker-signed-in">{context.profile.staff.fullName}</p>
        {denied || failed ? (
          <p role="alert" className="cf-feedback cf-tone-caution">
            {t('accessDenied', locale)}
          </p>
        ) : null}
        <div className="cf-access-card cf-stack">
          <h1>
            {t(
              role === null
                ? 'accessChooseRole'
                : needsDesk
                  ? 'accessChooseDesk'
                  : role === 'doctor' || role === 'receptionist'
                    ? 'accessChooseChamber'
                    : 'accessWorkspaceStep',
              locale,
            )}
          </h1>
          {roles.length === 0 ? <p role="status">{t('accessNoWork', locale)}</p> : null}
          {role === null ? (
            <div className="cf-work-choices">
              {roles.map((option) => (
                <button
                  type="button"
                  className="cf-choice"
                  key={option}
                  data-testid={`choose-role-${option}`}
                  disabled={busy}
                  onClick={() => {
                    setPickedRole(option);
                    auto.current = false;
                    if (option !== 'doctor' && option !== 'receptionist') void open(option, null);
                  }}
                >
                  <BilingualLabel label={CONSOLE[LABEL[option]]} />
                </button>
              ))}
            </div>
          ) : null}
          {needsDesk ? (
            <div className="cf-work-choices" data-testid="picker-desks">
              {desks.map((desk) => (
                <button
                  type="button"
                  className="cf-choice"
                  key={desk.id}
                  data-testid={`picker-desk-${desk.id}`}
                  disabled={busy}
                  onClick={() => {
                    setChosenDesk(desk.id);
                    auto.current = false;
                  }}
                >
                  {localName(locale, desk.nameBn, desk.nameEn)}
                </button>
              ))}
            </div>
          ) : null}
          {role === 'receptionist' && deskOverride && desks.length > 0 ? (
            <ConsoleAction
              label={CONSOLE.accessAllChambers}
              variant="secondary"
              onClick={() => {
                setChosenDesk('__all__');
                auto.current = false;
              }}
            />
          ) : null}
          {role === 'doctor' ? (
            <p className="cf-feedback cf-tone-information">{t('accessDoctorChoice', locale)}</p>
          ) : null}
          {role === 'receptionist' && desks.length === 0 ? (
            <p>{t('accessCommonDesk', locale)}</p>
          ) : null}
          {role === 'doctor' && !needsDesk ? (
            <>
              {offered.length === 0 ? (
                <p data-testid="picker-no-chambers">{t('accessNoChamber', locale)}</p>
              ) : null}
              <div className="cf-stack">
                {offered.map((chamber) => (
                  <button
                    type="button"
                    className="cf-choice cf-chamber-choice"
                    key={chamber.id}
                    data-testid={`open-${role}-${chamber.id}`}
                    disabled={busy}
                    onClick={() => {
                      void open(role, chamber.id);
                    }}
                  >
                    <strong>{localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)}</strong>
                    <small>
                      {localName(locale, chamber.departmentNameBn, chamber.departmentNameEn)} ·{' '}
                      {formatClock(chamber.plannedStart, numeralsFor(locale))}
                      {chamber.room === null ? '' : ` · ${chamber.room}`}
                    </small>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {role !== null && role !== 'doctor' && !needsDesk ? (
            <ConsoleAction
              label={CONSOLE[LABEL[role]]}
              loading={busy}
              data-testid={`open-${workspaceView(role, context.modulesOff)}${role === 'hospital_admin' ? `-${context.profile.hospital?.id ?? ''}` : ''}`}
              onClick={() => {
                void open(role, null);
              }}
            />
          ) : null}
          {roles.length > 1 && role !== null ? (
            <ConsoleAction
              label={CONSOLE.accessChangeChoice}
              variant="secondary"
              onClick={() => {
                setPickedRole(null);
                setChosenDesk(null);
                auto.current = false;
              }}
            />
          ) : null}
        </div>
        <ConsoleAction
          label={CONSOLE.signOut}
          variant="secondary"
          data-testid="picker-sign-out"
          onClick={() => {
            void signOut().then(onSignedOut);
          }}
        />
        {context.profile.twoFactor.enabled ? (
          <p data-testid="picker-tfa-on">{t('tfaOnNote', locale)}</p>
        ) : (
          <a href="/?view=2fa" data-testid="picker-tfa-setup">
            {t('tfaSetupTitle', locale)}
          </a>
        )}
        {context.profile.twoFactor.enabled && context.profile.twoFactor.recoveryCodesLeft <= 2 ? (
          <p className="cf-feedback cf-tone-caution" data-testid="picker-tfa-low">
            {t('tfaRecoveryLow', locale)}
          </p>
        ) : null}
      </div>
    </ConsoleWorkspaceFrame>
  );
}
