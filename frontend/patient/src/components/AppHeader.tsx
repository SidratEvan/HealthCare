'use client';

/**
 * `<AppHeader>`: the one header every patient screen wears (FRONTEND.md §0.5).
 *
 * Two forms, one component:
 *
 *   **brand** (home): the official logo, or a hospital's mark and name inside
 *   its own app (`FR-PAT-19`, `FR-BRD-06`); then the language switch and the
 *   profile.
 *
 *   **title** (every other screen): a back control where the screen has a
 *   way back, the screen's title as its one `<h1>`, and the language switch.
 *
 * It sits outside `<main>`. The switch names its own language ("বাংলা") on
 * purpose, and a page whose `<main>` holds only the reader's language is what
 * the language test checks; the header is chrome, not content.
 */

import { localName, tp } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import { BrandLogo } from '@/components/BrandLogo';
import { HospitalMark } from '@/components/HospitalMark';
import { BackIcon, ProfileIcon } from '@/components/icons';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useDeployment } from '@/hooks/useDeployment';

import type { MouseEvent, ReactNode } from 'react';

/**
 * Where a back control goes.
 *
 * `fallback` is an address: the control goes back in history when the person
 * came from another page of this app, and to the address when they did not
 * (opened from an SMS link, say), so it is never a dead end. `onBack` is a step
 * inside one screen, such as the booking flow's.
 */
export type BackTarget =
  { readonly fallback: string } | { readonly onBack: () => void; readonly testId?: string };

/** Characters beyond which a title takes the smaller size ("আমার লাইভ সিরিয়াল"). */
const LONG_TITLE = 14;

/** The header's height above the safe area, so a page can reserve it. */
const HEADER_CLASS =
  'mx-auto flex w-full max-w-[480px] items-center gap-3 px-5 pb-2 pt-[calc(12px+env(safe-area-inset-top))]';

export function AppHeader({
  title,
  back,
}: {
  /** Null for the home screen's brand header. */
  readonly title: string | null;
  readonly back?: BackTarget;
}): ReactNode {
  return title === null ? (
    <BrandHeader />
  ) : (
    <header className={`${HEADER_CLASS} min-h-[64px]`}>
      {back === undefined ? null : <BackButton target={back} />}
      {/* A long title steps down one size rather than wrapping beside the switch. */}
      <h1
        className={`min-w-0 flex-1 font-bold text-ink ${
          [...title].length > LONG_TITLE ? 'text-title-sm' : 'text-title-md'
        }`}
      >
        {title}
      </h1>
      <LanguageToggle />
    </header>
  );
}

function BrandHeader(): ReactNode {
  const locale = useLocale();
  const scope = useDeployment()?.scope ?? null;

  return (
    <header className={`${HEADER_CLASS} min-h-[84px] justify-between`}>
      <h1 data-testid="app-name" className="flex min-w-0 items-center gap-3">
        {scope === null ? (
          <BrandLogo height={68} />
        ) : (
          // A hospital's own app says whose it is (`FR-PAT-19`): its mark,
          // when it has one, and its name in words.
          <>
            {scope.logoVersion == null ? null : (
              <HospitalMark
                hospitalId={scope.hospitalId}
                logoVersion={scope.logoVersion}
                size="header"
              />
            )}
            <span className="min-w-0 text-title-md font-bold text-brand-700">
              {localName(locale, scope.nameBn, scope.nameEn)}
            </span>
          </>
        )}
      </h1>

      <div className="flex shrink-0 items-center gap-2">
        <LanguageToggle />
        <a
          href="/profile"
          aria-label={tp('navProfile', locale)}
          className="flex size-11 items-center justify-center rounded-pill border border-line-strong bg-surface text-ink-secondary"
        >
          <ProfileIcon size={20} />
        </a>
      </div>
    </header>
  );
}

function BackButton({ target }: { readonly target: BackTarget }): ReactNode {
  const locale = useLocale();
  const className =
    'flex size-11 shrink-0 items-center justify-center rounded-pill border border-line-strong bg-surface text-ink';

  if ('onBack' in target) {
    return (
      <button
        type="button"
        onClick={target.onBack}
        aria-label={tp('back', locale)}
        data-testid={target.testId ?? 'header-back'}
        className={className}
      >
        <BackIcon size={20} />
      </button>
    );
  }

  return (
    <a
      // A link first, so a tap before the page has hydrated still goes
      // somewhere; the script only improves it into "the page I came from".
      href={target.fallback}
      aria-label={tp('back', locale)}
      data-testid="header-back"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        const sameApp = globalThis.document.referrer.startsWith(globalThis.location.origin);
        if (sameApp && globalThis.history.length > 1) {
          event.preventDefault();
          globalThis.history.back();
        }
      }}
      className={className}
    >
      <BackIcon size={20} />
    </a>
  );
}
