'use client';

/**
 * Puts a hospital's colours on the app when it is open for that hospital
 * (`FR-BRD-03`).
 *
 * The brand is six tokens (`tokens.css`), and every component reads them and
 * nothing else, so a hospital's app is those six variables set on the
 * document. No component knows it happened.
 *
 * The values come from `GET /config?scope=…`, which has already refused a
 * theme that would be unreadable (`readBrandTheme`), and they are checked for
 * shape again here before they touch a style: this is the one place a value
 * from the network becomes CSS.
 *
 * Renders nothing. With no scope, or a hospital that has set no colours, it
 * removes anything it set, so leaving a scope restores the platform's own.
 */

import { useEffect } from 'react';

import { BRAND_TOKENS } from '@platform/domain';

import { useDeployment } from '@/hooks/useDeployment';

import type { ReactNode } from 'react';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ScopeTheme(): ReactNode {
  const deployment = useDeployment();
  const theme = deployment?.scope?.theme ?? null;

  useEffect(() => {
    const root = globalThis.document.documentElement;

    for (const token of BRAND_TOKENS) {
      const value = theme?.colors[token];
      if (value !== undefined && HEX.test(value)) root.style.setProperty(`--${token}`, value);
      else root.style.removeProperty(`--${token}`);
    }

    // Said on the element as well, so a test and a support call can both see
    // which hospital's colours are on screen without reading six variables.
    if (deployment?.scope == null) delete root.dataset['scope'];
    else root.dataset['scope'] = deployment.scope.code;
  }, [theme, deployment]);

  return null;
}
