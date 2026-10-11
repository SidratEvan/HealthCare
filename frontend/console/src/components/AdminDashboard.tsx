'use client';

/** Integrated Administration workspace, preserving the Batch 5A read views.
 * FR-ADM-01..12, FR-BRD-12, GR-03/06.
 */
import { useState, useCallback, type ReactNode } from 'react';

import { CONSOLE, t } from '@platform/i18n';
import { ConsoleHelp, ConsolePageHeader, ToastProvider, useLocale } from '@platform/ui';

import { AdminManagement } from '@/components/AdminManagement';
import {
  AdminManagementProvider,
  AdminManagementFeedback,
  useAdminManagement,
} from '@/components/AdminManagementContext';
import { AdminNow } from '@/components/AdminNow';
import { AdminReports } from '@/components/AdminReports';
import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { readDemoSession } from '@/lib/demo';
import '@platform/ui/console-admin.css';

type Page = 'today' | 'reports' | 'staff' | 'doctors' | 'settings';
const ENTRIES = [
  { id: 'today', label: CONSOLE.adminNavToday, icon: 'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16' },
  {
    id: 'reports',
    label: CONSOLE.adminNavReports,
    icon: 'M4 20V4 M4 20h16 M9 17v-6 M14 17V7 M19 17V3',
  },
  {
    id: 'staff',
    label: CONSOLE.adminNavStaff,
    icon: 'M4 20v-3a4 4 0 0 1 8 0v3 M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M15 13h6v7h-6z',
  },
  {
    id: 'doctors',
    label: CONSOLE.adminNavDoctors,
    icon: 'M5 4v4a5 5 0 0 0 10 0V4 M10 13v3a4 4 0 0 0 8 0v-3 M18 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  },
  {
    id: 'settings',
    label: CONSOLE.adminNavSettings,
    icon: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  },
] as const;

export function AdminDashboard({
  legacySettings = false,
}: {
  readonly legacySettings?: boolean;
}): ReactNode {
  return (
    <ToastProvider>
      <AdminManagementProvider>
        <AdminWorkspace legacySettings={legacySettings} />
      </AdminManagementProvider>
    </ToastProvider>
  );
}
function AdminWorkspace({ legacySettings }: { readonly legacySettings: boolean }): ReactNode {
  const locale = useLocale();
  const session = readDemoSession();
  const management = useAdminManagement();
  const initialTab =
    typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('tab');
  const legacyPage: Page =
    initialTab === 'staff'
      ? 'staff'
      : initialTab === 'doctors' || initialTab === 'departments'
        ? 'doctors'
        : 'settings';
  const [page, setPage] = useState<Page>(legacySettings ? legacyPage : 'today');
  const [legacyGroup, setLegacyGroup] = useState<string | undefined>(
    legacySettings &&
      initialTab !== null &&
      ['departments', 'beds', 'capabilities'].includes(initialTab)
      ? initialTab
      : undefined,
  );
  const [modulesOff, setModulesOff] = useState<readonly string[]>([]);
  const [brandRead, setBrandRead] = useState<string>();
  const onModules = useCallback((off: readonly string[], serverTs: string) => {
    setModulesOff(off);
    setBrandRead(serverTs);
  }, []);
  const entry = ENTRIES.find((item) => item.id === page) ?? ENTRIES[0];
  const descriptions = {
    today: CONSOLE.adminTodayDescription,
    reports: CONSOLE.adminReportsDescription,
    staff: CONSOLE.manageStaffDescription,
    doctors: CONSOLE.manageDoctorsDescription,
    settings: CONSOLE.manageSettingsDescription,
  };
  if (session === null) return null;
  return (
    <div className="admin-workspace" data-testid="admin-dashboard">
      <ConsoleWorkspaceFrame
        session={session}
        {...(brandRead === undefined ? {} : { refreshKey: brandRead })}
        workspace={CONSOLE.adminTitle}
        navigation={ENTRIES.map((entry) => ({
          ...entry,
          icon: (
            <svg
              data-testid={entry.id === 'settings' ? 'admin-open-settings' : undefined}
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d={entry.icon} />
            </svg>
          ),
          current: entry.id === page,
          roles: ['hospital_admin'],
          enabled:
            !(entry.id === 'today' || entry.id === 'reports') || !modulesOff.includes('dashboard'),
          onSelect: () =>
            management?.navigate(() => {
              setLegacyGroup(undefined);
              setPage(entry.id);
              globalThis.scrollTo(0, 0);
            }),
        }))}
        actions={
          <>
            <ConsoleHelp
              topic={{
                id: `admin-${page}`,
                title: entry.label,
                steps:
                  page === 'today'
                    ? [
                        CONSOLE.adminHelpToday,
                        CONSOLE.adminHelpChambers,
                        CONSOLE.adminHelpUnavailable,
                      ]
                    : page === 'reports'
                      ? [
                          CONSOLE.adminHelpReports,
                          CONSOLE.adminReportFreshness,
                          CONSOLE.adminHelpUnavailable,
                        ]
                      : page === 'staff'
                        ? [
                            CONSOLE.manageHelpStaff,
                            CONSOLE.manageHelpDesks,
                            CONSOLE.manageHelpUnsaved,
                          ]
                        : page === 'doctors'
                          ? [CONSOLE.manageHelpDoctors, CONSOLE.manageHelpUnsaved]
                          : [CONSOLE.manageHelpSettings, CONSOLE.manageHelpUnsaved],
              }}
            />
            <small>{session.staffName}</small>
            <a
              className="cf-work-switch"
              href="/"
              onClick={(event) => {
                event.preventDefault();
                management?.navigate(() => globalThis.location.assign('/'));
              }}
            >
              {t('changeConsole', locale)}
            </a>
          </>
        }
      >
        <AdminManagementFeedback />
        <DemoBanner className="print:hidden" />
        <ConsolePageHeader title={entry.label} description={descriptions[page]} />
        {page === 'today' ? (
          <>
            <AdminNow />
            <AdminReports key="daily" daily />
          </>
        ) : page === 'reports' ? (
          <AdminReports key="reports" />
        ) : (
          <AdminManagement
            key={page}
            page={page}
            onModules={onModules}
            {...(page === legacyPage && legacyGroup !== undefined
              ? { initialGroup: legacyGroup }
              : {})}
          />
        )}
      </ConsoleWorkspaceFrame>
    </div>
  );
}
