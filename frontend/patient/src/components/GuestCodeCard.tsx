'use client';

/**
 * `MOD-GST-OTP` inline: the six boxes for the code just sent to the phone
 * (`FR-GST-03`), and on a demonstration the code itself, labelled as such.
 * Shown by every form that proves a phone first — `useGuestPhoneProof` says
 * when.
 */

import { formatPatient, tp } from '@platform/i18n';
import { Card, OtpInput, useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

export function GuestCodeCard({
  phone,
  demoCode,
  invalid,
  disabled,
  onComplete,
}: {
  /** As the person typed it, so the sentence names the number they know. */
  readonly phone: string;
  readonly demoCode: string | null;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly onComplete: (code: string) => void;
}): ReactNode {
  const locale = useLocale();

  return (
    <Card data-testid="guest-otp">
      <p className="text-body-md">{formatPatient('accountCodeSent', locale, { phone })}</p>
      <div className="mt-3">
        <OtpInput
          label={tp('accountCode', locale)}
          invalid={invalid}
          disabled={disabled}
          onComplete={onComplete}
        />
      </div>
      {demoCode === null ? null : (
        <p
          className="mt-3 rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
          data-testid="guest-demo-code"
        >
          {formatPatient('accountDemoCode', locale, { code: demoCode })}
        </p>
      )}
    </Card>
  );
}
