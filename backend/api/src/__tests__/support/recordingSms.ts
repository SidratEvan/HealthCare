/**
 * An SMS provider that keeps what it was asked to send, for tests.
 *
 * The log provider used to do this itself, in an array nothing ever cleared
 * (`docs/HANDOVER.md` §12 item 11). A process that runs for months must not
 * hold every message it has sent; a test that wants to read them does, for as
 * long as the test lasts.
 */

import type { SmsAdapter, SmsMessage, SmsResult } from '../../adapters/sms.js';

export class RecordingSmsAdapter implements SmsAdapter {
  readonly name = 'recording';

  private readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<SmsResult> {
    this.sent.push(message);
    return await Promise.resolve({
      ok: true,
      providerRef: `recording:${message.notificationId}`,
      costPoisha: 0,
    });
  }

  /** Everything this adapter was asked to send, oldest first. */
  all(): readonly SmsMessage[] {
    return this.sent;
  }
}
