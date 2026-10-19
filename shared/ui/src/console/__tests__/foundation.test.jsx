import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSOLE } from '@platform/i18n';

import { setLocale } from '../../locale/store.js';
import {
  ConsoleAction,
  ConsoleConfirmation,
  ConsoleHeader,
  ConsoleHelp,
  ConsoleInput,
  ConsolePanel,
  ConsoleShell,
  ConsoleTheme,
  consoleBrandStyle,
  consoleNavigationFor,
} from '../ConsoleFoundation.jsx';

beforeEach(() => setLocale('bn'));

const topic = {
  id: 'forms',
  title: CONSOLE.foundationHelpTopic,
  steps: [CONSOLE.foundationHelpStepOne, CONSOLE.foundationHelpStepTwo],
};

function Form() {
  const [value, setValue] = useState('');
  return (
    <ConsoleTheme>
      <ConsoleHelp topic={topic} />
      <ConsoleInput
        label={CONSOLE.foundationExampleField.bn}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </ConsoleTheme>
  );
}

describe('opt-in console foundation', () => {
  it('Help keys do not invoke background workspace shortcuts', async () => {
    render(<Form />);
    await userEvent.click(screen.getByRole('button', { name: /সাহায্য/ }));
    const backgroundShortcut = vi.fn();
    window.addEventListener('keydown', backgroundShortcut);
    try {
      await userEvent.keyboard('n');
      expect(backgroundShortcut).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    } finally {
      window.removeEventListener('keydown', backgroundShortcut);
    }
  });
  it('navigation shows only enabled roles and hides restricted-session choices', () => {
    const onSelect = vi.fn();
    const choices = [
      { id: 'queue', label: CONSOLE.navQueue, roles: ['receptionist'], enabled: true, onSelect },
      { id: 'lab', label: CONSOLE.navTests, roles: ['lab'], enabled: false, onSelect },
      {
        id: 'admin',
        label: CONSOLE.navDashboard,
        roles: ['hospital_admin'],
        enabled: true,
        onSelect,
      },
    ];
    expect(consoleNavigationFor(choices, ['receptionist', 'lab']).map((item) => item.id)).toEqual([
      'queue',
    ]);
    expect(consoleNavigationFor(choices, []).length).toBe(0);
    expect(consoleNavigationFor(choices, ['hospital_admin'], true).length).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('Help preserves the mounted form and returns keyboard focus', async () => {
    render(<Form />);
    const user = userEvent.setup();
    const field = screen.getByRole('textbox');
    await user.type(field, 'Draft stays here');
    const help = screen.getByRole('button', { name: /সাহায্য/ });
    await user.click(help);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/ফর্মে কাজ করা/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field).toHaveValue('Draft stays here');
    expect(field).toBe(screen.getByRole('textbox'));
    expect(help).toHaveFocus();
  });

  it('a changed static Help topic keeps its scope; English does not clear input', async () => {
    const { rerender } = render(<Form />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Kept' } });
    setLocale('en');
    await userEvent.click(screen.getByRole('button', { name: /Help/ }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Working with forms/);
    expect(screen.getByText(CONSOLE.foundationHelpStepOne.en)).toHaveAttribute('lang', 'en');
    rerender(<Form />);
    expect(screen.getByRole('textbox', { hidden: true })).toHaveValue('Kept');
  });

  it('confirmation cannot be dismissed accidentally and safe action comes first', async () => {
    const confirmed = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <ConsoleTheme>
          <ConsoleConfirmation
            open={open}
            onOpenChange={setOpen}
            trigger={<button type="button">Open</button>}
            title={CONSOLE.foundationPreviewConfirmTitle}
            description={CONSOLE.foundationPreviewConfirmDescription}
            confirmLabel={CONSOLE.foundationPreviewClear}
            onConfirm={confirmed}
          />
        </ConsoleTheme>
      );
    }
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const back = screen.getByRole('button', { name: /ফিরে যান/ });
    expect(back).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(confirmed).not.toHaveBeenCalled();
    await userEvent.click(back);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('a pending action cannot invoke the callback or submit a form', async () => {
    const action = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <ConsoleTheme>
        <form onSubmit={submit}>
          <ConsoleAction
            label={CONSOLE.foundationPreviewAction}
            loading
            type="submit"
            onClick={action}
          />
        </form>
      </ConsoleTheme>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName(CONSOLE.foundationPreviewAction.bn);
    await userEvent.click(button);
    expect(action).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('brand values are scoped, validated and cannot introduce status colours', () => {
    const colors = {
      'brand-900': '#003d85',
      'brand-700': '#0052b0',
      'brand-600': '#0062cf',
      'brand-300': '#2a7fe0',
      'brand-100': '#e1edfc',
      'brand-border': '#c4dbf6',
      'alert-700': '#0062cf',
    };
    render(
      <ConsoleTheme brand={colors}>
        <span>Inside</span>
      </ConsoleTheme>,
    );
    const root = screen.getByText('Inside').parentElement;
    expect(root.style.getPropertyValue('--brand-600')).toBe('#0062cf');
    expect(root.style.getPropertyValue('--alert-700')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--brand-600')).toBe('');
    expect(consoleBrandStyle({ ...colors, 'brand-600': '#ffffff' })).toEqual({});
  });

  it('keeps identity after a broken logo, and exposes only supplied navigation', async () => {
    const select = vi.fn();
    render(
      <ConsoleTheme>
        <ConsoleShell
          navigation={[{ id: 'only', label: CONSOLE.navQueue, onSelect: select, current: true }]}
          header={<ConsoleHeader identity={CONSOLE.foundationPreview} logo="broken.png" />}
        >
          <ConsolePanel title={CONSOLE.foundationControls}>
            <span>Content</span>
          </ConsolePanel>
        </ConsoleShell>
      </ConsoleTheme>,
    );
    fireEvent.error(document.querySelector('img'));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(CONSOLE.foundationPreview.bn)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pharmacy/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Queue/ }));
    expect(select).toHaveBeenCalledOnce();
    const result = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
});
