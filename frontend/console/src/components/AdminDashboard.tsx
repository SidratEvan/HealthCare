'use client';

/** Batch 5A: Today and Reports; the other entries open existing V1 panes.
 * FR-ADM-01..12, FR-BRD-12, GR-03/06. No settings or queue writes here.
 */
import { useState, type ReactNode } from 'react';

import { CONSOLE, t } from '@platform/i18n';
import { ConsoleHelp, ConsolePageHeader, useLocale } from '@platform/ui';

import { AdminNow } from '@/components/AdminNow';
import { AdminReports } from '@/components/AdminReports';
import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { readDemoSession } from '@/lib/demo';
import '@platform/ui/console-admin.css';

type Page = 'today' | 'reports';
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

export function AdminDashboard(): ReactNode {
  const locale = useLocale();
  const session = readDemoSession();
  const [page, setPage] = useState<Page>('today');
  if (session === null) return null;
  return (
    <div className="admin-workspace" data-testid="admin-dashboard">
      <ConsoleWorkspaceFrame
        session={session}
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
          enabled: true,
          onSelect: () => {
            if (entry.id === 'today' || entry.id === 'reports') {
              setPage(entry.id);
              globalThis.scrollTo(0, 0);
            } else {
              globalThis.location.assign(
                `/?view=settings&tab=${entry.id === 'settings' ? 'profile' : entry.id}`,
              );
            }
          },
        }))}
        actions={
          <>
            <ConsoleHelp
              topic={{
                id: `admin-${page}`,
                title: page === 'today' ? CONSOLE.adminNavToday : CONSOLE.adminNavReports,
                steps:
                  page === 'today'
                    ? [
                        CONSOLE.adminHelpToday,
                        CONSOLE.adminHelpChambers,
                        CONSOLE.adminHelpUnavailable,
                      ]
                    : [
                        CONSOLE.adminHelpReports,
                        CONSOLE.adminReportFreshness,
                        CONSOLE.adminHelpUnavailable,
                      ],
              }}
            />
            <small>{session.staffName}</small>
            <a className="cf-work-switch" href="/">
              {t('changeConsole', locale)}
            </a>
          </>
        }
      >
        <DemoBanner className="print:hidden" />
        <ConsolePageHeader
          title={page === 'today' ? CONSOLE.adminNavToday : CONSOLE.adminNavReports}
          description={
            page === 'today' ? CONSOLE.adminTodayDescription : CONSOLE.adminReportsDescription
          }
        />
        {page === 'today' ? (
          <>
            <AdminNow />
            <AdminReports key="daily" daily />
          </>
        ) : (
          <AdminReports key="reports" />
        )}
      </ConsoleWorkspaceFrame>
    </div>
  );
}
