'use client';

/**
 * What patients see of this hospital (`S-B-11`, `FR-BRD-06`; plan C1;
 * `APP_FLOW.md` B6 `FRM-B11-DESCRIPTION`, `FRM-B11-LOGO`, `FRM-B11-BRAND`).
 *
 * Three things the hospital chooses for itself, each saved on its own: what
 * it says of itself in both languages, a logo, and a colour.
 *
 * ## One colour, not six
 *
 * The patient app's brand is six tokens. An administrator knows their
 * hospital's colour, not six hex values and what each is for, so the form
 * asks for one and `themeFromColour` makes the rest. A colour that cannot
 * carry white text is darkened only as far as it must be, and the screen says
 * that it was. The preview below is the app's own components drawn with those
 * six values: the wrapper sets the tokens and nothing inside it names a
 * colour, which is exactly how the patient app takes them (`ScopeTheme`).
 *
 * ## The logo before the hospital is live
 *
 * The public address of a logo answers for a hospital in the network only
 * (`FR-NET-03`). A hospital still being set up has to see what it uploaded,
 * so this screen reads it through the administrator's own route.
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';

import {
  BRAND_TOKENS,
  LOGO_FILE_TYPES,
  LOGO_MAX_BYTES,
  themeFromColour,
  type LogoFileType,
} from '@platform/domain';
import { format, formatNumber, numeralsFor, t } from '@platform/i18n';
import { Button, COLOUR, Card, useLocale } from '@platform/ui';

import { loadOwnLogo, settingsApi, type Saved, type SetupSnapshot } from '@/lib/settings';

const DESCRIPTION_MAX = 400;

type Run = <T>(call: () => Promise<Saved<T>>, success: (value: T) => string) => Promise<boolean>;

interface FaceProps {
  readonly snapshot: SetupSnapshot;
  readonly offline: boolean;
  readonly run: Run;
}

export function HospitalFace({ snapshot, offline, run }: FaceProps): ReactNode {
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-4" data-testid="settings-face">
      <div className="flex flex-col gap-1">
        <h2 className="text-title-md">{t('settingsFaceHeading', locale)}</h2>
        <p className="text-body-sm text-ink-secondary">{t('settingsFaceHelper', locale)}</p>
      </div>
      <Description snapshot={snapshot} offline={offline} run={run} />
      <Logo snapshot={snapshot} offline={offline} run={run} />
      <Colours snapshot={snapshot} offline={offline} run={run} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// What it says of itself
// ---------------------------------------------------------------------------

function Description({ snapshot, offline, run }: FaceProps): ReactNode {
  const locale = useLocale();
  const hospital = snapshot.hospital;
  const [bn, setBn] = useState(hospital.descriptionBn ?? '');
  const [en, setEn] = useState(hospital.descriptionEn ?? '');
  const [busy, setBusy] = useState(false);

  const fits = bn.trim().length <= DESCRIPTION_MAX && en.trim().length <= DESCRIPTION_MAX;

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!fits || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.profile({
          descriptionBn: bn.trim() === '' ? null : bn.trim(),
          descriptionEn: en.trim() === '' ? null : en.trim(),
        }),
      () => t('settingsSaved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={save}
        data-testid="settings-description"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextArea
            label={t('settingsDescriptionBn', locale)}
            value={bn}
            onValue={setBn}
            testId="settings-description-bn"
          />
          <TextArea
            label={t('settingsDescriptionEn', locale)}
            value={en}
            onValue={setEn}
            testId="settings-description-en"
          />
        </div>
        <p className="text-caption text-ink-muted">{t('settingsDescriptionHelper', locale)}</p>
        <div>
          <SaveButton
            submit
            offline={offline}
            busy={busy}
            {...(fits ? {} : { blocked: t('settingsDescriptionTooLong', locale) })}
            testId="settings-save-description"
          >
            {t('settingsSaveDescription', locale)}
          </SaveButton>
        </div>
      </form>
    </Card>
  );
}

function TextArea({
  label,
  value,
  onValue,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly testId: string;
}): ReactNode {
  const locale = useLocale();
  const id = useId();
  const numerals = numeralsFor(locale);
  const over = value.trim().length > DESCRIPTION_MAX;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-ui text-body-sm font-semibold text-ink">
        {label}
      </label>
      <textarea
        id={id}
        rows={4}
        value={value}
        data-testid={testId}
        aria-invalid={over}
        onChange={(event) => {
          onValue(event.target.value);
        }}
        className="w-full rounded-md border border-line-strong bg-surface p-3 text-body-md text-ink"
      />
      <p
        className={over ? 'text-caption text-alert-700' : 'text-caption text-ink-muted'}
        data-testid={`${testId}-count`}
      >
        {format('settingsDescriptionCount', locale, {
          used: formatNumber(value.trim().length, numerals),
          max: formatNumber(DESCRIPTION_MAX, numerals),
        })}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Its logo
// ---------------------------------------------------------------------------

type Chosen =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly reason: 'type' | 'size' }
  | {
      readonly kind: 'ready';
      readonly fileType: LogoFileType;
      readonly content: string;
      readonly preview: string;
    };

const isLogoType = (type: string): type is LogoFileType =>
  (LOGO_FILE_TYPES as readonly string[]).includes(type);

function Logo({ snapshot, offline, run }: FaceProps): ReactNode {
  const locale = useLocale();
  const inputId = useId();
  const current = snapshot.face.logo;
  const [shown, setShown] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen>({ kind: 'none' });
  const [busy, setBusy] = useState(false);

  // The logo as the server has it, read again whenever its version changes.
  const version = current?.version ?? null;
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    if (version === null) {
      setShown(null);
      return undefined;
    }
    void loadOwnLogo().then((url) => {
      if (cancelled) {
        if (url !== null) URL.revokeObjectURL(url);
        return;
      }
      made = url;
      setShown(url);
    });
    return () => {
      cancelled = true;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [version]);

  function choose(file: File | undefined): void {
    if (file === undefined) {
      setChosen({ kind: 'none' });
      return;
    }
    if (!isLogoType(file.type)) {
      setChosen({ kind: 'refused', reason: 'type' });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setChosen({ kind: 'refused', reason: 'size' });
      return;
    }
    const fileType = file.type;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const comma = dataUrl.indexOf(',');
      if (comma < 0) {
        setChosen({ kind: 'refused', reason: 'type' });
        return;
      }
      setChosen({ kind: 'ready', fileType, content: dataUrl.slice(comma + 1), preview: dataUrl });
    });
    reader.readAsDataURL(file);
  }

  function upload(): void {
    if (chosen.kind !== 'ready' || busy || offline) return;
    setBusy(true);
    void run(
      () => settingsApi.logo({ fileType: chosen.fileType, content: chosen.content }),
      () => t('settingsLogoSaved', locale),
    )
      .then((saved) => {
        if (saved) setChosen({ kind: 'none' });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function remove(): void {
    if (busy || offline) return;
    setBusy(true);
    void run(
      () => settingsApi.removeLogo(),
      () => t('settingsLogoRemoved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  const preview = chosen.kind === 'ready' ? chosen.preview : shown;

  return (
    <Card data-testid="settings-logo">
      <div className="flex flex-col gap-4">
        <h3 className="font-ui text-body-md font-semibold text-ink">
          {t('settingsLogoHeading', locale)}
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="flex size-24 items-center justify-center overflow-hidden rounded-md border border-line bg-sunken"
            data-testid="settings-logo-preview"
            data-has-logo={preview === null ? 'false' : 'true'}
          >
            {preview === null ? (
              <span className="px-2 text-center text-caption text-ink-muted">
                {t('settingsLogoNone', locale)}
              </span>
            ) : (
              // A data or blob address made on this device, never a remote one:
              // there is nothing for an image optimiser to fetch.
              <img
                src={preview}
                alt={t('settingsLogoAlt', locale)}
                className="size-full object-contain"
              />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label htmlFor={inputId} className="font-ui text-body-sm font-semibold text-ink">
              {t('settingsLogoChoose', locale)}
            </label>
            <input
              id={inputId}
              type="file"
              accept={LOGO_FILE_TYPES.join(',')}
              data-testid="settings-logo-file"
              className="text-body-sm text-ink file:mr-3 file:min-h-touch file:rounded-sm file:border file:border-line-strong file:bg-surface file:px-3 file:text-body-sm file:text-ink"
              onChange={(event) => {
                choose(event.target.files?.[0]);
              }}
            />
            <p className="text-caption text-ink-muted">{t('settingsLogoHelper', locale)}</p>
            {chosen.kind === 'refused' ? (
              <p
                role="alert"
                className="text-body-sm text-alert-700"
                data-testid="settings-logo-refused"
              >
                {t(
                  chosen.reason === 'size' ? 'settingsLogoTooLarge' : 'settingsLogoWrongType',
                  locale,
                )}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveButton
            offline={offline}
            busy={busy}
            {...(chosen.kind === 'ready' ? {} : { blocked: t('settingsLogoChooseFirst', locale) })}
            testId="settings-logo-save"
            onClick={upload}
          >
            {t('settingsLogoSave', locale)}
          </SaveButton>
          {current === null ? null : (
            <SaveButton
              variant="secondary"
              offline={offline}
              busy={busy}
              testId="settings-logo-remove"
              onClick={remove}
            >
              {t('settingsLogoRemove', locale)}
            </SaveButton>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Its colours
// ---------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/;

function Colours({ snapshot, offline, run }: FaceProps): ReactNode {
  const locale = useLocale();
  const inputId = useId();
  const saved = snapshot.face.theme;
  // With no colours of its own a hospital is in the platform's, which is
  // where the picker starts.
  const [colour, setColour] = useState<string>(
    (saved?.colors['brand-600'] ?? COLOUR['brand-600']).toLowerCase(),
  );
  const [busy, setBusy] = useState(false);

  const theme = useMemo(() => (HEX.test(colour) ? themeFromColour(colour) : null), [colour]);
  const darkened = theme !== null && theme.colors['brand-600'] !== colour.toLowerCase();
  const unchanged =
    theme !== null &&
    saved !== null &&
    BRAND_TOKENS.every((token) => saved.colors[token] === theme.colors[token]);

  // The app's own tokens, re-scoped to this box: what is inside names no
  // colour, so it looks as the patient app will.
  const scoped = useMemo<CSSProperties>(() => {
    const style: Record<string, string> = {};
    if (theme !== null) {
      for (const token of BRAND_TOKENS) style[`--${token}`] = theme.colors[token];
    }
    return style;
  }, [theme]);

  function save(): void {
    if (theme === null || busy || offline) return;
    setBusy(true);
    void run(
      () => settingsApi.brand(theme),
      () => t('settingsBrandSaved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  function reset(): void {
    if (busy || offline) return;
    setBusy(true);
    void run(
      () => settingsApi.brand(null),
      () => t('settingsBrandCleared', locale),
    )
      .then((done) => {
        if (done) setColour(COLOUR['brand-600'].toLowerCase());
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <Card data-testid="settings-brand">
      <div className="flex flex-col gap-4">
        <h3 className="font-ui text-body-md font-semibold text-ink">
          {t('settingsBrandHeading', locale)}
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="font-ui text-body-sm font-semibold text-ink">
              {t('settingsBrandColour', locale)}
            </label>
            <input
              id={inputId}
              type="color"
              value={HEX.test(colour) ? colour : COLOUR['brand-600'].toLowerCase()}
              data-testid="settings-brand-colour"
              className="h-12 w-24 cursor-pointer rounded-sm border border-line-strong bg-surface p-1"
              onChange={(event) => {
                setColour(event.target.value.toLowerCase());
              }}
            />
          </div>
          <p className="max-w-prose flex-1 text-body-sm text-ink-secondary">
            {t(saved === null ? 'settingsBrandIsPlatform' : 'settingsBrandIsOwn', locale)}
          </p>
        </div>

        <div
          style={scoped}
          className="flex flex-col gap-3 rounded-md border border-brand-border bg-canvas p-4"
          data-testid="settings-brand-preview"
          data-main={theme?.colors['brand-600'] ?? ''}
        >
          <p className="text-caption text-ink-muted">{t('settingsBrandPreview', locale)}</p>
          <p className="text-title-md text-brand-700">{snapshot.hospital.nameBn}</p>
          <p className="rounded-sm bg-brand-100 px-3 py-2 text-body-sm text-brand-600">
            {t('settingsBrandPreviewStrip', locale)}
          </p>
          <div>
            <span className="inline-flex min-h-touch items-center rounded-md bg-brand-600 px-4 font-ui text-body-md font-semibold text-ink-inverse">
              {t('settingsBrandPreviewButton', locale)}
            </span>
          </div>
        </div>

        {darkened ? (
          <p className="text-body-sm text-ink-secondary" data-testid="settings-brand-darkened">
            {t('settingsBrandDarkened', locale)}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <SaveButton
            offline={offline}
            busy={busy}
            {...(unchanged ? { blocked: t('settingsBrandUnchanged', locale) } : {})}
            testId="settings-brand-save"
            onClick={save}
          >
            {t('settingsBrandSave', locale)}
          </SaveButton>
          {saved === null ? null : (
            <SaveButton
              variant="secondary"
              offline={offline}
              busy={busy}
              testId="settings-brand-reset"
              onClick={reset}
            >
              {t('settingsBrandReset', locale)}
            </SaveButton>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// A save that says why it cannot be pressed (`FRONTEND.md` §5.1)
// ---------------------------------------------------------------------------

function SaveButton({
  children,
  offline,
  busy,
  blocked,
  submit = false,
  variant = 'primary',
  testId,
  onClick,
}: {
  readonly children: ReactNode;
  readonly offline: boolean;
  readonly busy: boolean;
  /** Why it cannot be pressed yet, when it is not the connection. */
  readonly blocked?: string;
  readonly submit?: boolean;
  readonly variant?: 'primary' | 'secondary';
  readonly testId: string;
  readonly onClick?: () => void;
}): ReactNode {
  const locale = useLocale();
  const reason = offline ? t('settingsSaveOffline', locale) : (blocked ?? null);
  const common = {
    variant,
    type: submit ? ('submit' as const) : ('button' as const),
    'data-testid': testId,
  };
  if (reason !== null) {
    return (
      <Button {...common} disabled disabledReason={reason}>
        {children}
      </Button>
    );
  }
  return (
    <Button {...common} loading={busy} {...(onClick === undefined ? {} : { onClick })}>
      {children}
    </Button>
  );
}
