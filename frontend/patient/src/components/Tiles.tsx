/**
 * The home screen's tiles (FRONTEND.md §0.5, `APP_FLOW.md` S-A-02).
 *
 * Two sizes, because the home screen has two ranks of thing: three main
 * actions a person came for, and three services beneath them. Each tile is one
 * link with its words inside it (`ICO-03`), and the whole tile is the target.
 */

import type { ReactNode } from 'react';

/**
 * A main action. `alert` is the emergency tile: the only red on the screen
 * (§6.3 as amended), so red keeps its meaning.
 *
 * `helper` is the English name under the Bangla one while the app is in
 * Bangla, as on the approved board; it is not shown in English, where it
 * would only repeat the label.
 */
export function MainTile({
  href,
  icon,
  label,
  helper,
  tone = 'brand',
  testId,
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly helper: string | null;
  readonly tone?: 'brand' | 'alert';
  readonly testId: string;
}): ReactNode {
  const alert = tone === 'alert';
  return (
    <a
      href={href}
      data-testid={testId}
      className={`flex min-h-[144px] flex-col rounded-md border p-3 shadow-1 transition-transform duration-instant ease-standard active:scale-[0.985] ${
        alert ? 'border-alert-100 bg-alert-100' : 'border-line bg-surface'
      }`}
    >
      <span
        className={`flex size-[50px] items-center justify-center rounded-pill ${
          alert ? 'bg-alert-600 text-white' : 'bg-brand-100 text-brand-600'
        }`}
      >
        {icon}
      </span>
      <span
        className={`mt-auto pt-3 text-body-md leading-[1.4] font-bold ${
          alert ? 'text-alert-700' : 'text-ink'
        }`}
      >
        {label}
      </span>
      {helper === null ? null : (
        <span lang="en" className={`text-caption ${alert ? 'text-alert-700' : 'text-ink-muted'}`}>
          {helper}
        </span>
      )}
    </a>
  );
}

/** A service: smaller, quieter, an icon over its name. */
export function ServiceTile({
  href,
  icon,
  label,
  testId,
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly testId: string;
}): ReactNode {
  return (
    <a
      href={href}
      data-testid={testId}
      className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 py-3 text-center"
    >
      <span className="text-brand-600">{icon}</span>
      <span className="text-body-sm leading-[1.35] font-semibold text-ink">{label}</span>
    </a>
  );
}
