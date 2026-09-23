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
  'queue.slot_offered',
  'queue.slot_offered_link',
  'queue.slot_seated',
  'session.ended',
  'bed.request_held',
  'bed.request_declined',
  'emergency.acknowledged',
  'emergency.declined',
  'lab.report_ready',
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

  // --- A freed chair is offered (FR-QUE-30) ---------------------------------
  //
  // The only message in this product with a deadline inside it, and the one
  // where the segment limit bites hardest: it has to name a doctor, a
  // deadline and an action in seventy UCS-2 characters. The hospital name is
  // what gave way — somebody on a standby list knows which hospital they put
  // themselves on it for, and the doctor is what they are actually waiting
  // for. It is still passed as a parameter, so a hospital customising the
  // copy (`FR-NOT-05`) can spend its own budget putting the name back.
  //
  // No serial: the number is allocated when they accept, not when they are
  // asked. And it says *where to go*, not "reply yes" — nothing in this
  // version reads an inbound SMS, and inviting a reply that reaches nobody is
  // worse than not inviting one.
  {
    key: 'queue.slot_offered',
    channel: 'sms',
    version: 1,
    bn: '{doctor}-এর চেম্বারে সিরিয়াল খালি। {time} পর্যন্ত কাউন্টারে জানান।',
    en: 'A serial has opened with {doctor}. Tell the counter by {time}.',
  },
  {
    key: 'queue.slot_offered',
    channel: 'push',
    version: 1,
    bn: '{doctor}-এর চেম্বারে সিরিয়াল খালি — {time} পর্যন্ত',
    en: 'A serial has opened with {doctor} — until {time}',
  },

  // --- The same offer, to somebody who joined from the app (FR-PAT-27) ------
  //
  // They answer on their phone, so the message links to where they do it
  // rather than to a counter. The link goes last, as every link here does.
  {
    key: 'queue.slot_offered_link',
    channel: 'sms',
    version: 1,
    bn: '{doctor}-এর চেম্বারে সিরিয়াল খালি। {time}-এর মধ্যে জানান: {link}',
    en: 'A serial has opened with {doctor}. Answer by {time}: {link}',
  },
  {
    key: 'queue.slot_offered_link',
    channel: 'push',
    version: 1,
    bn: '{doctor}-এর চেম্বারে সিরিয়াল খালি — {time}-এর মধ্যে জানান',
    en: 'A serial has opened with {doctor} — answer by {time}',
  },

  // --- A prepaid standby patient, seated (FR-PAT-26) ------------------------
  //
  // Nobody asked them: they paid to be seated on sight. So it says it is
  // done, and which serial, and where to watch it.
  {
    key: 'queue.slot_seated',
    channel: 'sms',
    version: 1,
    bn: '{doctor}-এর চেম্বারে সিরিয়াল {serial} আপনার। দেখুন: {link}',
    en: 'Serial {serial} with {doctor} is yours. Follow it: {link}',
  },
  {
    key: 'queue.slot_seated',
    channel: 'push',
    version: 1,
    bn: '{doctor}-এর চেম্বারে সিরিয়াল {serial} আপনার',
    en: 'Serial {serial} with {doctor} is yours',
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

  // --- A bed request answered (FR-PAT-52, BACKEND.md §8) ---------------------
  //
  // BACKEND.md §8 names one key, `bed.request_result`. A hold and a decline
  // say different things and a family acts on each differently — drive now,
  // or look elsewhere — so they are two keys rather than one body with the
  // outcome passed in as a parameter, which would put copy outside this file.
  //
  // The hold names its deadline, because a hold the family does not know is
  // running out is a bed they lose without being told why. The decline says
  // what to do next. Neither claims the hospital is full: a ward can decline
  // for reasons other than an empty bed count, and saying "none free" would be
  // a statement about availability the ward did not make.
  {
    key: 'bed.request_held',
    channel: 'sms',
    version: 1,
    bn: '{hospital}-এ {kind} বেড {time} পর্যন্ত আপনার জন্য রাখা আছে। {link}',
    en: '{hospital}: a {kind} bed is held for you until {time}. {link}',
  },
  {
    key: 'bed.request_held',
    channel: 'push',
    version: 1,
    bn: '{hospital}-এ {kind} বেড {time} পর্যন্ত রাখা আছে',
    en: '{hospital}: {kind} bed held until {time}',
  },
  {
    key: 'bed.request_declined',
    channel: 'sms',
    version: 1,
    bn: '{hospital} এখন {kind} বেড দিতে পারছে না। অন্য হাসপাতাল দেখুন: {link}',
    en: '{hospital} cannot offer a {kind} bed right now. Other hospitals: {link}',
  },
  {
    key: 'bed.request_declined',
    channel: 'push',
    version: 1,
    bn: '{hospital} এখন {kind} বেড দিতে পারছে না',
    en: '{hospital} cannot offer a {kind} bed right now',
  },

  // `APP_FLOW.md` D2 routes "Emergency acknowledged" to `S-A-10c`, so a family
  // who left a number with "I'm on my way" is told when the ER is ready — and,
  // because it matters more, when the ER cannot take them. Sent only when a
  // number was left; nothing about an emergency requires one (`FR-GST-03`).
  //
  // Neither names the problem or the patient: a text on a shared family phone
  // should not announce a burn. The decline does not give the ER's reason
  // either — that is on the status page the link opens, where there is room
  // for it — and never claims the hospital is "full", because an ER declines
  // for reasons other than beds.
  {
    key: 'emergency.acknowledged',
    channel: 'sms',
    version: 1,
    bn: '{hospital} জরুরি বিভাগ আপনার জন্য প্রস্তুত। {link}',
    en: '{hospital} emergency department is ready for you. {link}',
  },
  {
    key: 'emergency.acknowledged',
    channel: 'push',
    version: 1,
    bn: '{hospital} জরুরি বিভাগ আপনার জন্য প্রস্তুত',
    en: '{hospital} emergency department is ready for you',
  },
  {
    key: 'emergency.declined',
    channel: 'sms',
    version: 1,
    bn: '{hospital} এখন আপনাকে নিতে পারছে না। অন্য হাসপাতাল দেখুন: {link}',
    en: '{hospital} cannot take you right now. Other hospitals: {link}',
  },
  {
    key: 'emergency.declined',
    channel: 'push',
    version: 1,
    bn: '{hospital} এখন আপনাকে নিতে পারছে না — অন্য হাসপাতাল দেখুন',
    en: '{hospital} cannot take you right now — see other hospitals',
  },

  // `FR-LAB-03`. **Push only**, because BACKEND.md §8's mapping says push and
  // nothing else — a report is not a summons, and it is already in the wallet
  // by the time this is written. In this version that means the row is
  // recorded and skipped with `no_device_token`, like every other push: the
  // delivery itself is what FR-LAB-03 promises, and it has already happened.
  {
    key: 'lab.report_ready',
    channel: 'push',
    version: 1,
    bn: '{test}-এর রিপোর্ট এসেছে — {hospital}',
    en: 'Your {test} report is ready — {hospital}',
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
