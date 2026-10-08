/**
 * The bKash and Nagad adapters against stand-in servers (plan H3; BACKEND.md
 * §8, *Payments by being sent away and coming back*).
 *
 * **What this proves, and what it does not.** Each stand-in speaks what the
 * provider publishes — bKash's tokenized checkout (grant, create, execute,
 * status, refund) and Nagad's checkout (initialize and complete with
 * RSA-encrypted, signed sensitive data, then verify) — and checks what it is
 * sent the way the provider says it does. Passing here means the adapters say
 * what the published interfaces ask for and read what they answer. It does
 * not mean either provider accepts it: neither has been run against its own
 * sandbox (`docs/PLATFORM_PLAN.md` X2; `DEPLOY.md`, *bKash and Nagad*).
 */

import {
  constants,
  createVerify,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  createSign,
} from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BkashProvider, bkashAmount } from '../adapters/payments/bkash.js';
import { NagadProvider, nagadDateTime, nagadOrderId } from '../adapters/payments/nagad.js';
import { env } from '../env.js';

const mutable = env as unknown as Record<string, string>;
const saved: Record<string, string | undefined> = {};

function set(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    saved[key] ??= mutable[key];
    mutable[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) mutable[key] = value ?? '';
});

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

// ---------------------------------------------------------------------------
// bKash
// ---------------------------------------------------------------------------

describe('bKash tokenized checkout, against a stand-in', () => {
  let server: Server;
  let base: string;
  const grants: number[] = [];
  const payments = new Map<string, { amount: string; status: string; executed: boolean }>();
  let nextStatus = 'Completed';

  beforeAll(async () => {
    server = createServer((req, res) => {
      void (async () => {
        const sent = await body(req);
        const reply = (value: unknown): void => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(value));
        };
        const url = req.url ?? '';

        if (url.endsWith('/token/grant') || url.endsWith('/token/refresh')) {
          if (req.headers['username'] !== 'demo-user' || req.headers['password'] !== 'demo-pass') {
            return reply({ statusCode: '2001', statusMessage: 'Invalid username/password' });
          }
          grants.push(Date.now());
          return reply({ id_token: 'ID-TOKEN', refresh_token: 'REFRESH', expires_in: 3600 });
        }

        // Every other call carries the token and the app key.
        if (req.headers.authorization !== 'ID-TOKEN' || req.headers['x-app-key'] !== 'APPKEY') {
          return reply({ statusCode: '2079', statusMessage: 'Invalid app token' });
        }

        if (url.endsWith('/checkout/create')) {
          expect(sent['mode']).toBe('0011');
          expect(sent['currency']).toBe('BDT');
          expect(sent['intent']).toBe('sale');
          const id = `TR0011${String(payments.size + 1)}`;
          payments.set(id, {
            amount: String(sent['amount']),
            status: 'Initiated',
            executed: false,
          });
          return reply({
            statusCode: '0000',
            paymentID: id,
            bkashURL: `https://sandbox.example.test/pay?paymentId=${id}`,
            merchantInvoiceNumber: sent['merchantInvoiceNumber'],
          });
        }

        const id = String(sent['paymentID']);
        const payment = payments.get(id);
        if (payment === undefined) return reply({ statusCode: '2056', statusMessage: 'Invalid' });

        if (url.endsWith('/checkout/execute')) {
          if (payment.executed) return reply({ statusCode: '2062', statusMessage: 'Already done' });
          payment.executed = true;
          payment.status = nextStatus;
          return reply(
            nextStatus === 'Completed'
              ? {
                  statusCode: '0000',
                  paymentID: id,
                  trxID: `TRX${id}`,
                  transactionStatus: 'Completed',
                  amount: payment.amount,
                }
              : { statusCode: '2023', statusMessage: 'Insufficient balance' },
          );
        }
        if (url.endsWith('/payment/status')) {
          return reply({
            statusCode: '0000',
            paymentID: id,
            transactionStatus: payment.status,
            amount: payment.amount,
            ...(payment.status === 'Completed' ? { trxID: `TRX${id}` } : {}),
          });
        }
        if (url.endsWith('/payment/refund')) {
          expect(sent['trxID']).toBe(`TRX${id}`);
          return reply({
            transactionStatus: 'Completed',
            originalTrxID: sent['trxID'],
            refundTrxID: `RF${id}`,
            amount: sent['amount'],
          });
        }
        return reply({ statusCode: '9999' });
      })();
    });
    base = await listen(server);
  });

  afterAll(() => {
    server.close();
  });

  function bkash(): BkashProvider {
    set({
      BKASH_BASE_URL: base,
      BKASH_APP_KEY: 'APPKEY',
      BKASH_APP_SECRET: 'SECRET',
      BKASH_USERNAME: 'demo-user',
      BKASH_PASSWORD: 'demo-pass',
    });
    return new BkashProvider(base);
  }

  it('writes taka as bKash does', () => {
    expect(bkashAmount(50_000)).toBe('500.00');
    expect(bkashAmount(12_345)).toBe('123.45');
  });

  it('begins a checkout and sends the patient to bKash, paying nothing yet', async () => {
    const provider = bkash();
    const charged = await provider.charge({
      paymentId: '01900000-0000-7000-8000-000000000001',
      amountPoisha: 50_000,
      idempotencyKey: '01900000-0000-7000-8000-000000000001',
      returnUrl: 'https://app.example.test/pay/return',
    });
    expect(charged).toMatchObject({ ok: true, settled: false, providerRef: null });
    if (!charged.ok) return;
    expect(charged.redirectUrl).toContain(charged.checkoutId);
  });

  it('executes on a successful return, and reads what was paid', async () => {
    nextStatus = 'Completed';
    const provider = bkash();
    const grantsBefore = grants.length;
    const charged = await provider.charge({
      paymentId: 'p-2',
      amountPoisha: 70_000,
      idempotencyKey: 'p-2',
      returnUrl: 'https://app.example.test/pay/return',
    });
    if (!charged.ok) throw new Error('charge failed');

    const answer = await provider.confirm({
      paymentId: 'p-2',
      checkoutId: charged.checkoutId,
      amountPoisha: 70_000,
      hint: 'success',
    });
    expect(answer).toEqual({
      status: 'paid',
      providerRef: `TRX${charged.checkoutId}`,
      amountPoisha: 70_000,
    });

    // Asked again (the return opened twice, or the timer): execute refuses a
    // second time and the status says it was completed.
    const again = await provider.confirm({
      paymentId: 'p-2',
      checkoutId: charged.checkoutId,
      amountPoisha: 70_000,
      hint: null,
    });
    expect(again.status).toBe('paid');

    // One grant served this provider's three calls.
    expect(grants.length - grantsBefore).toBe(1);
  });

  it('reads the status, without executing, after a cancel', async () => {
    const provider = bkash();
    const charged = await provider.charge({
      paymentId: 'p-3',
      amountPoisha: 50_000,
      idempotencyKey: 'p-3',
      returnUrl: 'https://app.example.test/pay/return',
    });
    if (!charged.ok) throw new Error('charge failed');
    const stored = payments.get(charged.checkoutId);
    if (stored !== undefined) stored.status = 'Cancelled';

    const answer = await provider.confirm({
      paymentId: 'p-3',
      checkoutId: charged.checkoutId,
      amountPoisha: 50_000,
      hint: 'cancel',
    });
    expect(answer).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(stored?.executed).toBe(false);
  });

  it('calls a payment not completed pending, never paid', async () => {
    const provider = bkash();
    const charged = await provider.charge({
      paymentId: 'p-4',
      amountPoisha: 50_000,
      idempotencyKey: 'p-4',
      returnUrl: 'https://app.example.test/pay/return',
    });
    if (!charged.ok) throw new Error('charge failed');
    nextStatus = 'Initiated';
    const answer = await provider.confirm({
      paymentId: 'p-4',
      checkoutId: charged.checkoutId,
      amountPoisha: 50_000,
      hint: 'success',
    });
    expect(answer.status).toBe('pending');
    nextStatus = 'Completed';
  });

  it('refunds with both of bKash’s references', async () => {
    nextStatus = 'Completed';
    const provider = bkash();
    const charged = await provider.charge({
      paymentId: 'p-5',
      amountPoisha: 50_000,
      idempotencyKey: 'p-5',
      returnUrl: 'https://app.example.test/pay/return',
    });
    if (!charged.ok) throw new Error('charge failed');
    await provider.confirm({
      paymentId: 'p-5',
      checkoutId: charged.checkoutId,
      amountPoisha: 50_000,
      hint: 'success',
    });

    const refunded = await provider.refund({
      paymentId: 'p-5',
      checkoutId: charged.checkoutId,
      providerRef: `TRX${charged.checkoutId}`,
      amountPoisha: 50_000,
      idempotencyKey: 'r-5',
      reason: 'doctor_absent',
    });
    expect(refunded).toEqual({ ok: true, providerRef: `RF${charged.checkoutId}` });

    const without = await provider.refund({
      paymentId: 'p-5',
      checkoutId: charged.checkoutId,
      providerRef: null,
      amountPoisha: 50_000,
      idempotencyKey: 'r-6',
      reason: 'doctor_absent',
    });
    expect(without.ok).toBe(false);
  });

  it('says it could not reach bKash, rather than failing the payment', async () => {
    const provider = new BkashProvider('http://127.0.0.1:1');
    set({ BKASH_APP_KEY: 'APPKEY', BKASH_USERNAME: 'demo-user', BKASH_PASSWORD: 'demo-pass' });
    const answer = await provider.confirm({
      paymentId: 'p-6',
      checkoutId: 'TR-unknown',
      amountPoisha: 1,
      hint: null,
    });
    expect(answer.status).toBe('unreachable');
  });
});

// ---------------------------------------------------------------------------
// Nagad
// ---------------------------------------------------------------------------

describe('Nagad checkout, against a stand-in that encrypts and signs as Nagad does', () => {
  const nagadKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const merchantKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const nagadPublic = nagadKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const nagadPrivate = nagadKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const merchantPublic = merchantKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const merchantPrivate = merchantKeys.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();

  let server: Server;
  let base: string;
  const attempts = new Map<string, { challenge: string; amount: string | null; status: string }>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      void (async () => {
        const sent = await body(req);
        const reply = (value: unknown): void => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(value));
        };
        const url = req.url ?? '';
        expect(req.headers['x-km-api-version']).toBe('v-0.2.0');

        const open = (sealed: unknown, signature: unknown): Record<string, string> => {
          const plain = privateDecrypt(
            { key: nagadPrivate, padding: constants.RSA_PKCS1_PADDING },
            Buffer.from(String(sealed), 'base64'),
          ).toString('utf8');
          const verified = createVerify('SHA256')
            .update(plain)
            .verify(merchantPublic, String(signature), 'base64');
          if (!verified) throw new Error('bad signature');
          return JSON.parse(plain) as Record<string, string>;
        };

        if (url.includes('/check-out/initialize/')) {
          const inner = open(sent['sensitiveData'], sent['signature']);
          expect(inner['merchantId']).toBe('683002007104225');
          expect(inner['datetime']).toMatch(/^\d{14}$/);
          const reference = `NG${String(attempts.size + 1)}`;
          const challenge = `nagad-challenge-${reference}`;
          attempts.set(reference, { challenge, amount: null, status: 'Ready' });
          const answer = JSON.stringify({ paymentReferenceId: reference, challenge });
          return reply({
            sensitiveData: publicEncrypt(
              { key: merchantPublic, padding: constants.RSA_PKCS1_PADDING },
              Buffer.from(answer),
            ).toString('base64'),
            signature: createSign('SHA256').update(answer).sign(nagadPrivate, 'base64'),
          });
        }
        if (url.includes('/check-out/complete/')) {
          const reference = url.split('/').at(-1) ?? '';
          const attempt = attempts.get(reference);
          const inner = open(sent['sensitiveData'], sent['signature']);
          if (attempt === undefined || inner['challenge'] !== attempt.challenge) {
            return reply({ status: 'Failed' });
          }
          expect(inner['currencyCode']).toBe('050');
          attempt.amount = inner['amount'] ?? null;
          return reply({
            status: 'Success',
            callBackUrl: `https://sandbox.example.test/nagad/${reference}`,
          });
        }
        if (url.includes('/verify/payment/')) {
          const reference = url.split('/').at(-1) ?? '';
          const attempt = attempts.get(reference);
          if (attempt === undefined) return reply({ status: 'Failed' });
          return reply({
            status: attempt.status,
            amount: attempt.amount,
            paymentRefId: reference,
            ...(attempt.status === 'Success' ? { issuerPaymentRefNo: `ISS${reference}` } : {}),
          });
        }
        return reply({ status: 'Failed' });
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    base = await listen(server);
  });

  afterAll(() => {
    server.close();
  });

  function nagad(): NagadProvider {
    set({
      NAGAD_MERCHANT_ID: '683002007104225',
      NAGAD_MERCHANT_NUMBER: '01700000000',
    });
    return new NagadProvider({
      base,
      nagadPublicKey: nagadPublic,
      merchantPrivateKey: merchantPrivate,
    });
  }

  it('keeps Nagad’s clock and order id rules', () => {
    // 18:00 UTC is midnight in Dhaka, the next day.
    expect(nagadDateTime(new Date('2026-10-08T18:00:05Z'))).toBe('20261009000005');
    expect(nagadOrderId('01900000-0000-7000-8000-00000000000a')).toBe(
      '0190000000007000800000000000000a',
    );
  });

  it('initialises and completes a checkout, sealed and signed, and sends the patient on', async () => {
    const charged = await nagad().charge({
      paymentId: '01900000-0000-7000-8000-00000000000b',
      amountPoisha: 65_000,
      idempotencyKey: 'k',
      returnUrl: 'https://app.example.test/pay/return',
    });
    expect(charged).toMatchObject({ ok: true, settled: false });
    if (!charged.ok) return;
    expect(charged.redirectUrl).toBe(`https://sandbox.example.test/nagad/${charged.checkoutId}`);
    expect(attempts.get(charged.checkoutId)?.amount).toBe('650.00');
  });

  it('is paid only when verify says Success, and reads Nagad’s reference and amount', async () => {
    const provider = nagad();
    const charged = await provider.charge({
      paymentId: '01900000-0000-7000-8000-00000000000c',
      amountPoisha: 65_000,
      idempotencyKey: 'k',
      returnUrl: 'https://app.example.test/pay/return',
    });
    if (!charged.ok) throw new Error('charge failed');

    const before = await provider.confirm({
      paymentId: 'x',
      checkoutId: charged.checkoutId,
      amountPoisha: 65_000,
      hint: 'success',
    });
    expect(before.status).toBe('pending');

    const attempt = attempts.get(charged.checkoutId);
    if (attempt !== undefined) attempt.status = 'Success';
    const after = await provider.confirm({
      paymentId: 'x',
      checkoutId: charged.checkoutId,
      amountPoisha: 65_000,
      hint: null,
    });
    expect(after).toEqual({
      status: 'paid',
      providerRef: `ISS${charged.checkoutId}`,
      amountPoisha: 65_000,
    });

    if (attempt !== undefined) attempt.status = 'Aborted';
    const aborted = await provider.confirm({
      paymentId: 'x',
      checkoutId: charged.checkoutId,
      amountPoisha: 65_000,
      hint: 'cancel',
    });
    expect(aborted).toEqual({ status: 'failed', reason: 'cancelled' });
  });

  it('takes no refund by API: it is recorded by hand (FR-PAY-12)', async () => {
    const provider = nagad();
    expect(provider.refundsByApi).toBe(false);
    expect((await provider.refund()).ok).toBe(false);
  });

  it('refuses a checkout Nagad cannot open, rather than pretending', async () => {
    const provider = new NagadProvider({
      base,
      // A key that is not the one Nagad expects: its signature check fails.
      nagadPublicKey: nagadPublic,
      merchantPrivateKey: generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    });
    set({ NAGAD_MERCHANT_ID: '683002007104225', NAGAD_MERCHANT_NUMBER: '01700000000' });
    const charged = await provider.charge({
      paymentId: '01900000-0000-7000-8000-00000000000d',
      amountPoisha: 1_000,
      idempotencyKey: 'k',
      returnUrl: 'https://app.example.test/pay/return',
    });
    expect(charged.ok).toBe(false);
  });
});
