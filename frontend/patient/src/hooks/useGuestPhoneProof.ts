'use client';

/**
 * Proving the phone before a guest action (`FR-GST-03`, `MOD-GST-OTP`): a
 * booking, a place on a standby list, a bed request — each is followed by
 * money or an SMS thread, and each is refused by the server without it.
 *
 * `begin` asks `POST /guest/start`. When nothing is needed — a demonstration,
 * or the check switched off — it answers at once and the action goes ahead
 * with whatever token came back. When the number must prove itself, the code
 * card opens (`pending`), and `prove` turns the typed code into the guest token
 * the action then carries.
 *
 * One hook for the three forms, so the check is not three copies that drift.
 */

import { useCallback, useState } from 'react';

import { startGuest, verifyGuest } from '@/lib/api';

export type GuestPhoneStart =
  { readonly ready: true; readonly guestToken: string | null } | { readonly ready: false };

export interface GuestPhoneProof {
  /** Open while a code is awaited, with the demonstration's code when there is one. */
  readonly pending: { readonly demoCode: string | null } | null;
  /** The last code typed was wrong. */
  readonly codeWrong: boolean;
  begin: (phone: string, name: string) => Promise<GuestPhoneStart>;
  /** The typed code, for the guest token. Throws the API's error, whose `code` says why. */
  prove: (phone: string, name: string, code: string) => Promise<string>;
}

export function useGuestPhoneProof(): GuestPhoneProof {
  const [pending, setPending] = useState<{ readonly demoCode: string | null } | null>(null);
  const [codeWrong, setCodeWrong] = useState(false);

  const begin = useCallback(async (phone: string, name: string): Promise<GuestPhoneStart> => {
    const start = await startGuest({ phone, name });
    if (start.needsOtp) {
      setPending({ demoCode: start.demoCode ?? null });
      return { ready: false };
    }
    return { ready: true, guestToken: start.guestToken };
  }, []);

  const prove = useCallback(async (phone: string, name: string, code: string): Promise<string> => {
    setCodeWrong(false);
    try {
      const proved = await verifyGuest({ phone, name, code });
      setPending(null);
      return proved.guestToken;
    } catch (error) {
      setCodeWrong((error as { code?: string }).code === 'AUTH_OTP_INVALID');
      throw error;
    }
  }, []);

  return { pending, codeWrong, begin, prove };
}
