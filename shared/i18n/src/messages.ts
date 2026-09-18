/**
 * The message catalogue (FRONTEND.md §8, `I18N-01`, `I18N-02`).
 *
 * ## Bangla is the source, not the translation
 *
 * The `bn` entry of every key is the one that was written; `en` is its
 * translation. That ordering is the whole point — a product written in English
 * and translated reads like one, and this one is for a patient in Dhaka
 * (CLAUDE.md §11.5). Where the two disagree in tone, `bn` is right.
 *
 * ## Why the type makes a missing key impossible
 *
 * `I18N-02` says CI fails on a missing key. Rather than a test that walks two
 * objects, every message is a single entry holding both languages, so a key
 * cannot exist in one and not the other — there is nowhere for it to go
 * missing from. `messages.test.ts` then checks the things a type cannot: that
 * no entry is empty, and that Bangla copy uses দাঁড়ি rather than a full stop
 * (`TYP-05`).
 */

export type Locale = 'bn' | 'en';

/** One message, in both languages. Neither is optional. */
export interface Message {
  readonly bn: string;
  readonly en: string;
}

/**
 * Console copy (`APP_FLOW.md` B1).
 *
 * Button labels are verbs in Bangla — "সিরিয়াল নিন", not "জমা"
 * (FRONTEND.md §5.1). A label that names the noun leaves the person guessing
 * what pressing it will do.
 */
export const CONSOLE = {
  // --- Navigation rail (B1.1) ---------------------------------------------
  navQueue: { bn: 'সিরিয়াল', en: 'Queue' },
  navRegistration: { bn: 'রেজিস্ট্রেশন', en: 'Registration' },
  navBeds: { bn: 'বেড', en: 'Beds' },
  navEmergency: { bn: 'জরুরি', en: 'Emergency' },
  navTests: { bn: 'টেস্ট', en: 'Tests' },
  navBilling: { bn: 'বিল', en: 'Billing' },
  navDashboard: { bn: 'ড্যাশবোর্ড', en: 'Dashboard' },

  // --- Session bar (B1.2) --------------------------------------------------
  sessionSelector: { bn: 'চেম্বার নির্বাচন', en: 'Select chamber' },
  doctorArrived: { bn: 'ডাক্তার এসেছেন', en: 'Doctor has arrived' },
  declareDelay: { bn: 'দেরি ঘোষণা', en: 'Declare delay' },
  pause: { bn: 'বিরতি', en: 'Pause' },
  resume: { bn: 'আবার শুরু', en: 'Resume' },
  addWalkin: { bn: 'ওয়াক-ইন যোগ', en: 'Add walk-in' },
  callNext: { bn: 'পরবর্তী রোগী ডাকুন', en: 'Call next patient' },
  /** B1.3 step 1: the label changes when somebody is still in the chamber. */
  finishAndCallNext: { bn: 'এই রোগী শেষ ও পরবর্তী', en: 'Finish and call next' },
  plannedWindow: { bn: 'নির্ধারিত সময়', en: 'Planned' },
  actualStart: { bn: 'শুরু হয়েছে', en: 'Started' },
  notStarted: { bn: 'এখনো শুরু হয়নি', en: 'Not started yet' },

  // --- Queue table (B1.4) --------------------------------------------------
  colSerial: { bn: 'সিরিয়াল', en: 'Serial' },
  colPatient: { bn: 'রোগী', en: 'Patient' },
  colAge: { bn: 'বয়স', en: 'Age' },
  colStatus: { bn: 'অবস্থা', en: 'Status' },
  colSource: { bn: 'উৎস', en: 'Source' },
  colWaited: { bn: 'অপেক্ষা', en: 'Waited' },
  colActions: { bn: 'ব্যবস্থা', en: 'Actions' },
  markDone: { bn: 'দেখা শেষ', en: 'Done' },
  markLate: { bn: 'দেরি', en: 'Late' },
  markNoShow: { bn: 'অনুপস্থিত', en: 'No-show' },
  reinstate: { bn: 'ফিরিয়ে আনুন', en: 'Reinstate' },

  // --- Statuses ------------------------------------------------------------
  statusBooked: { bn: 'অপেক্ষায়', en: 'Waiting' },
  statusWaiting: { bn: 'অপেক্ষায়', en: 'Waiting' },
  statusInChamber: { bn: 'চেম্বারে', en: 'In chamber' },
  statusDone: { bn: 'দেখা হয়েছে', en: 'Seen' },
  statusLate: { bn: 'দেরিতে', en: 'Late' },
  statusNoShow: { bn: 'অনুপস্থিত', en: 'No-show' },
  statusCancelled: { bn: 'বাতিল', en: 'Cancelled' },
  statusRescheduled: { bn: 'সময় বদলানো', en: 'Rescheduled' },

  // --- Sources -------------------------------------------------------------
  sourceApp: { bn: 'অ্যাপ', en: 'App' },
  sourceGuestLink: { bn: 'লিংক', en: 'Link' },
  sourceCounter: { bn: 'কাউন্টার', en: 'Counter' },
  sourcePhone: { bn: 'ফোন', en: 'Phone' },
  sourceWalkin: { bn: 'ওয়াক-ইন', en: 'Walk-in' },

  // --- Right column (B1.5) -------------------------------------------------
  nowServing: { bn: 'এখন চলছে', en: 'Now serving' },
  nobodyInChamber: { bn: 'চেম্বারে কেউ নেই', en: 'Nobody in the chamber' },
  countersToday: { bn: 'আজকের হিসাব', en: 'Today' },
  countSeen: { bn: 'দেখা হয়েছে', en: 'Seen' },
  countWaiting: { bn: 'অপেক্ষায়', en: 'Waiting' },
  countLate: { bn: 'দেরিতে', en: 'Late' },
  countNoShow: { bn: 'অনুপস্থিত', en: 'No-show' },
  currentRate: { bn: 'গড় সময়', en: 'Average time' },
  minutesShort: { bn: 'মিনিট', en: 'min' },

  // --- Offline block (B1.5, FR-OFF-01) -------------------------------------
  online: { bn: 'সংযুক্ত', en: 'Online' },
  offline: { bn: 'সংযোগ নেই', en: 'Offline' },
  pendingToSync: { bn: 'পাঠানো বাকি', en: 'Waiting to sync' },
  lastSynced: { bn: 'সর্বশেষ সংযোগ', en: 'Last synced' },
  neverSynced: { bn: 'এখনো সংযোগ হয়নি', en: 'Not synced yet' },
  syncStuck: {
    bn: 'কিছু কাজ পাঠানো যাচ্ছে না। নেটওয়ার্ক ফিরলে আবার চেষ্টা হবে।',
    en: 'Some actions cannot be sent. They will be retried when the network returns.',
  },
  /** FR-OFF-01: work continues without a network, and says so plainly. */
  offlineExplainer: {
    bn: 'ইন্টারনেট ছাড়াই কাজ চালিয়ে যান। সংযোগ ফিরলে সব নিজে থেকেই পাঠানো হবে।',
    en: 'Keep working without internet. Everything sends itself when the connection returns.',
  },

  // --- Freshness (FR-OFF-03, GR-05) ----------------------------------------
  updatedJustNow: { bn: 'এইমাত্র হালনাগাদ', en: 'Updated just now' },
  updatedAgo: { bn: 'হালনাগাদ {time} আগে', en: 'Updated {time} ago' },
  staleWarning: { bn: 'তথ্য পুরনো হতে পারে', en: 'This may be out of date' },

  // --- Results and failures ------------------------------------------------
  undo: { bn: 'ফিরিয়ে নিন', en: 'Undo' },
  actionUndone: { bn: 'ফিরিয়ে নেওয়া হয়েছে', en: 'Undone' },
  calledPatient: { bn: 'সিরিয়াল {serial} ডাকা হয়েছে', en: 'Called serial {serial}' },
  conflictRolledBack: {
    bn: 'অন্য কাউন্টার আগে কাজটি করেছে। সারিটি হালনাগাদ করা হয়েছে।',
    en: 'Another counter got there first. The queue has been updated.',
  },
  queuedOffline: {
    bn: 'সংযোগ নেই — কাজটি পাঠানোর জন্য অপেক্ষায় রাখা হয়েছে।',
    en: 'No connection — this is queued to send.',
  },

  // --- The four states every screen has (GR-03) ----------------------------
  loading: { bn: 'লোড হচ্ছে', en: 'Loading' },
  emptyQueue: { bn: 'এই চেম্বারে এখনো কোনো সিরিয়াল নেই', en: 'No serials in this chamber yet' },
  loadFailed: { bn: 'তথ্য আনা যায়নি', en: 'Could not load' },
  retry: { bn: 'আবার চেষ্টা করুন', en: 'Try again' },
  noSession: { bn: 'আজ কোনো চেম্বার চলছে না', en: 'No chamber is running today' },

  // --- Demo mode (FR-DEM-07, CLAUDE.md §1.1) -------------------------------
  demoBanner: {
    bn: 'এটি একটি ডেমো। সব তথ্য প্রদর্শনের জন্য তৈরি।',
    en: 'This is a demonstration. All data here is for display only.',
  },
} as const satisfies Record<string, Message>;

export type ConsoleKey = keyof typeof CONSOLE;

/** Reads one message in one language. */
export function t(key: ConsoleKey, locale: Locale): string {
  return CONSOLE[key][locale];
}

/**
 * Reads a message and fills its `{placeholders}`.
 *
 * Deliberately not a template engine. The catalogue holds sentences with named
 * holes, and anything more — plurals, gendered forms, nested selects — belongs
 * in ICU MessageFormat, which is a dependency to take deliberately rather than
 * to grow by accident.
 */
export function format(
  key: ConsoleKey,
  locale: Locale,
  values: Readonly<Record<string, string>>,
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, value),
    t(key, locale),
  );
}
