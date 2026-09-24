/**
 * The language switch and the store behind it (`GR-06`, `I18N-08`).
 *
 * `I18N-08`: "switching applies instantly without reload". What that means
 * in a test: one press, and every component reading the locale — not just
 * the switch — renders the other language in the same update; the choice
 * survives a reload; and a browser that refuses storage still switches.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageSwitch } from '../LanguageSwitch.js';
import { LocaleDocument } from '../LocaleDocument.js';
import { LOCALE_STORAGE_KEY, setLocale, useLocale } from '../store.js';

import type { ReactNode } from 'react';

/** Two unrelated readers, to prove the switch is not only local state. */
function Heading(): ReactNode {
  const locale = useLocale();
  return <h1>{locale === 'bn' ? 'পরবর্তী রোগী ডাকুন' : 'Call next patient'}</h1>;
}

function Footer(): ReactNode {
  return <p data-testid="footer-locale">{useLocale()}</p>;
}

beforeEach(() => {
  localStorage.clear();
  act(() => {
    setLocale('bn');
  });
});

afterEach(() => {
  localStorage.clear();
});

describe('LanguageSwitch (SEG-A00-LANG, SEG-B00-LANG)', () => {
  it('offers both languages, each named in itself and marked with its own lang', () => {
    render(<LanguageSwitch label="ভাষা" />);

    const group = screen.getByRole('group', { name: 'ভাষা' });
    expect(group).toBeInTheDocument();

    const bangla = screen.getByRole('button', { name: 'বাংলা' });
    const english = screen.getByRole('button', { name: 'English' });
    expect(bangla).toHaveAttribute('lang', 'bn');
    expect(english).toHaveAttribute('lang', 'en');
  });

  it('marks Bangla as chosen until somebody chooses otherwise (FR-LOC-01)', () => {
    render(<LanguageSwitch label="ভাষা" />);

    expect(screen.getByRole('button', { name: 'বাংলা' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches every reader of the locale in one press', async () => {
    render(
      <>
        <LanguageSwitch label="ভাষা" />
        <Heading />
        <Footer />
      </>,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('পরবর্তী রোগী ডাকুন');

    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading')).toHaveTextContent('Call next patient');
    expect(screen.getByTestId('footer-locale')).toHaveTextContent('en');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'বাংলা' }));
    expect(screen.getByRole('heading')).toHaveTextContent('পরবর্তী রোগী ডাকুন');
  });

  it('is reachable and operated by the keyboard (A11Y-05)', async () => {
    render(<LanguageSwitch label="Language" />);

    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'English' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no axe violations', async () => {
    const { container } = render(<LanguageSwitch label="ভাষা" />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('the choice is remembered on this device', () => {
  it('is stored when made', async () => {
    render(<LanguageSwitch label="ভাষা" />);
    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('follows a change made in another tab', () => {
    render(<Footer />);
    expect(screen.getByTestId('footer-locale')).toHaveTextContent('bn');

    // Another tab of the same app writes the key and the browser fires
    // `storage` here — the one event this tab gets about it.
    act(() => {
      localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
      globalThis.dispatchEvent(new StorageEvent('storage', { key: LOCALE_STORAGE_KEY }));
    });

    expect(screen.getByTestId('footer-locale')).toHaveTextContent('en');
  });

  it('ignores another tab writing something that is not a locale', () => {
    render(<Footer />);

    act(() => {
      localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
      globalThis.dispatchEvent(new StorageEvent('storage', { key: LOCALE_STORAGE_KEY }));
    });

    expect(screen.getByTestId('footer-locale')).toHaveTextContent('bn');
  });

  it('still switches when the browser refuses storage', async () => {
    // A private window or a locked-down counter machine. The press must
    // still change the screen; only the remembering is lost.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('refused', 'SecurityError');
    });

    render(
      <>
        <LanguageSwitch label="ভাষা" />
        <Heading />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading')).toHaveTextContent('Call next patient');
  });
});

describe('LocaleDocument', () => {
  it('keeps <html lang> and the tab title in the chosen language', () => {
    render(<LocaleDocument title={{ bn: 'হাসপাতাল কনসোল', en: 'Hospital console' }} />);

    // `tokens.css` keys the Bangla typesetting rules off `lang`, and a screen
    // reader picks its voice from it (TYP-01, TYP-02).
    expect(document.documentElement.lang).toBe('bn');
    expect(document.title).toBe('হাসপাতাল কনসোল');

    act(() => {
      setLocale('en');
    });

    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Hospital console');
  });
});
