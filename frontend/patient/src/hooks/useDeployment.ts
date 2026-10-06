'use client';

/**
 * What this deployment offers, and whose app this is (`GET /config`, pilot
 * step 26; `FR-BRD-02`).
 *
 * A hospital's own server with no merchant account runs
 * `PAYMENT_PROVIDER=off`: the app then offers paying at the hospital only,
 * rather than a bKash button that could never take the money. Until the answer
 * arrives — or if it cannot be had — the app assumes online payment exists, as
 * it always has, and the server still refuses an online method it cannot take.
 *
 * When the app is open for one hospital (`lib/scope`), the same answer says
 * which: its name in both languages and, if it has set them, its colours.
 *
 * Asked once per page load and shared.
 */

import { useEffect, useState } from 'react';

import type { BrandTheme } from '@platform/domain';

import { api } from '@/lib/api';
import { scopedPath } from '@/lib/scope';

/** The hospital this app is open for (`FR-PAT-19`). */
export interface ScopeConfig {
  readonly code: string;
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly theme: BrandTheme | null;
  /** Its own words and its logo (`FR-BRD-06`). */
  readonly descriptionBn?: string | null;
  readonly descriptionEn?: string | null;
  readonly logoVersion?: string | null;
}

export interface DeploymentConfig {
  readonly demo: boolean;
  readonly onlinePayments: boolean;
  readonly guestPhoneCheck: boolean;
  /** Null for the network's own app. */
  readonly scope: ScopeConfig | null;
}

let pending: Promise<DeploymentConfig | null> | null = null;

function ask(): Promise<DeploymentConfig | null> {
  pending ??= api.get<DeploymentConfig>(scopedPath('/config')).catch(() => null);
  return pending;
}

export function useDeployment(): DeploymentConfig | null {
  const [config, setConfig] = useState<DeploymentConfig | null>(null);
  useEffect(() => {
    let live = true;
    void ask().then((answer) => {
      if (live) setConfig(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return config;
}
