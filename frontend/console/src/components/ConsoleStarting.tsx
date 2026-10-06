/**
 * What the console shows while it asks whether this is a demonstration
 * (`GET /demo/status`, pilot step 21), before it can choose between the picker
 * (`S-B-01`) and sign-in (`S-B-00`).
 *
 * The same honesty as the picker's cold start: the shape of the screen while
 * the question is out, a line saying the server is waking once an attempt has
 * missed, and — if it never answers — a failure with a way to try again. Never
 * the sign-in screen by default: a demo whose API is asleep does not need a
 * password, and guessing "not a demo" put one in front of it.
 */

'use client';

import { t } from '@platform/i18n';
import { Button, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';

import type { ReactNode } from 'react';

export function ConsoleStarting({
  waking,
  failed,
  onRetry,
}: {
  readonly waking: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}): ReactNode {
  const locale = useLocale();

  return (
    <div className="min-h-screen">
      <header className="bg-brand-700 text-ink-inverse">
        <div className="mx-auto flex max-w-[1040px] items-center gap-4 px-8 py-8">
          <h1 className="font-reading text-title-lg">{t('consoleTitle', locale)}</h1>
          <ConsoleLanguageSwitch />
        </div>
      </header>

      <main
        className="mx-auto flex max-w-[1040px] flex-col gap-6 p-8"
        data-testid="console-starting"
      >
        {failed ? (
          <>
            <p
              role="alert"
              data-testid="console-starting-failed"
              className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700"
            >
              {t('consoleLoadFailed', locale)}
            </p>
            <div>
              <Button variant="secondary" onClick={onRetry} data-testid="console-starting-retry">
                {t('retry', locale)}
              </Button>
            </div>
          </>
        ) : (
          <>
            {waking ? (
              <p
                role="status"
                data-testid="console-starting-waking"
                className="rounded-sm bg-warn-100 px-3 py-2 text-body-md text-warn-700"
              >
                {t('consoleWaking', locale)}
              </p>
            ) : null}
            <div className="flex flex-col gap-3" aria-busy="true">
              <div className="h-20 rounded-md bg-sunken" />
              <div className="h-20 rounded-md bg-sunken" />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
