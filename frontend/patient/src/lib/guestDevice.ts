'use client';

/**
 * The numbers this device has proved (decision 85, `APP_FLOW.md` A1: the
 * guest's proof is "bound to phone + device", `FR-GST-12`).
 *
 * `POST /guest/verify` hands back a device proof beside the guest token. Kept
 * here, per number, it is what lets the same phone book again without another
 * code; any other device, or anybody else typing the number, is sent one. The
 * server checks the proof against the number and this device, so a copy
 * carried elsewhere opens nothing.
 *
 * Every read and write is wrapped: `localStorage` throws in a private window
 * and with site data blocked, and then the only cost is a code by SMS.
 */

const KEY = 'patient.guestDevice';

type Proofs = Record<string, string>;

function read(): Proofs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw === null || raw === undefined ? {} : (JSON.parse(raw) as Proofs);
  } catch {
    return {};
  }
}

/** The proof this device holds for a number, stored as `+8801…` (`DB-P6`). */
export function deviceProofFor(phone: string): string | null {
  return read()[phone] ?? null;
}

/** Keeps the proof the server just handed back, replacing any older one. */
export function rememberDeviceProof(phone: string, proof: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...read(), [phone]: proof }));
  } catch {
    // Not kept: the next booking from this number asks for a code again.
  }
}
