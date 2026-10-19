'use client';

/** Desk-scoped reception presentation (FR-REC-32, FR-QUE-05, FR-OFF-01).
 * Each stable chamber owns its existing queue controller; collapse changes
 * visibility only. Metadata never substitutes for a queue's actual snapshot.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deskChambers } from '@platform/client';
import { waitingQueue } from '@platform/domain';
import { CONSOLE, formatNumber, localName, numeralsFor, t } from '@platform/i18n';
import {
  ConsoleAction,
  ConsoleHelp,
  ConsolePageHeader,
  ConsoleState,
  useLocale,
  useToast,
  useWindowKeydown,
} from '@platform/ui';

import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { useStaffWorkspace } from '@/components/StaffEntry';
import { readDemoSession, writeDemoSession } from '@/lib/demo';
import '@platform/ui/console-reception.css';
export const receptionHelp = {
  id: 'reception',
  title: CONSOLE.roleReceptionist,
  steps: [
    CONSOLE.receptionHelpAdd,
    CONSOLE.receptionHelpNext,
    CONSOLE.receptionHelpArrival,
    CONSOLE.receptionUndoHelp,
    CONSOLE.receptionHelpPause,
    CONSOLE.receptionHelpOffline,
  ],
};

export function ReceptionWorkspace({ renderQueue }) {
  const locale = useLocale();
  const { show } = useToast();
  const context = useStaffWorkspace();
  const session = readDemoSession();
  const [ready, setReady] = useState(false);
  const [legacyId, setLegacyId] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [active, setActive] = useState(null);
  const commands = useRef(new Map());
  const register = useCallback((id, command) => {
    if (command === null) commands.current.delete(id);
    else commands.current.set(id, command);
  }, []);
  const [snapshots, setSnapshots] = useState(new Map());
  useEffect(() => {
    const id = new URLSearchParams(globalThis.location.search).get('session');
    setLegacyId(id);
    if (id !== null) {
      setExpanded(new Set([id]));
      setActive(id);
    }
    setReady(true);
  }, []);
  const deskId = session?.receptionDeskId ?? null;
  const chambers = useMemo(() => {
    if (legacyId !== null) {
      const known = context?.chambers.find((chamber) => chamber.id === legacyId);
      if (known !== undefined) return [known];
      const cached = readDemoSession();
      const identity = cached?.chamberSessionId === legacyId ? cached.chamber : undefined;
      return [
        {
          id: legacyId,
          doctorId: '',
          hospitalId: cached?.hospitalId ?? '',
          doctorNameBn: identity?.doctorNameBn ?? CONSOLE.navQueue.bn,
          doctorNameEn: identity?.doctorNameEn ?? CONSOLE.navQueue.en,
          departmentNameBn: identity?.departmentNameBn ?? '',
          departmentNameEn: identity?.departmentNameEn ?? '',
          room: identity?.room ?? null,
          status: '',
          plannedStart: '',
        },
      ];
    }
    if (context === null) return readDemoSession()?.receptionChambers ?? [];
    return deskChambers(context.chambers, context.desks, context.profile.staff.id, deskId);
  }, [context, legacyId, deskId]);
  useEffect(() => {
    if (!ready || legacyId !== null || context === null) return;
    const cached = readDemoSession();
    if (cached === null) return;
    writeDemoSession({
      ...cached,
      receptionChambers: chambers.map((chamber) => ({
        id: chamber.id,
        hospitalId: chamber.hospitalId,
        doctorId: chamber.doctorId,
        doctorNameBn: chamber.doctorNameBn,
        doctorNameEn: chamber.doctorNameEn,
        departmentNameBn: chamber.departmentNameBn,
        departmentNameEn: chamber.departmentNameEn,
        room: chamber.room,
        status: chamber.status,
        plannedStart: chamber.plannedStart,
      })),
    });
  }, [ready, legacyId, context, chambers]);
  const report = useCallback((id, snapshot) => {
    setSnapshots((current) => {
      const old = current.get(id);
      if (
        old?.state === snapshot.state &&
        old?.connected === snapshot.connected &&
        old?.pendingCount === snapshot.pendingCount &&
        old?.lastServerTs === snapshot.lastServerTs
      )
        return current;
      return new Map(current).set(id, snapshot);
    });
  }, []);
  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest('input,textarea,select,[contenteditable=true],[role=dialog]') ||
      document.querySelector('[role=dialog][data-state=open]')
    )
      return;
    const key = event.key.toLowerCase();
    const control = target?.closest('button,a,summary');
    if (
      control !== null &&
      control !== undefined &&
      (key === ' ' ||
        control.closest('[data-session-id]')?.getAttribute('data-session-id') !== active)
    )
      return;
    const modified = event.ctrlKey || event.metaKey;
    const action =
      modified && !event.altKey && key === 'z'
        ? 'undo'
        : modified || event.altKey
          ? null
          : ({ n: 'next', ' ': 'next', a: 'arrived', p: 'pause', w: 'walkIn' }[key] ?? null);
    if (action === null) return;
    event.preventDefault();
    const command =
      active !== null && expanded.has(active) && chambers.some((chamber) => chamber.id === active)
        ? commands.current.get(active)
        : undefined;
    if (command === undefined) show({ title: t('receptionChooseQueue', locale), tone: 'caution' });
    else command[action]();
  });

  if (session === null) return null;
  const selectedDesk = context?.desks.find((desk) => desk.id === deskId);
  const live = chambers.map((chamber) => snapshots.get(chamber.id));
  const allKnown =
    live.length > 0 &&
    live.every((snapshot) => snapshot?.state !== null && snapshot?.state !== undefined);
  const waiting = allKnown
    ? live.reduce(
        (sum, snapshot) =>
          sum + (snapshot?.state == null ? 0 : waitingQueue(snapshot.state).length),
        0,
      )
    : null;
  const navigation = [
    {
      id: 'queue',
      label: CONSOLE.navQueue,
      roles: ['receptionist'],
      enabled: true,
      current: true,
      onSelect: () => globalThis.scrollTo(0, 0),
    },
    {
      id: 'registration',
      label: CONSOLE.receptionRegister,
      roles: ['receptionist'],
      enabled: true,
      onSelect: () => globalThis.location.assign('/?view=registration'),
    },
  ];
  return (
    <ConsoleWorkspaceFrame
      session={session}
      workspace={CONSOLE.roleReceptionist}
      rail="navQueue"
      navigation={navigation}
      actions={
        <>
          <ConsoleHelp topic={receptionHelp} />
          <a className="cf-work-switch" href="/">
            {t('changeConsole', locale)}
          </a>
        </>
      }
    >
      <DemoBanner />
      <div className="cf-stack cf-reception-workspace" data-testid="reception-workspace">
        <ConsolePageHeader
          title={legacyId === null ? CONSOLE.receptionToday : CONSOLE.navQueue}
          actions={<span className="cf-secondary">{session.staffName}</span>}
        />
        <p>
          {selectedDesk === undefined
            ? t('accessCommonDesk', locale)
            : localName(locale, selectedDesk.nameBn, selectedDesk.nameEn)}{' '}
          · {formatNumber(chambers.length, numeralsFor(locale))} · {t('receptionChambers', locale)}
        </p>
        <p role="status" className="cf-secondary">
          {chambers.length === 0
            ? t('accessNoChamber', locale)
            : waiting === null
              ? t('receptionCountsLoading', locale)
              : `${formatNumber(waiting, numeralsFor(locale))} · ${t('countWaiting', locale)}`}
        </p>
        <p className="cf-secondary">{t('receptionKeyboardHint', locale)}</p>
        {!ready ? (
          <ConsoleState kind="loading" description={CONSOLE.accessLoading} />
        ) : chambers.length === 0 ? (
          <div data-testid="picker-no-chambers">
            <ConsoleState kind="empty" description={CONSOLE.accessNoChamber} />
            <ConsoleAction
              label={CONSOLE.accessChangeChoice}
              onClick={() => globalThis.location.assign('/')}
            />
          </div>
        ) : (
          chambers.map((chamber) => (
            <div key={chamber.id}>
              {renderQueue({
                chamber,
                multi: legacyId === null,
                expanded: expanded.has(chamber.id),
                active: active === chamber.id,
                onActivate: () => setActive(chamber.id),
                onToggle: () => {
                  setActive(chamber.id);
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (next.has(chamber.id)) next.delete(chamber.id);
                    else next.add(chamber.id);
                    return next;
                  });
                },
                onReport: report,
                onCommands: register,
              })}
            </div>
          ))
        )}
      </div>
    </ConsoleWorkspaceFrame>
  );
}
