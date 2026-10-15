/**
 * One renewal at a time, onto the sign-in it renewed (`FR-SEC-06`;
 * pilot-readiness audit of 12 October 2026, finding F-17).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readDemoSession, writeDemoSession, type DemoSession } from './demo';
import { refreshStaffSession } from './staffAuth';

const SIGNED_IN: DemoSession = {
  token: 'access-0',
  hospitalId: 'hospital-1',
  staffName: 'ডাক্তার (ডেমো)',
  role: 'doctor',
  roles: ['doctor'],
  authKind: 'staff',
  refresh: 'refresh-0',
  accessExpiresAt: new Date(Date.now() - 1_000).toISOString(),
  chamberSessionId: 'chamber-1',
};

function renewed(access: string, refresh: string): Response {
  return new Response(
    JSON.stringify({
      data: {
        access,
        accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        refresh,
        staff: { id: 'staff-1', fullName: 'ডাক্তার (ডেমো)', email: 'd@demo.invalid' },
        hospital: { id: 'hospital-1', code: 'SHAPLA', nameBn: 'শাপলা', nameEn: 'Shapla' },
        roles: ['doctor'],
        mustChangePassword: false,
        twoFactor: { enabled: false, required: false, recoveryCodesLeft: 0 },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  writeDemoSession(SIGNED_IN);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renewing a staff session (F-17)', () => {
  it('sends one renewal when the timer and the access check both ask at once', async () => {
    let answer!: (response: Response) => void;
    const fetch = vi.fn(
      async () =>
        await new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);

    const first = refreshStaffSession();
    const second = refreshStaffSession();
    answer(renewed('access-1', 'refresh-1'));

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readDemoSession()?.refresh).toBe('refresh-1');
  });

  it('keeps what was chosen while the renewal was out', async () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    const pending = refreshStaffSession();
    writeDemoSession({ ...SIGNED_IN, chamberSessionId: 'chamber-2', workspaceView: null });
    answer(renewed('access-1', 'refresh-1'));
    await pending;

    expect(readDemoSession()?.token).toBe('access-1');
    expect(readDemoSession()?.chamberSessionId).toBe('chamber-2');
  });

  it('does not write a renewal over somebody who signed in meanwhile', async () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    const pending = refreshStaffSession();
    writeDemoSession({ ...SIGNED_IN, token: 'other-access', refresh: 'other-refresh' });
    answer(renewed('access-1', 'refresh-1'));
    await pending;

    expect(readDemoSession()?.token).toBe('other-access');
    expect(readDemoSession()?.refresh).toBe('other-refresh');
  });
});
