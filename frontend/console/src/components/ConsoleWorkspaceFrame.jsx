'use client';

/** Shared workspace adapter (FR-BRD-12, FR-ROLE-01), used by staff landing.
 * Receives the existing authenticated session; does not alter login or routing.
 * The shared shell only displays the permitted choices supplied by its caller.
 */
import { useEffect, useState } from 'react';

import { PATIENT } from '@platform/i18n';
import {
  ConsoleHeader,
  ConsoleShell,
  ConsoleTheme,
  consoleNavigationFor,
  useLocale,
} from '@platform/ui';
import '@platform/ui/console.css';

import { ConsoleRail } from '@/components/ConsoleRail';
import { brandKept, loadBrand, logoOf } from '@/lib/brand';
import './console-workspace-frame.css';

export function ConsoleWorkspaceFrame({
  session,
  workspace,
  navigation,
  actions,
  refreshKey,
  rail,
  children,
}) {
  const { hospitalId, token } = session;
  const limited =
    session.mustChangePassword === true ||
    (session.twoFactor?.required === true && !session.twoFactor.enabled);
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (hospitalId === null || limited) return;
    let cancelled = false;
    void loadBrand(hospitalId, token, refreshKey !== undefined).then((brand) => {
      if (!cancelled && brand !== null) setLoaded({ hospitalId, brand });
    });
    return () => {
      cancelled = true;
    };
  }, [hospitalId, token, limited, refreshKey]);
  // Never draw a previous hospital's resolved brand during a context change.
  const brand =
    hospitalId === null || limited
      ? null
      : loaded?.hospitalId === hospitalId
        ? loaded.brand
        : brandKept(hospitalId);
  const identity =
    hospitalId === null
      ? PATIENT.appName
      : {
          bn: brand?.nameBn ?? session.hospitalNameBn ?? PATIENT.appName.bn,
          en:
            brand?.nameEn ?? session.hospitalNameEn ?? session.hospitalNameBn ?? PATIENT.appName.en,
        };
  const roles = session.roles ?? [session.role];
  const permitted = consoleNavigationFor(navigation, roles, limited);
  const locale = useLocale();
  return (
    <ConsoleTheme brand={brand?.theme?.colors ?? null}>
      <div className={rail === undefined ? '' : 'console-workspace-layout'}>
        {rail === undefined ? null : <ConsoleRail current={rail} locale={locale} />}
        <ConsoleShell
          navigation={permitted}
          header={
            <ConsoleHeader
              identity={identity}
              logo={logoOf(brand)}
              workspace={workspace}
              actions={actions}
            />
          }
        >
          {children}
        </ConsoleShell>
      </div>
    </ConsoleTheme>
  );
}
