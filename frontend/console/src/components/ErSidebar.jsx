'use client';
import { bedKindName, capabilityName, format, formatNumber, t, numeralsFor } from '@platform/i18n';
import { Button, FreshnessLine } from '@platform/ui';

export function CapabilityPanel({
  capabilities,
  pending,
  locale,
  now,
  staleAfterMinutes,
  freshness,
  minutes,
  onToggle,
  onConfirmAll,
}) {
  return (
    <section
      aria-labelledby="er-capabilities-title"
      data-testid="er-capabilities"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-ui"
    >
      <div>
        <h2 id="er-capabilities-title" className="text-title-sm text-ink">
          {t('erCapabilitiesTitle', locale)}
        </h2>
        <p className="text-caption text-ink-muted">{t('erCapabilitiesHint', locale)}</p>
      </div>

      {capabilities.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">{t('erCapabilitiesNone', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {capabilities.map((row) => (
            <li key={row.kind} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body-md text-ink">{capabilityName(row.kind, locale)}</p>
                <FreshnessLine
                  asOf={new Date(row.updatedAt)}
                  now={now}
                  staleAfterMinutes={staleAfterMinutes}
                  labels={freshness}
                  formatMinutes={minutes}
                />
              </div>
              {/* SW-B07-<capability>: a real switch, said in words as well as position. */}
              <button
                type="button"
                role="switch"
                aria-checked={row.available}
                data-testid={`er-capability-${row.kind}`}
                onClick={() => {
                  onToggle(row.kind, !row.available);
                }}
                className={
                  row.available
                    ? 'min-h-touch shrink-0 rounded-pill bg-brand-600 px-4 text-body-sm font-semibold text-surface'
                    : 'min-h-touch shrink-0 rounded-pill border border-line-strong bg-sunken px-4 text-body-sm text-ink-secondary'
                }
              >
                {row.available ? t('erCapabilityOn', locale) : t('erCapabilityOff', locale)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {capabilities.length === 0 ? null : (
        <Button
          size="sm"
          variant="secondary"
          data-testid="er-capabilities-confirm"
          onClick={onConfirmAll}
        >
          {t('erCapabilitiesConfirm', locale)}
        </Button>
      )}
      {pending ? (
        <p className="text-caption text-ink-muted">{t('bedPendingSync', locale)}</p>
      ) : null}
    </section>
  );
}

export function ErBeds({ published, locale, now, staleAfterMinutes, freshness, minutes }) {
  const numerals = numeralsFor(locale);
  const kinds = published?.byKind ?? [];

  return (
    <section
      aria-labelledby="er-beds-title"
      data-testid="er-beds"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-ui"
    >
      <h2 id="er-beds-title" className="text-title-sm text-ink">
        {t('erBedsTitle', locale)}
      </h2>

      {kinds.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">{t('mirrorEmpty', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {kinds.map((entry) => (
            <li key={entry.kind} data-testid={`er-beds-${entry.kind}`}>
              <div className="flex justify-between gap-3">
                <span className="text-body-md text-ink">{bedKindName(entry.kind, locale)}</span>
                <span className="text-body-md tabular-nums text-ink">
                  {format('mirrorFreeOfTotal', locale, {
                    free: formatNumber(entry.free, numerals),
                    total: formatNumber(entry.total, numerals),
                  })}
                </span>
              </div>
              <FreshnessLine
                asOf={entry.asOf === null ? null : new Date(entry.asOf)}
                now={now}
                staleAfterMinutes={staleAfterMinutes}
                labels={freshness}
                formatMinutes={minutes}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
