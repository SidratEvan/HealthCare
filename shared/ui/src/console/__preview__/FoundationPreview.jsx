'use client';

/** Local component review only (FR-DEM-07). Not exported or mounted in apps.
 * No patients, auth tokens, API, routing, clinical forms or persistent records.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CONSOLE, t } from '@platform/i18n';

import { Button } from '../../components/Button.jsx';
import { Card } from '../../components/Card.jsx';
import { Input } from '../../components/Input.jsx';
import { LocaleDocument } from '../../locale/LocaleDocument.jsx';
import { useLocale } from '../../locale/store.js';
import {
  ConsoleAction,
  ConsoleConfirmation,
  ConsoleFeedback,
  ConsoleHeader,
  ConsoleHelp,
  ConsoleInput,
  ConsolePageHeader,
  ConsolePanel,
  ConsoleShell,
  ConsoleState,
  ConsoleStatus,
  ConsoleTheme,
  BilingualLabel,
} from '../ConsoleFoundation.jsx';

// Valid permitted ramps; synthetic review uses the seed's Shapla identity.
const BLUE = {
  'brand-900': '#003d85',
  'brand-700': '#0052b0',
  'brand-600': '#0062cf',
  'brand-300': '#2a7fe0',
  'brand-100': '#e1edfc',
  'brand-border': '#c4dbf6',
};
const GREEN = {
  'brand-900': '#06291f',
  'brand-700': '#08402f',
  'brand-600': '#0c5c46',
  'brand-300': '#7fd6a8',
  'brand-100': '#e8f0ec',
  'brand-border': '#c9ddd3',
};
const IDENTITY = { bn: 'শাপলা জেনারেল হাসপাতাল (ডেমো)', en: 'Shapla General Hospital (Demo)' };
const topic = {
  id: 'form-basics',
  title: CONSOLE.foundationHelpTopic,
  steps: [
    CONSOLE.foundationHelpStepOne,
    CONSOLE.foundationHelpStepTwo,
    CONSOLE.foundationHelpStepThree,
  ],
};

function Preview() {
  const locale = useLocale();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const brand =
    new URLSearchParams(globalThis.location.search).get('brand') === 'green' ? GREEN : BLUE;
  if (new URLSearchParams(globalThis.location.search).get('legacy') === '1') {
    return (
      <>
        <Card>
          <h1>{t('foundationControls', locale)}</h1>
          <Input label={t('foundationExampleField', locale)} />
          <Button>{t('foundationPreviewAction', locale)}</Button>
        </Card>
      </>
    );
  }
  const tones = ['positive', 'information', 'caution', 'alert', 'neutral'];
  const labels = {
    positive: CONSOLE.foundationPreviewReady,
    information: CONSOLE.foundationPreviewInformation,
    caution: CONSOLE.foundationPreviewCaution,
    alert: CONSOLE.foundationPreviewAlert,
    neutral: CONSOLE.foundationPreviewNeutral,
  };
  return (
    <>
      <LocaleDocument title={CONSOLE.foundationPreview} />
      <ConsoleTheme brand={brand}>
        <ConsoleShell
          navigation={[
            {
              id: 'review',
              label: CONSOLE.foundationControls,
              current: true,
              onSelect: () => document.getElementById('review-field')?.focus(),
            },
            {
              id: 'feedback',
              label: CONSOLE.foundationFeedback,
              onSelect: () => document.getElementById('feedback-panel')?.scrollIntoView(),
            },
          ]}
          header={
            <ConsoleHeader
              identity={IDENTITY}
              logo="/logo.png"
              workspace={CONSOLE.foundationPreview}
              actions={<ConsoleHelp topic={topic} />}
            />
          }
        >
          <ConsolePageHeader
            title={CONSOLE.foundationPreview}
            description={CONSOLE.foundationPreviewNote}
          />
          <div className="cf-grid">
            <ConsolePanel
              title={CONSOLE.foundationControls}
              description={CONSOLE.foundationFieldHelp}
            >
              <div id="review-field" tabIndex={-1}>
                <ConsoleInput
                  label={t('foundationExampleField', locale)}
                  helper={t('foundationFieldHelp', locale)}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </div>
              <div className="cf-row">
                <ConsoleAction
                  label={CONSOLE.foundationPreviewAction}
                  onClick={() => setFeedback(true)}
                />
                <ConsoleAction
                  label={CONSOLE.foundationPreviewBlocked}
                  disabled
                  disabledReason={t('foundationPreviewBlockedReason', locale)}
                />
              </div>
              <div className="cf-row">
                <ConsoleAction
                  label={CONSOLE.foundationPreviewAction}
                  loading
                  variant="secondary"
                />
                <ConsoleConfirmation
                  open={open}
                  onOpenChange={setOpen}
                  title={CONSOLE.foundationPreviewConfirmTitle}
                  description={CONSOLE.foundationPreviewConfirmDescription}
                  confirmLabel={CONSOLE.foundationPreviewClear}
                  onConfirm={() => {
                    setValue('');
                    setOpen(false);
                  }}
                  trigger={
                    <button className="cf-help-button" type="button">
                      <BilingualLabel label={CONSOLE.foundationPreviewConfirm} />
                    </button>
                  }
                />
              </div>
              {feedback ? (
                <ConsoleFeedback
                  tone="positive"
                  title={CONSOLE.foundationPreviewSuccess}
                  description={CONSOLE.foundationPreviewNote}
                />
              ) : null}
              <ConsoleInput
                label={t('foundationExampleField', locale)}
                error={t('foundationPreviewError', locale)}
              />
            </ConsolePanel>
            <div id="feedback-panel" className="cf-stack">
              <ConsolePanel title={CONSOLE.foundationFeedback}>
                <div className="cf-row">
                  {tones.map((tone) => (
                    <ConsoleStatus key={tone} tone={tone} label={labels[tone]} />
                  ))}
                </div>
                <ConsoleFeedback
                  tone="alert"
                  title={CONSOLE.foundationPreviewError}
                  description={CONSOLE.foundationPreviewNote}
                />
              </ConsolePanel>
              <ConsoleState kind="offline" description={CONSOLE.foundationPreviewNote} />
              <ConsoleState kind="loading" description={CONSOLE.foundationPreviewNote} />
              <ConsoleState kind="empty" description={CONSOLE.foundationPreviewNote} />
            </div>
          </div>
        </ConsoleShell>
      </ConsoleTheme>
    </>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Preview root missing');
createRoot(root).render(<Preview />);
