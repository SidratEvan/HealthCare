'use client';

/**
 * `CARD-A10-<hospitalId>` and `BTN-A10-ONWAY` (`S-A-10b`, `FR-PAT-44`,
 * `FR-PAT-46`).
 *
 * A card says, in this order: can this hospital treat it; how far, and how
 * long (an estimate, and labelled one); how busy the ER is; free beds and the
 * ICU; and how old each of those is — the ranked figures together, the ICU on
 * its own line, because it is shown but not ranked on. A stale card says so in amber with its age
 * — "তথ্য ২৪৮ মিনিট পুরোনো" — because a free burn bed nobody has confirmed for
 * four hours is a different claim from one confirmed four minutes ago
 * (`FR-PAT-45`).
 *
 * ## "I'm on my way" needs nothing
 *
 * `APP_FLOW.md` A1.4: "optionally offers a phone field so the ER can call
 * back; leaving it blank still sends the inbound alert." The sheet offers the
 * phone, an age and a sex, and the send button works with all three empty. The
 * key that makes a retried alert one alert is made when the sheet opens.
 *
 * If it fails, the family is not stopped: they are told the hospital could not
 * be told, and given the directions and the ER's number to call on the way
 * (`BTN-A10-ONWAY` wiring, step 5).
 */

import { useState, type ReactNode } from 'react';

import { normaliseBdMobile, type EmergencyProblem } from '@platform/domain';
import { bedKindName, formatNumber, tp } from '@platform/i18n';
import { Button, Chip, FreshnessLine, Input, Sheet } from '@platform/ui';

import { sendInbound } from '@/lib/api';
import { directionsUrl, rememberAlert } from '@/lib/emergency';

import type { EmergencyResult } from '@/lib/types';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;

export interface EmergencyResultCardProps {
  readonly result: EmergencyResult;
  readonly problem: EmergencyProblem;
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly now: Date;
  /** The first card is the answer; it is drawn as one. */
  readonly lead: boolean;
  /** Offline: the list is the last one seen, and nobody can be told. */
  readonly offline: boolean;
  readonly onSent: (token: string) => void;
}

export function EmergencyResultCard({
  result,
  problem,
  position,
  now,
  lead,
  offline,
  onSent,
}: EmergencyResultCardProps): ReactNode {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const n = (value: number): string => formatNumber(value, NUMERALS);
  const freshness = result.freshness;

  return (
    <article
      data-testid={`result-${result.hospitalId}`}
      data-stale={freshness.stale ? 'true' : 'false'}
      className={
        lead
          ? 'flex flex-col gap-3 rounded-lg border-2 border-alert-600 bg-surface p-5'
          : 'flex flex-col gap-3 rounded-lg border border-line bg-surface p-4'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-reading text-title-md text-ink">{result.nameBn}</h3>
        {result.hasCapability === null ? null : (
          // Two words that must stay one label: a chip broken across lines
          // reads as two claims.
          <span className="shrink-0 whitespace-nowrap">
            <Chip tone={result.hasCapability ? 'positive' : 'neutral'}>
              {result.hasCapability
                ? tp('emergencyCapable', LOCALE)
                : tp('emergencyNotCapable', LOCALE)}
            </Chip>
          </span>
        )}
      </div>

      {result.distanceKm === null ? null : (
        <p className="text-body-md tabular-nums text-ink" data-testid="result-distance">
          {tp('emergencyDistance', LOCALE).replace(
            '{km}',
            formatNumber(result.distanceKm, NUMERALS, { maximumFractionDigits: 1 }),
          )}
          {result.travelMinutes === null
            ? ''
            : ` · ${tp('emergencyTravel', LOCALE).replace('{minutes}', n(result.travelMinutes))}`}
        </p>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-ink-secondary">
        <li data-testid="result-beds">
          {result.freeBeds === null
            ? result.bedKind === null
              ? tp('emergencyNoBeds', LOCALE)
              : tp('emergencyNoKind', LOCALE).replace('{kind}', bedKindName(result.bedKind, LOCALE))
            : result.bedKind === null
              ? tp('emergencyFreeBeds', LOCALE).replace('{free}', n(result.freeBeds))
              : tp('emergencyFreeKind', LOCALE)
                  .replace('{kind}', bedKindName(result.bedKind, LOCALE))
                  .replace('{free}', n(result.freeBeds))}
        </li>
        <li data-testid="result-icu">
          {result.icuTotal === null || result.icuFree === null
            ? tp('cardNoIcu', LOCALE)
            : tp('cardIcu', LOCALE)
                .replace('{free}', n(result.icuFree))
                .replace('{total}', n(result.icuTotal))}
        </li>
        {/* FR-EMG-04: counted from cases, never typed. */}
        <li data-testid="result-load">
          {tp('emergencyLoad', LOCALE).replace('{count}', n(result.erLoad))}
        </li>
      </ul>

      {freshness.stale ? (
        <p
          className="rounded-sm bg-warn-100 px-3 py-1 text-body-sm text-warn-700"
          data-testid="result-stale"
        >
          {freshness.ageMinutes === null
            ? tp('emergencyNeverConfirmed', LOCALE)
            : tp('emergencyStale', LOCALE).replace('{time}', n(freshness.ageMinutes))}
        </p>
      ) : null}
      <FreshnessLine
        asOf={freshness.asOf === null ? null : new Date(freshness.asOf)}
        now={now}
        staleAfterMinutes={result.staleAfterMinutes}
        labels={{
          justNow: tp('updatedJustNow', LOCALE),
          ago: tp('updatedAgo', LOCALE),
          never: tp('updatedNever', LOCALE),
          stale: tp('staleWarning', LOCALE),
        }}
        formatMinutes={(minutes) => `${n(minutes)} ${tp('minutesShort', LOCALE)}`}
      />

      {/*
        The ICU figure is shown but not ranked on, so it carries its own age
        rather than borrowing the card's: every number keeps its own stamp
        (`FR-OFF-03`), and a full ICU nobody has touched says so here without
        de-ranking a burn unit confirmed a minute ago.
      */}
      {result.icuTotal === null ? null : (
        <div className="flex items-baseline gap-2" data-testid="result-icu-freshness">
          <span className="text-caption text-ink-muted">{bedKindName('icu', LOCALE)}</span>
          <FreshnessLine
            asOf={result.icuAsOf === null ? null : new Date(result.icuAsOf)}
            now={now}
            staleAfterMinutes={result.staleAfterMinutes}
            labels={{
              justNow: tp('updatedJustNow', LOCALE),
              ago: tp('updatedAgo', LOCALE),
              never: tp('updatedNever', LOCALE),
              stale: tp('staleWarning', LOCALE),
            }}
            formatMinutes={(minutes) => `${n(minutes)} ${tp('minutesShort', LOCALE)}`}
          />
        </div>
      )}

      {failed ? (
        <p role="alert" className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700">
          {tp('onWayFailed', LOCALE)}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {offline ? null : (
          <Button
            variant={lead ? 'emergency' : 'primary'}
            size={lead ? 'xl' : 'lg'}
            fullWidth
            data-testid={`onway-${result.hospitalId}`}
            onClick={() => {
              setFailed(false);
              setSheetOpen(true);
            }}
          >
            {tp('emergencyOnWay', LOCALE)}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {result.lat === null || result.lng === null ? null : (
            <a
              href={directionsUrl(result.lat, result.lng)}
              target="_blank"
              rel="noreferrer"
              data-testid={`directions-${result.hospitalId}`}
              className="flex min-h-touch items-center justify-center rounded-md border border-line-strong px-3 text-body-md text-ink"
            >
              {tp('emergencyDirections', LOCALE)}
            </a>
          )}
          {result.emergencyPhone === null ? null : (
            <a
              href={`tel:${result.emergencyPhone}`}
              data-testid={`call-${result.hospitalId}`}
              className="flex min-h-touch items-center justify-center rounded-md border border-line-strong px-3 text-body-md text-ink"
            >
              {tp('emergencyCallEr', LOCALE)}
            </a>
          )}
        </div>
      </div>

      <OnWaySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        hospitalId={result.hospitalId}
        hospitalNameBn={result.nameBn}
        problem={problem}
        position={position}
        onSent={(token) => {
          setSheetOpen(false);
          onSent(token);
        }}
        onFailed={() => {
          setSheetOpen(false);
          setFailed(true);
        }}
      />
    </article>
  );
}

// ---------------------------------------------------------------------------
// BTN-A10-ONWAY — nothing required
// ---------------------------------------------------------------------------

function OnWaySheet({
  open,
  onOpenChange,
  hospitalId,
  hospitalNameBn,
  problem,
  position,
  onSent,
  onFailed,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly problem: EmergencyProblem;
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly onSent: (token: string) => void;
  readonly onFailed: () => void;
}): ReactNode {
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | 'other' | null>(null);
  const [sending, setSending] = useState(false);
  const [tried, setTried] = useState(false);
  // One key for this alert, however often it is retried (`FR-PAT-46`).
  const [key] = useState(() => crypto.randomUUID());

  const phoneStored = phone.trim() === '' ? null : normaliseBdMobile(phone);
  const ageYears = age.trim() === '' ? null : /^\d{1,3}$/.test(age.trim()) ? Number(age) : NaN;
  const phoneError = phone.trim() !== '' && phoneStored === null;
  const ageError = ageYears !== null && (Number.isNaN(ageYears) || ageYears > 130);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={tp('onWayTitle', LOCALE).replace('{hospital}', hospitalNameBn)}
      description={tp('onWayOptional', LOCALE)}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        data-testid="onway-form"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (phoneError || ageError) return;
          setSending(true);
          void sendInbound(
            {
              hospitalId,
              problem,
              lat: position?.lat ?? null,
              lng: position?.lng ?? null,
              phone: phoneStored,
              ageYears: ageYears === null || Number.isNaN(ageYears) ? null : ageYears,
              sex,
            },
            key,
          )
            .then((result) => {
              rememberAlert({
                caseId: result.case.id,
                token: result.token,
                hospitalNameBn,
                problem,
                sentAt: new Date().toISOString(),
              });
              onSent(result.token);
            })
            .catch(() => {
              // Whatever went wrong, the family is not left waiting on it:
              // they are told, and given the way there and the number.
              onFailed();
            })
            .finally(() => {
              setSending(false);
            });
        }}
      >
        <Input
          label={tp('onWayPhone', LOCALE)}
          kind="phone"
          value={phone}
          data-testid="onway-phone"
          onChange={(event) => {
            setPhone(event.target.value);
          }}
          {...(tried && phoneError ? { error: tp('mobileInvalid', LOCALE) } : {})}
        />
        <Input
          label={tp('onWayAge', LOCALE)}
          kind="number"
          value={age}
          data-testid="onway-age"
          onChange={(event) => {
            setAge(event.target.value);
          }}
          {...(tried && ageError ? { error: tp('onWayAge', LOCALE) } : {})}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-caption text-ink-muted">{tp('sex', LOCALE)}</legend>
          <div className="grid grid-cols-3 gap-2">
            {(['male', 'female', 'other'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={sex === value ? 'primary' : 'secondary'}
                aria-pressed={sex === value}
                onClick={() => {
                  setSex(sex === value ? null : value);
                }}
              >
                {tp(value, LOCALE)}
              </Button>
            ))}
          </div>
        </fieldset>

        <Button
          type="submit"
          variant="emergency"
          size="xl"
          fullWidth
          loading={sending}
          data-testid="onway-send"
        >
          {sending ? tp('onWayNotifying', LOCALE) : tp('onWaySend', LOCALE)}
        </Button>
      </form>
    </Sheet>
  );
}
