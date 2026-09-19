/**
 * Notification copy (`FR-NOT-03`, `FR-NOT-04`, `FR-NOT-05`, BACKEND.md §8).
 *
 * "Templates are versioned and centrally managed, never hard-coded at call
 * sites." A call site names a key and supplies parameters; the text lives
 * here, ships into `notification_templates`, and is rendered from that table
 * at send time.
 *
 * ## Why the shipped defaults are in code and the live copy is in a table
 *
 * Both halves earn their place. In code, the copy is reviewed, versioned with
 * the rest of the product and impossible to lose. In the table, a hospital can
 * be given different wording without a deploy, and — more importantly — a
 * notification sent last month can still be explained, because the row that
 * produced it is still there with its version on it.
 *
 * So these are defaults. `database/seeds/lib/templates.ts` installs them, and
 * `notification.service` reads the table and never this file.
 *
 * ## Writing for an SMS
 *
 * Most of these go out as SMS to a feature phone (`FR-PAT-37`, `FR-NOT-02`),
 * and that shapes them more than any style rule:
 *
 *   - **A Bangla SMS costs three times a Latin one.** GSM-7 packs 160
 *     characters into a segment; anything outside it switches the whole
 *     message to UCS-2 and 70. Bangla is always UCS-2, so every message here
 *     is written to land inside 70 characters where it can, and the ones that
 *     cannot are short for a reason worth paying for.
 *   - **Bengali numerals do not survive every handset.** A serial is the one
 *     thing in these messages a person acts on, so `{serial}` is rendered in
 *     the numerals the recipient's locale asks for and the service decides —
 *     not here.
 *   - **A link is Latin and must not be broken across a line.** It goes last.
 */

/** Every message the platform sends. One key per material event. */
export const TEMPLATE_KEYS = [
  'booking.confirmed',
  'queue.doctor_arrived',
  'queue.delayed',
  'queue.two_away',
  'queue.called',
  'queue.no_show',
  'queue.cancelled',
  'session.ended',
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** The channels a template can be written for (`notif_channel`). */
export type TemplateChannel = 'sms' | 'push';

export interface TemplateDefinition {
  readonly key: TemplateKey;
  readonly channel: TemplateChannel;
  readonly version: number;
  readonly bn: string;
  readonly en: string;
}

/**
 * The shipped defaults.
 *
 * `{placeholder}` names are substituted by the service. Every key that appears
 * in a body must be supplied at the call site, and `templates.test.ts` proves
 * the two lists agree — a template referring to `{doctor}` that nobody passes
 * would otherwise reach a patient with the word `{doctor}` in it.
 */
export const TEMPLATES: readonly TemplateDefinition[] = [
  // --- Booking (FR-PAT-22) --------------------------------------------------
  //
  // The one message that must carry the link (`FR-GST-05`): for a guest with
  // no app, this SMS *is* the product until they arrive.
  {
    key: 'booking.confirmed',
    channel: 'sms',
    version: 1,
    bn: '{hospital}-এ {doctor}, সিরিয়াল {serial}, {time}। লাইভ দেখুন: {link}',
    en: '{doctor} at {hospital}, serial {serial}, {time}. Track it live: {link}',
  },
  {
    key: 'booking.confirmed',
    channel: 'push',
    version: 1,
    bn: 'সিরিয়াল {serial} নিশ্চিত — {doctor}, {time}',
    en: 'Serial {serial} confirmed — {doctor}, {time}',
  },

  // --- The chamber opens ----------------------------------------------------
  {
    key: 'queue.doctor_arrived',
    channel: 'sms',
    version: 1,
    bn: '{doctor} চেম্বারে এসেছেন। আপনার সিরিয়াল {serial}, আনুমানিক {eta}।',
    en: '{doctor} has arrived. Your serial is {serial}, expected around {eta}.',
  },
  {
    key: 'queue.doctor_arrived',
    channel: 'push',
    version: 1,
    bn: 'ডাক্তার এসেছেন — আনুমানিক {eta}',
    en: 'The doctor has arrived — expected around {eta}',
  },

  // --- A declared delay (FR-REC-03, FR-PAT-34) ------------------------------
  //
  // The new expected time is the whole point of the message. A delay notice
  // that does not say when instead tells somebody to worry without telling
  // them what to do.
  {
    key: 'queue.delayed',
    channel: 'sms',
    version: 1,
    bn: '{doctor} {minutes} মিনিট দেরিতে। সিরিয়াল {serial}, এখন আনুমানিক {eta}।',
    en: '{doctor} is running {minutes} min late. Serial {serial}, now around {eta}.',
  },
  {
    key: 'queue.delayed',
    channel: 'push',
    version: 1,
    bn: '{minutes} মিনিট দেরি — এখন আনুমানিক {eta}',
    en: '{minutes} min late — now expected around {eta}',
  },

  // --- Two away (FR-NOT-03) -------------------------------------------------
  //
  // The message that makes the queue worth keeping: it is the one that lets a
  // person wait somewhere other than a corridor.
  {
    key: 'queue.two_away',
    channel: 'sms',
    version: 1,
    bn: 'আর ২ জন পরেই আপনার সিরিয়াল {serial}। এখন রওনা দিন।',
    en: 'You are 2 patients away — serial {serial}. Set off now.',
  },
  {
    key: 'queue.two_away',
    channel: 'push',
    version: 1,
    bn: 'আর ২ জন পরেই আপনি — সিরিয়াল {serial}',
    en: '2 patients away — serial {serial}',
  },

  // --- Called ---------------------------------------------------------------
  //
  // The shortest message in the product, because it is read while walking.
  {
    key: 'queue.called',
    channel: 'sms',
    version: 1,
    bn: 'আপনার ডাক এসেছে — সিরিয়াল {serial}, {room}।',
    en: 'You have been called — serial {serial}, {room}.',
  },
  {
    key: 'queue.called',
    channel: 'push',
    version: 1,
    bn: 'আপনার ডাক এসেছে — {room}',
    en: 'You have been called — {room}',
  },

  // --- No-show (FR-QUE-20) --------------------------------------------------
  //
  // SMS only. A person who missed their turn is not looking at the app, and
  // `BACKEND.md` §8's mapping says SMS for exactly that reason. It says what
  // to do next, because being told only that you were marked absent is of no
  // use to anybody.
  {
    key: 'queue.no_show',
    channel: 'sms',
    version: 1,
    bn: 'সিরিয়াল {serial} ডাকা হয়েছিল, আপনি ছিলেন না। কাউন্টারে যোগাযোগ করুন।',
    en: 'Serial {serial} was called and you were not there. Please see the counter.',
  },

  // --- Cancelled ------------------------------------------------------------
  {
    key: 'queue.cancelled',
    channel: 'sms',
    version: 1,
    bn: 'সিরিয়াল {serial} বাতিল করা হয়েছে — {doctor}, {date}।',
    en: 'Serial {serial} has been cancelled — {doctor}, {date}.',
  },
  {
    key: 'queue.cancelled',
    channel: 'push',
    version: 1,
    bn: 'সিরিয়াল {serial} বাতিল করা হয়েছে',
    en: 'Serial {serial} has been cancelled',
  },

  // --- The chamber closes (FR-REC-06) ---------------------------------------
  //
  // Sent to whoever was still waiting. Ending a session without telling the
  // people left in the queue is the failure this exists to prevent.
  {
    key: 'session.ended',
    channel: 'sms',
    version: 1,
    bn: 'আজকের চেম্বার শেষ হয়েছে। সিরিয়াল {serial} নিয়ে কাউন্টারে যোগাযোগ করুন।',
    en: "Today's chamber has finished. Please see the counter about serial {serial}.",
  },
  {
    key: 'session.ended',
    channel: 'push',
    version: 1,
    bn: 'আজকের চেম্বার শেষ হয়েছে',
    en: "Today's chamber has finished",
  },
];

/**
 * The placeholders a template body refers to.
 *
 * Read out of the body rather than declared beside it, so the two cannot
 * disagree — a declaration is one more thing to forget to update when the copy
 * changes.
 */
export function placeholdersIn(body: string): readonly string[] {
  return [...body.matchAll(/\{([a-z][a-zA-Z0-9]*)\}/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * Every placeholder a key needs, across both channels and both locales.
 *
 * This is the contract a call site has to satisfy. Taking the union rather
 * than per-channel means a caller supplies one set of parameters and the
 * service renders whichever channels the recipient gets.
 */
export function placeholdersFor(key: TemplateKey): readonly string[] {
  const names = new Set<string>();

  for (const template of TEMPLATES) {
    if (template.key !== key) continue;
    for (const name of placeholdersIn(template.bn)) names.add(name);
    for (const name of placeholdersIn(template.en)) names.add(name);
  }

  return [...names].sort();
}

/**
 * Fills a body's placeholders.
 *
 * A missing parameter leaves the placeholder in place rather than substituting
 * an empty string, and that is deliberate: `সিরিয়াল {serial}` reaching a
 * patient is obviously broken and gets reported, while `সিরিয়াল ` reaching
 * them looks like a serial that does not exist. Loud beats silent when the
 * message is already out of the building.
 */
export function render(body: string, params: Readonly<Record<string, string>>): string {
  return body.replace(/\{([a-z][a-zA-Z0-9]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? (params[name] ?? placeholder) : placeholder,
  );
}
