/**
 * Notifications and the templates behind them (DATABASE.md §2.7).
 *
 * The notifications table is an outbox: a row is written inside the same
 * transaction as the queue event that caused it, and settled afterwards when
 * the adapter has answered. Both halves are here, and nothing else writes to
 * the table.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** A template row as the service renders from it. */
export interface TemplateRow {
  readonly key: string;
  readonly channel: string;
  readonly locale: string;
  readonly body: string;
  readonly version: number;
}

/**
 * Every active template.
 *
 * Read whole rather than one at a time. There are a few dozen rows, they
 * change at the speed of a deploy, and fetching them per send would put a
 * round trip in front of every notification a busy chamber produces.
 */
export async function activeTemplates(): Promise<TemplateRow[]> {
  const result = await sql<{
    key: string;
    channel: string;
    locale: string;
    body: string;
    version: number;
  }>`
    SELECT key, channel::text AS channel, locale, body, version
      FROM notification_templates
     WHERE is_active
  `.execute(db);

  return result.rows;
}

/** Who a notification is addressed to. At most one of the three (`notifications_one_recipient`). */
export interface Recipient {
  readonly patientId: string | null;
  readonly guestId: string | null;
  readonly userId: string | null;
  /** Normalised `+8801…`, or null when there is nowhere to send an SMS. */
  readonly phone: string | null;
  readonly locale: string;
}

export interface QueuedNotification {
  readonly recipient: Recipient;
  readonly channel: 'sms' | 'push';
  readonly templateKey: string;
  readonly params: Readonly<Record<string, string>>;
  /** The rendered text, stored so what was sent can be read back verbatim. */
  readonly body: string;
  /** Set when the message was decided against rather than queued. */
  readonly skipped: string | null;
}

/**
 * Writes the outbox rows for one event, inside its transaction.
 *
 * One statement for the whole batch: a chamber of a hundred and fifty patients
 * receiving a delay notice would otherwise take a hundred and fifty round
 * trips inside the lock every counter is waiting on.
 */
export async function queueAll(
  trx: Tx,
  notifications: readonly QueuedNotification[],
): Promise<string[]> {
  if (notifications.length === 0) return [];

  const values = notifications.map(
    (notification) => sql`(
      ${notification.recipient.patientId}::uuid,
      ${addressee(notification.recipient, 'guest')}::uuid,
      ${addressee(notification.recipient, 'user')}::uuid,
      ${notification.recipient.phone}::text,
      ${notification.channel}::notif_channel,
      ${notification.templateKey}::text,
      ${JSON.stringify({ ...notification.params, body: notification.body })}::jsonb,
      ${notification.skipped === null ? 'queued' : 'skipped'}::notif_state,
      ${notification.skipped}::text
    )`,
  );

  const result = await sql<{ id: string }>`
    INSERT INTO notifications
      (recipient_patient_id, recipient_guest_id, recipient_user_id, phone,
       channel, template_key, params, state, error)
    VALUES ${sql.join(values, sql`, `)}
    RETURNING id
  `.execute(trx);

  return result.rows.map((row) => row.id);
}

/**
 * Which column a notification is addressed by.
 *
 * `notifications_one_recipient` permits at most one, and a guest booking has
 * both: a `patients` row for the person being seen and a `guest_identities`
 * row for the phone that booked them. The patient wins, because the message is
 * about that person's visit and a guest identity may cover several of them —
 * a parent booking for two children is one identity and two patients, and a
 * message addressed to the identity could not say which child it meant.
 *
 * The other ids are still known in memory, which is what `deviceTokensFor`
 * reads; what narrows is only the row.
 */
function addressee(recipient: Recipient, column: 'guest' | 'user'): string | null {
  if (recipient.patientId !== null) return null;
  if (column === 'guest') return recipient.guestId;
  return recipient.guestId === null ? recipient.userId : null;
}

/** Marks a message as gone, with what the provider said about it. */
export async function markSent(
  id: string,
  outcome: { readonly providerRef: string; readonly costPoisha: number | null },
): Promise<void> {
  await sql`
    UPDATE notifications
       SET state = 'sent', sent_at = now(),
           provider_ref = ${outcome.providerRef}, cost_poisha = ${outcome.costPoisha}
     WHERE id = ${id}::uuid AND state = 'queued'
  `.execute(db);
}

/**
 * Marks a message as not gone, and why.
 *
 * `failed` is a provider that refused and may be retried; `skipped` is a
 * decision this system made and will not revisit. The distinction is what a
 * retry worker reads.
 */
export async function markNotSent(
  id: string,
  state: 'failed' | 'skipped',
  error: string,
): Promise<void> {
  await sql`
    UPDATE notifications
       SET state = ${state}::notif_state, error = ${error}
     WHERE id = ${id}::uuid AND state = 'queued'
  `.execute(db);
}

/**
 * The bookings already told something, for the messages that are sent once.
 *
 * "Two patients away" is the obvious one: a person is told to set off, and
 * telling them again on every subsequent call would be the kind of message
 * that teaches people to ignore the product.
 *
 * Read from the outbox rather than inferred from the queue's previous state.
 * A state comparison answers "did this change in the last transaction", which
 * is a different question and gets the first one wrong: before a chamber
 * opens, the third patient already satisfies "two away", so the transition
 * never fires and they are never told. The outbox answers the question
 * actually being asked — has this person had this message — and keeps
 * answering it correctly across a restart.
 */
export async function alreadyNotified(
  trx: Tx,
  sessionId: string,
  templateKey: string,
): Promise<Set<string>> {
  const result = await sql<{ booking_id: string }>`
    SELECT DISTINCT n.params ->> 'bookingId' AS booking_id
      FROM notifications n
     WHERE n.template_key = ${templateKey}
       AND (n.params ->> 'bookingId')::uuid IN (
             SELECT id FROM bookings WHERE session_id = ${sessionId}::uuid
           )
  `.execute(trx);

  return new Set(result.rows.map((row) => row.booking_id));
}

/** The chamber a message is about, for the text that names it. */
export interface ChamberRow {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly room: string | null;
  readonly plannedStart: string;
  readonly sessionDate: string;
  /** `hospital_settings.sms_budget_monthly`; null means no cap (`FR-NOT-06`). */
  readonly smsBudgetMonthly: number | null;
}

/** One read for everything a session's messages need to say about the chamber. */
export async function chamberFor(sessionId: string): Promise<ChamberRow | null> {
  const result = await sql<{
    hospital_id: string;
    hospital_name_bn: string;
    hospital_name_en: string;
    doctor_name_bn: string;
    doctor_name_en: string;
    room: string | null;
    planned_start: Date;
    session_date: Date | string;
    sms_budget_monthly: number | null;
  }>`
    SELECT h.id AS hospital_id,
           h.name_bn AS hospital_name_bn,
           h.name_en AS hospital_name_en,
           d.full_name_bn AS doctor_name_bn,
           d.full_name_en AS doctor_name_en,
           s.room, s.planned_start, s.session_date,
           hs.sms_budget_monthly
      FROM sessions s
      JOIN hospitals h ON h.id = s.hospital_id
      JOIN doctors d   ON d.id = s.doctor_id
      LEFT JOIN hospital_settings hs ON hs.hospital_id = h.id
     WHERE s.id = ${sessionId}::uuid
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    hospitalId: row.hospital_id,
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
    doctorNameBn: row.doctor_name_bn,
    doctorNameEn: row.doctor_name_en,
    room: row.room,
    plannedStart: row.planned_start.toISOString(),
    sessionDate:
      row.session_date instanceof Date
        ? row.session_date.toISOString().slice(0, 10)
        : row.session_date,
    smsBudgetMonthly: row.sms_budget_monthly,
  };
}

/** A booking's recipient, with the serial the message is about. */
export interface BookingRecipient extends Recipient {
  readonly bookingId: string;
  readonly serial: number;
}

/**
 * Who to tell, for every booking in a session.
 *
 * One query rather than one per booking: a delay declared in a chamber of a
 * hundred and fifty notifies all of them, and this runs inside the transaction
 * that holds the session row.
 *
 * The locale is the account holder's stated preference, or `bn` — which is the
 * product's default (`FR-LOC-01`) and not a fallback for missing data. A guest
 * has no account and therefore no preference, and Bangla is the right answer
 * for them rather than a guess.
 */
export async function recipientsForSession(
  trx: Tx,
  sessionId: string,
): Promise<BookingRecipient[]> {
  const result = await sql<{
    booking_id: string;
    serial_number: number;
    patient_id: string;
    guest_id: string | null;
    user_id: string | null;
    phone: string | null;
    locale: string | null;
  }>`
    SELECT b.id AS booking_id, b.serial_number, b.patient_id,
           b.booked_by_guest_id AS guest_id,
           b.booked_by_user_id  AS user_id,
           COALESCE(p.phone, g.phone, u.phone) AS phone,
           u.locale
      FROM bookings b
      JOIN patients p ON p.id = b.patient_id
      LEFT JOIN guest_identities g ON g.id = b.booked_by_guest_id
      LEFT JOIN users u            ON u.id = b.booked_by_user_id
     WHERE b.session_id = ${sessionId}::uuid AND b.deleted_at IS NULL
  `.execute(trx);

  return result.rows.map((row) => ({
    bookingId: row.booking_id,
    serial: row.serial_number,
    patientId: row.patient_id,
    guestId: row.guest_id,
    userId: row.user_id,
    phone: row.phone,
    locale: row.locale ?? 'bn',
  }));
}

/**
 * Web Push endpoints for a recipient.
 *
 * Empty for everybody in this version: no screen asks for notification
 * permission yet, so no `device_tokens` row exists. The query is here because
 * the channel decision in `FR-NOT-02` depends on the answer, and asking is
 * what makes "this person has no app" a fact rather than an assumption.
 */
export async function deviceTokensFor(recipient: Recipient): Promise<string[]> {
  if (recipient.userId === null && recipient.guestId === null) return [];

  const result = await sql<{ token: string }>`
    SELECT token FROM device_tokens
     WHERE revoked_at IS NULL
       AND (
         (${recipient.userId}::uuid  IS NOT NULL AND user_id  = ${recipient.userId}::uuid)
         OR (${recipient.guestId}::uuid IS NOT NULL AND guest_id = ${recipient.guestId}::uuid)
       )
  `.execute(db);

  return result.rows.map((row) => row.token);
}

/**
 * How many SMS a hospital has sent this calendar month (`FR-NOT-06`).
 *
 * Counted from the notifications of that hospital's sessions rather than from
 * a running total on `hospital_settings`, because a counter can drift and a
 * count cannot. It is one indexed aggregate per send, which is affordable at
 * this volume; when it stops being so, it becomes a materialised figure the
 * analytics refresh maintains.
 */
export async function smsSentThisMonth(hospitalId: string): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*)::text AS n
      FROM notifications n
      JOIN bookings b  ON b.id = (n.params ->> 'bookingId')::uuid
      JOIN sessions s  ON s.id = b.session_id
     WHERE s.hospital_id = ${hospitalId}::uuid
       AND n.channel = 'sms'
       AND n.state IN ('sent', 'delivered')
       AND n.queued_at >= date_trunc('month', now())
  `.execute(db);

  return Number(result.rows[0]?.n ?? '0');
}

/**
 * Everything queued for one session's bookings.
 *
 * Matched on `params ->> 'bookingId'` rather than by joining the recipient's
 * patient id. A patient has bookings in more than one chamber — that is the
 * ordinary case, not an edge one — so the patient join returns every message
 * ever sent to them, multiplied by how many bookings they hold. The booking id
 * travels in `params` because `notifications` has no column for it
 * (DATABASE.md §2.7) and "which booking was this about" is the question any
 * delivery report starts from.
 */
export async function listForSession(sessionId: string): Promise<
  {
    readonly id: string;
    readonly templateKey: string;
    readonly channel: string;
    readonly state: string;
    readonly error: string | null;
    readonly params: Record<string, unknown>;
  }[]
> {
  const result = await sql<{
    id: string;
    template_key: string;
    channel: string;
    state: string;
    error: string | null;
    params: Record<string, unknown>;
  }>`
    SELECT n.id, n.template_key, n.channel::text AS channel, n.state::text AS state,
           n.error, n.params
      FROM notifications n
     WHERE (n.params ->> 'bookingId')::uuid IN (
             SELECT id FROM bookings WHERE session_id = ${sessionId}::uuid
           )
     ORDER BY n.queued_at, n.id
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    templateKey: row.template_key,
    channel: row.channel,
    state: row.state,
    error: row.error,
    params: row.params,
  }));
}

/** Who a ready report goes to, and what the notice may name (`FR-LAB-03`). */
export interface ReportRecipient {
  readonly recipient: Recipient;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly testName: string;
  /** The doctor who ordered it, so `FR-LAB-03`'s second recipient is named. */
  readonly orderingDoctorId: string | null;
  readonly smsBudgetMonthly: number | null;
}

/**
 * The patient a test order belongs to, and the doctor who ordered it.
 *
 * Addressed to the patient. Where a test came out of a consultation the
 * visit's booking supplies the guest or account behind them, which is how a
 * guest with no account still gets told (`FR-GST-08`).
 */
export async function reportRecipient(
  trx: Tx,
  testOrderId: string,
): Promise<ReportRecipient | null> {
  const result = await sql<{
    patient_id: string;
    guest_id: string | null;
    user_id: string | null;
    phone: string | null;
    locale: string | null;
    hospital_id: string;
    name_bn: string;
    name_en: string;
    test_name: string;
    doctor_id: string | null;
    sms_budget_monthly: number | null;
  }>`
    SELECT t.patient_id, b.booked_by_guest_id AS guest_id, b.booked_by_user_id AS user_id,
           COALESCE(p.phone, g.phone, u.phone) AS phone, u.locale,
           h.id AS hospital_id, h.name_bn, h.name_en, t.test_name,
           v.doctor_id, s.sms_budget_monthly
      FROM test_orders t
      JOIN patients p ON p.id = t.patient_id
      JOIN hospitals h ON h.id = t.hospital_id
      LEFT JOIN visits v ON v.id = t.visit_id
      LEFT JOIN bookings b ON b.id = v.booking_id
      LEFT JOIN guest_identities g ON g.id = b.booked_by_guest_id
      LEFT JOIN users u ON u.id = b.booked_by_user_id
      LEFT JOIN hospital_settings s ON s.hospital_id = t.hospital_id
     WHERE t.id = ${testOrderId}::uuid
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    recipient: {
      patientId: row.patient_id,
      guestId: row.guest_id,
      userId: row.user_id,
      phone: row.phone,
      locale: row.locale ?? 'bn',
    },
    hospitalId: row.hospital_id,
    hospitalNameBn: row.name_bn,
    hospitalNameEn: row.name_en,
    testName: row.test_name,
    orderingDoctorId: row.doctor_id,
    smsBudgetMonthly: row.sms_budget_monthly,
  };
}

/** Who a bed request's answer goes to, and what it has to say (`FR-PAT-52`). */
export interface BedRequestRecipient {
  readonly recipient: Recipient;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly bedKind: string;
  /** `hospital_settings.sms_budget_monthly`; null means no cap (`FR-NOT-06`). */
  readonly smsBudgetMonthly: number | null;
}

/**
 * The family behind a bed request.
 *
 * Addressed to the patient, with the requester's phone as the fallback — the
 * same order `recipientsForSession` uses, because the person who asked for
 * the bed is the one waiting by the phone to hear.
 */
export async function bedRequestRecipient(
  trx: Tx,
  requestId: string,
): Promise<BedRequestRecipient | null> {
  const result = await sql<{
    patient_id: string;
    guest_id: string | null;
    user_id: string | null;
    phone: string | null;
    locale: string | null;
    hospital_id: string;
    name_bn: string;
    name_en: string;
    bed_kind: string;
    sms_budget_monthly: number | null;
  }>`
    SELECT r.patient_id, r.requested_by_guest_id AS guest_id, r.requested_by_user_id AS user_id,
           COALESCE(p.phone, g.phone, u.phone) AS phone, u.locale,
           h.id AS hospital_id, h.name_bn, h.name_en, r.bed_kind::text AS bed_kind,
           s.sms_budget_monthly
      FROM bed_requests r
      JOIN patients p ON p.id = r.patient_id
      JOIN hospitals h ON h.id = r.hospital_id
      LEFT JOIN guest_identities g ON g.id = r.requested_by_guest_id
      LEFT JOIN users u ON u.id = r.requested_by_user_id
      LEFT JOIN hospital_settings s ON s.hospital_id = r.hospital_id
     WHERE r.id = ${requestId}::uuid
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    recipient: {
      patientId: row.patient_id,
      guestId: row.guest_id,
      userId: row.user_id,
      phone: row.phone,
      locale: row.locale ?? 'bn',
    },
    hospitalId: row.hospital_id,
    hospitalNameBn: row.name_bn,
    hospitalNameEn: row.name_en,
    bedKind: row.bed_kind,
    smsBudgetMonthly: row.sms_budget_monthly,
  };
}

/** Who an emergency case's answer goes to (`APP_FLOW.md` D2: "Emergency acknowledged"). */
export interface EmergencyRecipient {
  readonly recipient: Recipient;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  /** `hospital_settings.sms_budget_monthly`; null means no cap (`FR-NOT-06`). */
  readonly smsBudgetMonthly: number | null;
}

/**
 * The number somebody left with an inbound alert.
 *
 * Usually nobody's record: an emergency needs nothing of a person
 * (`FR-GST-03`), so the recipient is often a phone number and no row at all —
 * which `notifications_one_recipient` allows. When the case has since been
 * admitted and names a patient, the message is addressed to them.
 */
export async function emergencyRecipient(
  trx: Tx,
  caseId: string,
): Promise<EmergencyRecipient | null> {
  const result = await sql<{
    patient_id: string | null;
    contact_phone: string | null;
    hospital_id: string;
    name_bn: string;
    name_en: string;
    sms_budget_monthly: number | null;
  }>`
    SELECT ec.patient_id, ec.contact_phone, h.id AS hospital_id, h.name_bn, h.name_en,
           s.sms_budget_monthly
      FROM emergency_cases ec
      JOIN hospitals h ON h.id = ec.hospital_id
      LEFT JOIN hospital_settings s ON s.hospital_id = ec.hospital_id
     WHERE ec.id = ${caseId}::uuid
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    recipient: {
      patientId: row.patient_id,
      guestId: null,
      userId: null,
      phone: row.contact_phone,
      // Nobody chose a language: an alert carries no profile. Bangla is the
      // product (`FR-LOC-01`).
      locale: 'bn',
    },
    hospitalId: row.hospital_id,
    hospitalNameBn: row.name_bn,
    hospitalNameEn: row.name_en,
    smsBudgetMonthly: row.sms_budget_monthly,
  };
}
