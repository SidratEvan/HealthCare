'use client';

/**
 * Waits to know whose address this is before showing anything of anybody's
 * (`FR-BRD-07`; plan C2).
 *
 * At the network's own address, and at `<code>.<platform domain>`, the app
 * knows where it is from the address alone and this renders its children at
 * once. At any other name it cannot know: the name may be a domain a hospital
 * owns, and only the server can say. Until it has said, nothing is shown,
 * because the one thing a hospital's portal must not do is open on every
 * other hospital first and narrow a moment later (`lib/scope`).
 *
 * Three answers. A hospital's, or the network's: kept for the visit, so the
 * wait is once, and the app is shown. Nobody's: a name nobody has recorded,
 * where the API answers a browser nothing else, so the app says that and
 * points at the network. No answer: it says so and asks again when told to.
 *
 * `useSyncExternalStore` rather than state: the server renders the page for
 * every address at once and cannot know, so the first client render has to
 * agree with it and the difference is taken up straight after, before
 * anything is painted.
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { tp } from '@platform/i18n';
import { Button, useLocale } from '@platform/ui';

import { LanguageToggle } from '@/components/LanguageToggle';
import { askWhoseAddress } from '@/hooks/useDeployment';
import { hostNeedsAsking, onHostAnswer } from '@/lib/scope';

type Waiting =
  | { readonly kind: 'asking' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'nobodys'; readonly networkUrl: string | null };

export function PortalGate({ children }: { readonly children: ReactNode }): ReactNode {
  const locale = useLocale();
  const needsAsking = useSyncExternalStore(onHostAnswer, hostNeedsAsking, () => false);
  const [waiting, setWaiting] = useState<Waiting>({ kind: 'asking' });

  const ask = useCallback(() => {
    setWaiting({ kind: 'asking' });
    void askWhoseAddress().then((answer) => {
      if (answer.kind !== 'answered') setWaiting(answer);
    });
  }, []);

  useEffect(() => {
    if (needsAsking) ask();
  }, [needsAsking, ask]);

  if (!needsAsking) return children;

  return (
    <>
      {/* SEG-A00-LANG: even a screen that is waiting can be read in English.
          Beside the gate, not in it, as every screen's switch is in its
          header and not in its <main>. */}
      <header className="fixed top-[calc(12px+env(safe-area-inset-top))] right-5 z-10">
        <LanguageToggle />
      </header>

      <main
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"
        data-testid="portal-gate"
        data-state={waiting.kind}
      >
        {waiting.kind === 'asking' ? (
          <p role="status" className="text-body-md text-ink-muted">
            {tp('loading', locale)}
          </p>
        ) : waiting.kind === 'unreachable' ? (
          <div role="alert" className="flex max-w-sm flex-col items-center gap-3">
            <p className="text-body-md text-ink-secondary">{tp('portalUnreachable', locale)}</p>
            <Button onClick={ask}>{tp('tryAgain', locale)}</Button>
          </div>
        ) : (
          <div role="status" className="flex max-w-sm flex-col items-center gap-3">
            <p className="text-body-md text-ink-secondary">{tp('portalNobodys', locale)}</p>
            {waiting.networkUrl === null ? null : (
              <a
                href={waiting.networkUrl}
                className="flex min-h-touch items-center rounded-md bg-brand-600 px-4 font-ui text-body-md font-semibold text-ink-inverse"
                data-testid="portal-go-network"
              >
                {tp('portalGoNetwork', locale)}
              </a>
            )}
          </div>
        )}
      </main>
    </>
  );
}
