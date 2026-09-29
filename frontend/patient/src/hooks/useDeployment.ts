'use client';

/**
 * What this deployment offers (`GET /config`, pilot step 26).
 *
 * A hospital's own server with no merchant account runs
 * `PAYMENT_PROVIDER=off`: the app then offers paying at the hospital only,
 * rather than a bKash button that could never take the money. Until the answer
 * arrives — or if it cannot be had — the app assumes online payment exists, as
 * it always has, and the server still refuses an online method it cannot take.
 *
 * Asked once per page load and shared.
 */

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

export interface DeploymentConfig {
  readonly demo: boolean;
  readonly onlinePayments: boolean;
  readonly guestPhoneCheck: boolean;
}

let pending: Promise<DeploymentConfig | null> | null = null;

function ask(): Promise<DeploymentConfig | null> {
  pending ??= api.get<DeploymentConfig>('/config').catch(() => null);
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
