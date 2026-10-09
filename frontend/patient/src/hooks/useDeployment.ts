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
import { hostToAsk, onHostAnswer, rememberHostAnswer, scopedPath } from '@/lib/scope';

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
  /**
   * The modules it does not run (`FR-BRD-11`) and the figures it keeps
   * (`FR-NET-04`): its own portal offers nothing of either.
   */
  readonly modulesOff?: readonly string[];
  readonly notShared?: readonly string[];
  /** True when the address itself is this hospital's portal (`FR-BRD-07`). */
  readonly byAddress?: boolean;
  /** What its logo is as an image, when that is known (`FR-BRD-08`). */
  readonly logoImage?: {
    readonly type: string;
    readonly width: number;
    readonly height: number;
  } | null;
}

export interface DeploymentConfig {
  readonly demo: boolean;
  readonly onlinePayments: boolean;
  /** The online methods this deployment can take (plan H3). Absent from an older server. */
  readonly paymentMethods?: readonly string[];
  readonly guestPhoneCheck: boolean;
  /** Null for the network's own app. */
  readonly scope: ScopeConfig | null;
  /**
   * What the address the app was opened at is (`FR-BRD-07`): the network's,
   * a hospital's portal, or nobody's, in which case `networkUrl` is where
   * the network is.
   */
  readonly address?: 'network' | 'portal' | 'nobodys';
  readonly networkUrl?: string;
}

let pending: Promise<DeploymentConfig | null> | null = null;

function ask(): Promise<DeploymentConfig | null> {
  // The address it was opened at goes with the question (`FR-BRD-07`): at a
  // hospital's portal the answer is that hospital's, with nothing asked for.
  const params = new URLSearchParams();
  const host = hostToAsk();
  if (host !== null) params.set('host', host);
  pending ??= api.get<DeploymentConfig>(scopedPath('/config', params)).catch(() => null);
  return pending;
}

/**
 * Asks the server whose address this is, and keeps the answer for the visit
 * (`<PortalGate>`). False when the server could not be reached: the question
 * is then put again, because nothing can be shown without the answer.
 */
export async function askWhoseAddress(): Promise<
  | { readonly kind: 'answered' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'nobodys'; readonly networkUrl: string | null }
> {
  const answer = await ask();
  if (answer === null) {
    // Not remembered as an answer: the next try asks again.
    pending = null;
    return { kind: 'unreachable' };
  }
  if (answer.address === 'nobodys') {
    // Not kept either: the name may be recorded for a hospital tomorrow.
    pending = null;
    return { kind: 'nobodys', networkUrl: answer.networkUrl ?? null };
  }
  rememberHostAnswer(answer.scope?.byAddress === true ? answer.scope.code : null);
  return { kind: 'answered' };
}

export function useDeployment(): DeploymentConfig | null {
  const [config, setConfig] = useState<DeploymentConfig | null>(null);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void ask().then((answer) => {
        if (live) setConfig(answer);
      });
    };
    read();
    // Asked again once the server has said whose address this is: a first
    // question that could not be put (`<PortalGate>`) left nothing to show.
    const stop = onHostAnswer(read);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return config;
}
