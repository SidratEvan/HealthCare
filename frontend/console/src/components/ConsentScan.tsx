'use client';

/**
 * `BTN-B05-SCAN` — opening a patient's earlier records with their consent
 * (`FR-PAT-63`, `FR-SEC-03`, `APP_FLOW.md` B2).
 *
 * The case it exists for: a patient in this chamber who was seen somewhere
 * else. `FR-DOC-10` refuses a hospital the records of a patient it has never
 * treated, and the patient is the only one who can change that — by showing
 * the code from their wallet.
 *
 * A pasted code rather than a camera, for the reason `consent.service` gives:
 * a QR encoder and a scanner are dependencies nobody has agreed to yet, and the
 * capability is the same string either way.
 *
 * ## It clears when the patient changes
 *
 * Keyed on the booking in the chamber by the caller. A history left on screen
 * after the next patient is called would be read as *that* patient's — a wrong
 * allergy history is worse than none — so a new person in the chamber always
 * starts from an empty card.
 */

import { useCallback, useState } from 'react';

import { format, formatDateTime, t, numeralsFor } from '@platform/i18n';
import { Button, Card, Input, useLocale } from '@platform/ui';

import { Absent, PastVisits } from '@/components/PatientPanel';
import { readDemoSession } from '@/lib/demo';
import {
  RequestFailed,
  fetchRecords,
  redeemConsent,
  type PatientRecords,
  type RedeemedConsent,
} from '@/lib/visits';

import type { ReactNode } from 'react';

type State =
  | { readonly kind: 'entering'; readonly problem: 'invalid' | 'failed' | null }
  | { readonly kind: 'opening' }
  | {
      readonly kind: 'open';
      readonly consent: RedeemedConsent;
      /** Null when the grant was made but the read failed: the grant stands. */
      readonly records: PatientRecords | null;
    };

export function ConsentScan(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [code, setCode] = useState('');
  const [state, setState] = useState<State>({ kind: 'entering', problem: null });

  const apiBaseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

  const open = useCallback(async () => {
    setState({ kind: 'opening' });
    const token = readDemoSession()?.token ?? null;

    let consent: RedeemedConsent;
    try {
      consent = await redeemConsent({ apiBaseUrl, token, code });
    } catch (error) {
      setState({
        kind: 'entering',
        problem:
          error instanceof RequestFailed && error.code === 'CONSENT_CODE_INVALID'
            ? 'invalid'
            : 'failed',
      });
      return;
    }

    // The code is spent in the sense that matters — the grant exists — so it
    // leaves the field whatever the read below does.
    setCode('');

    try {
      const records = await fetchRecords({ apiBaseUrl, token, patientId: consent.patientId });
      setState({ kind: 'open', consent, records });
    } catch {
      setState({ kind: 'open', consent, records: null });
    }
  }, [apiBaseUrl, code]);

  if (state.kind === 'open') {
    return (
      <Card>
        <div className="flex flex-col gap-4" data-testid="consented-records">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-body-md font-semibold" data-testid="consent-granted">
              {format('consentGranted', locale, {
                name: state.consent.patientName,
                time: formatDateTime(state.consent.expiresAt, numerals),
              })}
            </p>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setState({ kind: 'entering', problem: null });
              }}
            >
              {t('closeRecords', locale)}
            </Button>
          </div>

          {state.records === null ? (
            <p role="status" className="text-body-sm text-alert-700">
              {t('loadFailed', locale)}
            </p>
          ) : (
            <>
              <PastVisits records={state.records} />
              <Absent records={state.records} />
            </>
          )}
        </div>
      </Card>
    );
  }

  const ready = code.trim().length > 0;

  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        data-testid="consent-scan"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void open();
        }}
      >
        <h2 className="text-title-sm">{t('scanTitle', locale)}</h2>

        <Input
          label={t('consentCode', locale)}
          helper={t('scanHint', locale)}
          density="console"
          autoComplete="off"
          spellCheck={false}
          data-testid="consent-code-input"
          value={code}
          {...(state.kind === 'entering' && state.problem === 'invalid'
            ? { error: t('codeInvalid', locale) }
            : {})}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />

        {state.kind === 'entering' && state.problem === 'failed' ? (
          <p role="alert" className="text-body-sm text-alert-700">
            {t('loadFailed', locale)}
          </p>
        ) : null}

        <div>
          {ready ? (
            <Button
              type="submit"
              variant="secondary"
              loading={state.kind === 'opening'}
              data-testid="open-consented-records"
            >
              {t('openRecords', locale)}
            </Button>
          ) : (
            <Button variant="secondary" disabled disabledReason={t('needCode', locale)}>
              {t('openRecords', locale)}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
