/**
 * The push adapter — Web Push (VAPID) for the PWA (BACKEND.md §0).
 *
 * ## Why this reports "skipped" rather than sending
 *
 * Web Push needs three things this version does not have: a VAPID key pair
 * (`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are empty by default and
 * `env.ts` already warns about it), a service worker registered by the patient
 * app, and a `device_tokens` row that a browser subscription produces. The
 * PWA's service worker is `FRONTEND.md` §9's Workbox work and no screen asks
 * for notification permission yet.
 *
 * So there is nowhere to push to, and the honest implementation says so: every
 * attempt records `skipped` with `no_device_token`, which is both true and
 * exactly what a real installation reports for a patient who never installed
 * the app. `FR-NOT-02` — "app users get push + SMS; non-app users get SMS
 * only" — is therefore already correct behaviour rather than a stub: today
 * every patient is a non-app user.
 *
 * The seam is what matters now. When the service worker lands, this file gains
 * a `web-push` call and nothing that decides *whether* to notify changes.
 */

import { logger } from '../config/logger.js';
import { env } from '../env.js';

export interface PushMessage {
  /** Web Push endpoints for this recipient's registered devices. */
  readonly tokens: readonly string[];
  readonly body: string;
  readonly notificationId: string;
  readonly templateKey: string;
  /** Where tapping it should open (`APP_FLOW.md` D2). */
  readonly url: string | null;
}

export type PushResult =
  | { readonly ok: true; readonly providerRef: string; readonly delivered: number }
  | { readonly ok: false; readonly error: string };

export interface PushAdapter {
  readonly name: string;
  send(message: PushMessage): Promise<PushResult>;
}

/** True when this process could sign a Web Push request at all. */
export function pushConfigured(): boolean {
  return env.VAPID_PUBLIC_KEY !== '' && env.VAPID_PRIVATE_KEY !== '';
}

/**
 * Records the intent and reports why nothing went out.
 *
 * Distinguishes the two reasons, because they are different problems: an
 * unconfigured server is an operator's to fix, and a recipient with no
 * registered device is simply somebody who has not installed the app.
 */
export class UnconfiguredPushAdapter implements PushAdapter {
  readonly name = 'unconfigured';

  async send(message: PushMessage): Promise<PushResult> {
    logger.debug(
      {
        notificationId: message.notificationId,
        templateKey: message.templateKey,
        channel: 'push',
        tokens: message.tokens.length,
      },
      'push not dispatched',
    );

    return await Promise.resolve({
      ok: false,
      error: message.tokens.length === 0 ? 'no_device_token' : 'push_not_configured',
    });
  }
}

let current: PushAdapter | null = null;

export function push(): PushAdapter {
  // One implementation today. The branch exists so that the file which gains a
  // real adapter does not also have to change how it is selected.
  current ??= new UnconfiguredPushAdapter();
  return current;
}

export function setPushAdapter(adapter: PushAdapter): void {
  current = adapter;
}

export function resetPushAdapter(): PushAdapter {
  current = null;
  return push();
}
