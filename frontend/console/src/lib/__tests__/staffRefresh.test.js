import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readDemoSession, writeDemoSession } from '../demo.js';
import { refreshStaffSession } from '../staffAuth.js';

/** A JWT-shaped string whose payload names `sub`; the signature is never checked here. */
function tokenFor(sub, marker) {
  const payload = Buffer.from(JSON.stringify({ sub, marker })).toString('base64url');
  return `header.${payload}.signature`;
}

const STAFF = '01900000-0000-7000-8000-000000000001';
const HOSPITAL = '01900000-0000-7000-8000-000000000002';

function renewed() {
  return {
    access: tokenFor(STAFF, 'renewed'),
    accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    refresh: 'session-2.secret',
    staff: { id: STAFF, fullName: 'Dr Demo (Demo)', email: 'doctor@shapla.demo.invalid' },
    hospital: { id: HOSPITAL, code: 'SHAPLA', nameBn: 'শাপলা (ডেমো)', nameEn: 'Shapla (Demo)' },
    roles: ['doctor'],
    mustChangePassword: false,
    twoFactor: { enabled: false, required: false, recoveryCodesLeft: 0 },
  };
}

describe('the staff session is renewed once at a time (FR-DOC-08, FR-SEC-06)', () => {
  beforeEach(() => {
    const store = new Map();
    vi.stubGlobal('sessionStorage', {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    });
    writeDemoSession({
      token: tokenFor(STAFF, 'first'),
      hospitalId: HOSPITAL,
      staffId: STAFF,
      staffName: 'Dr Demo (Demo)',
      role: 'doctor',
      roles: ['doctor'],
      authKind: 'staff',
      refresh: 'session-1.secret',
      accessExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('two callers on one focus event spend the refresh token once and share the answer', async () => {
    let answer = () => undefined;
    const fetchMock = vi.fn(
      async () =>
        await new Promise((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // The background renewal and the workspace check, as a focus event starts both.
    const background = refreshStaffSession();
    const workspace = refreshStaffSession();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer(new Response(JSON.stringify({ ok: true, data: renewed() }), { status: 200 }));
    expect(await background).toBe(true);
    expect(await workspace).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stored = readDemoSession();
    expect(stored?.refresh).toBe('session-2.secret');
    // The chosen workspace survives renewal: the doctor stays on the doctor's screen.
    expect(stored?.role).toBe('doctor');
  });

  it('a renewal after the first has finished is a new request', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, data: renewed() }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await refreshStaffSession()).toBe(true);
    expect(await refreshStaffSession()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
