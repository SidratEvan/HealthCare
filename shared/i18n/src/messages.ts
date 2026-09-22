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

  // --- Demo sign-in (S-B-01, CLAUDE.md §4.1) -------------------------------
  //
  // Replaces `S-B-00` Staff login while authentication is deferred. The copy
  // says plainly that this is a demonstration, because a console anybody can
  // open must not be mistaken for one that checked who you are.
  chooseConsole: { bn: 'কনসোল নির্বাচন করুন', en: 'Choose a console' },
  chooseHospital: { bn: 'কোন হাসপাতাল?', en: 'Which hospital?' },
  chooseRole: { bn: 'কোন দায়িত্বে?', en: 'Which role?' },
  chooseChamber: { bn: 'কোন চেম্বার?', en: 'Which chamber?' },
  roleReceptionist: { bn: 'রিসেপশন', en: 'Reception' },
  roleDoctor: { bn: 'ডাক্তার', en: 'Doctor' },
  roleHospitalAdmin: { bn: 'ব্যবস্থাপনা', en: 'Administration' },
  demoSignIn: {
    bn: 'এটি ডেমো — পাসওয়ার্ড ছাড়াই ঢোকা যায়। আসল সংস্করণে লগ ইন লাগবে।',
    en: 'This is a demonstration — no password is needed. The real version requires a login.',
  },
  sessionRunning: { bn: 'চলছে', en: 'Running' },
  sessionScheduled: { bn: 'শুরু হয়নি', en: 'Not started' },
  sessionEnded: { bn: 'শেষ', en: 'Finished' },
  waitingCount: { bn: '{count} জন অপেক্ষায়', en: '{count} waiting' },
  openConsole: { bn: 'কনসোল খুলুন', en: 'Open the console' },
  noConsoles: {
    bn: 'আজ কোনো চেম্বার চলছে না। ডেমো তথ্য আবার তৈরি করুন।',
    en: 'No chambers are running today. Rebuild the demo data.',
  },
  changeConsole: { bn: 'কনসোল বদলান', en: 'Change console' },
  consoleLoadFailed: { bn: 'কনসোলের তালিকা আনা যায়নি', en: 'Could not load the consoles' },

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

  /**
   * Shown while a sleeping API is being woken (`S-B-01`).
   *
   * The demo API sleeps when nobody has used it, and the first request after
   * that takes the best part of a minute. Saying so beats a skeleton that never
   * resolves — a hospital director watching a blank screen concludes the product
   * is broken, which is a worse outcome than being told to wait.
   */
  consoleWaking: {
    bn: 'সার্ভার চালু হচ্ছে, একটু সময় লাগবে…',
    en: 'Waking the server, this takes a moment…',
  },

  // --- Doctor console (S-B-05, APP_FLOW.md B2) -----------------------------
  doctorConsole: { bn: 'ডাক্তারের স্ক্রিন', en: 'Doctor console' },
  receptionConsole: { bn: 'রিসেপশন', en: 'Reception' },

  // The session header (FR-DOC-01): seen, waiting, average, running late.
  runningLate: { bn: 'দেরিতে চলছে', en: 'Running late' },
  onTime: { bn: 'সময়মতো চলছে', en: 'On time' },
  sessionEarnings: { bn: 'আজকের আদায়', en: 'Collected today' },

  // The patient panel (FR-DOC-03).
  patientPanel: { bn: 'রোগীর তথ্য', en: 'Patient' },
  years: { bn: 'বছর', en: 'years' },
  sexMale: { bn: 'পুরুষ', en: 'Male' },
  sexFemale: { bn: 'মহিলা', en: 'Female' },
  sexOther: { bn: 'অন্য', en: 'Other' },
  bloodGroup: { bn: 'রক্তের গ্রুপ', en: 'Blood group' },
  chiefComplaint: { bn: 'যে কারণে এসেছেন', en: 'Reason for visit' },
  symptomDuration: { bn: 'কত দিন ধরে', en: 'Duration' },
  chronicConditions: { bn: 'দীর্ঘমেয়াদি রোগ', en: 'Chronic conditions' },
  currentMedicines: { bn: 'বর্তমানে যে ওষুধ চলছে', en: 'Current medicines' },
  allergies: { bn: 'অ্যালার্জি', en: 'Allergies' },
  noneDeclared: { bn: 'কিছু জানানো হয়নি', en: 'None declared' },
  intakeNotAsked: {
    bn: 'রোগী আগে থেকে কোনো তথ্য দেননি। সরাসরি জিজ্ঞেস করুন।',
    en: 'The patient answered nothing beforehand. Ask directly.',
  },
  pastVisits: { bn: 'আগের ভিজিট', en: 'Past visits' },
  noPastVisits: { bn: 'এই রোগীর আগের কোনো রেকর্ড নেই', en: 'No earlier records for this patient' },
  // `PRD.md` §3.2: absent is stated, never implied by a blank.
  prescriptionsAbsent: {
    bn: 'এই সংস্করণে ব্যবস্থাপত্র নেই',
    en: 'Prescriptions are not part of this version',
  },
  reportsAbsent: {
    bn: 'টেস্টের রিপোর্ট এখনো যুক্ত হয়নি',
    en: 'Test reports are not connected yet',
  },

  // The note (INP-B05-DX, INP-B05-ADVICE, SEL-B05-FOLLOWUP).
  visitNote: { bn: 'ভিজিটের রেকর্ড', en: 'Visit record' },
  diagnosis: { bn: 'রোগ নির্ণয়', en: 'Diagnosis' },
  diagnosisHint: { bn: 'যা বুঝলেন, সংক্ষেপে', en: 'What you concluded, briefly' },
  adviceBn: { bn: 'রোগীর জন্য পরামর্শ (বাংলায়)', en: 'Advice for the patient (in Bangla)' },
  adviceHint: {
    bn: 'রোগী এটিই পড়বেন, তাই সহজ বাংলায় লিখুন',
    en: 'The patient reads this, so write it in plain Bangla',
  },
  followUp: { bn: 'আবার কবে দেখাবেন', en: 'Follow-up' },
  followUpNone: { bn: 'দরকার নেই', en: 'Not needed' },
  followUpDays: { bn: '{days} দিন পর', en: 'In {days} days' },

  saveDraft: { bn: 'খসড়া রাখুন', en: 'Save draft' },
  draftSaved: { bn: 'খসড়া রাখা হয়েছে', en: 'Draft saved' },
  signAndNext: { bn: 'রেকর্ড দিন ও পরবর্তী', en: 'Save record and next' },
  signedAndCalled: {
    bn: 'রেকর্ড জমা হয়েছে। সিরিয়াল {serial} ডাকা হয়েছে।',
    en: 'Record saved. Serial {serial} called.',
  },
  signedNobodyLeft: {
    bn: 'রেকর্ড জমা হয়েছে। আর কেউ অপেক্ষায় নেই।',
    en: 'Record saved. Nobody left waiting.',
  },
  // APP_FLOW.md B2: "if the prescription fails to save, the consultation is
  // **not** marked done… with the draft preserved locally".
  visitSaveFailed: {
    bn: 'রেকর্ড জমা হয়নি, তাই রোগী শেষ করা হয়নি। যা লিখেছেন তা রয়ে গেছে — আবার চেষ্টা করুন।',
    en: 'The record did not save, so the consultation was not closed. What you wrote is still here — try again.',
  },
  needSomethingToSign: {
    bn: 'রোগ নির্ণয়, পরামর্শ বা ফলো-আপ — অন্তত একটি লিখুন',
    en: 'Write at least one of diagnosis, advice or follow-up',
  },
  nobodyToSee: {
    bn: 'চেম্বারে কেউ নেই। রিসেপশন পরের রোগী ডাকলে এখানে দেখা যাবে।',
    en: 'Nobody is in the chamber. The next patient appears here when reception calls them.',
  },
  waitingNext: { bn: 'এরপরে', en: 'Next' },

  // BTN-B05-SCAN (FR-PAT-63). A code rather than a camera for now — see
  // `consent.service` for why — so the control says where the code comes from.
  scanTitle: {
    bn: 'রোগীর কোড দিয়ে আগের রেকর্ড খুলুন',
    en: 'Open earlier records with the patient’s code',
  },
  scanHint: {
    bn: 'রোগীর ফোনে: রেকর্ড → কোড দেখান। কোডটি এখানে দিন।',
    en: 'On the patient’s phone: Records → Show code. Paste it here.',
  },
  consentCode: { bn: 'রোগীর কোড', en: 'Patient’s code' },
  openRecords: { bn: 'রেকর্ড খুলুন', en: 'Open records' },
  needCode: { bn: 'আগে রোগীর কোডটি দিন', en: 'Enter the patient’s code first' },
  // One sentence for expired, mistyped and forged: the API does not say which,
  // on purpose, and the remedy is the same.
  codeInvalid: {
    bn: 'কোডটি কাজ করছে না — মেয়াদ শেষ বা ভুল। রোগীকে নতুন কোড দেখাতে বলুন।',
    en: 'That code does not work — expired or mistyped. Ask the patient for a new one.',
  },
  consentGranted: {
    bn: '{name} রেকর্ড দেখার অনুমতি দিয়েছেন, {time} পর্যন্ত',
    en: '{name} has given access until {time}',
  },
  closeRecords: { bn: 'বন্ধ করুন', en: 'Close' },

  // --- The four states every screen has (GR-03) ----------------------------
  loading: { bn: 'লোড হচ্ছে', en: 'Loading' },
  emptyQueue: { bn: 'এই চেম্বারে এখনো কোনো সিরিয়াল নেই', en: 'No serials in this chamber yet' },
  loadFailed: { bn: 'তথ্য আনা যায়নি', en: 'Could not load' },
  retry: { bn: 'আবার চেষ্টা করুন', en: 'Try again' },
  noSession: { bn: 'আজ কোনো চেম্বার চলছে না', en: 'No chamber is running today' },

  // --- The ward board (S-B-06, APP_FLOW.md B3) -----------------------------
  roleWard: { bn: 'ওয়ার্ড', en: 'Ward' },
  wardBoardSection: { bn: 'ওয়ার্ড ও বেড বোর্ড', en: 'Ward and bed board' },
  openWardBoard: { bn: 'বেড বোর্ড খুলুন', en: 'Open the bed board' },
  wardBoardTitle: { bn: 'বেড বোর্ড', en: 'Bed board' },
  allWards: { bn: 'সব ওয়ার্ড', en: 'All wards' },
  floorN: { bn: 'তলা {floor}', en: 'Floor {floor}' },
  noWards: { bn: 'এই হাসপাতালে কোনো ওয়ার্ড নেই', en: 'This hospital has no wards' },
  noWardsHint: {
    bn: 'বেড যোগ করতে ব্যবস্থাপনার সঙ্গে যোগাযোগ করুন।',
    en: 'Ask administration to add wards and beds.',
  },
  chooseBed: { bn: 'একটি বেড বেছে নিন', en: 'Choose a bed' },
  closePanel: { bn: 'বন্ধ করুন', en: 'Close' },
  chooseBedHint: {
    bn: 'বেডে চাপ দিলে এখানে তার অবস্থা ও কাজগুলো আসবে।',
    en: 'Tap a bed to see its state and what can be done with it.',
  },

  bedStateFree: { bn: 'খালি', en: 'Free' },
  bedStateOccupied: { bn: 'ভর্তি', en: 'Occupied' },
  bedStateCleaning: { bn: 'পরিষ্কার হচ্ছে', en: 'Being cleaned' },
  bedStateReserved: { bn: 'সংরক্ষিত', en: 'Reserved' },
  bedStateOos: { bn: 'সেবার বাইরে', en: 'Out of service' },
  bedDaysIn: { bn: '{days} দিন', en: '{days} days' },
  bedUntil: { bn: '{time} পর্যন্ত', en: 'until {time}' },
  bedCleaningFor: { bn: '{minutes} মিনিট ধরে', en: 'for {minutes} min' },
  bedHeldForRequest: { bn: 'অনুরোধের জন্য রাখা', en: 'Held for a request' },
  bedPendingSync: { bn: 'সার্ভারে পাঠানো বাকি', en: 'Not yet sent to the server' },
  bedSinceToday: { bn: 'আজ থেকে', en: 'Since today' },
  factNightly: { bn: 'প্রতি রাতের ভাড়া', en: 'Nightly' },
  factSince: { bn: 'এই অবস্থায় আছে', en: 'In this state since' },
  factLastCleaned: { bn: 'শেষ পরিষ্কার', en: 'Last cleaned' },
  factHeldUntil: { bn: 'রাখা আছে', en: 'Held' },

  occupant: { bn: 'রোগী', en: 'Patient' },
  occupantAdmitted: { bn: 'ভর্তি {time}', en: 'Admitted {time}' },
  occupantOffline: {
    bn: 'সংযোগ ফিরলে রোগীর নাম দেখা যাবে।',
    en: "The patient's name will show when the connection returns.",
  },
  occupantViewLogged: {
    bn: 'এই দেখাটি রোগীর রেকর্ডে লেখা থাকবে।',
    en: 'This view is recorded in the patient’s access log.',
  },
  ageYears: { bn: '{age} বছর', en: '{age} yrs' },

  admit: { bn: 'ভর্তি করুন', en: 'Admit' },
  admitHeading: { bn: 'কাকে ভর্তি করবেন?', en: 'Who is being admitted?' },
  admitName: { bn: 'নাম', en: 'Name' },
  admitPhone: { bn: 'মোবাইল নম্বর', en: 'Mobile number' },
  admitAge: { bn: 'বয়স', en: 'Age' },
  admitSex: { bn: 'লিঙ্গ', en: 'Sex' },
  admitFromRequest: { bn: 'অপেক্ষমাণ অনুরোধ থেকে', en: 'From a waiting request' },
  admitConfirm: { bn: 'ভর্তি নিশ্চিত করুন', en: 'Confirm admission' },
  admitNameError: { bn: 'রোগীর পুরো নাম লিখুন', en: "Write the patient's full name" },
  admitPhoneError: {
    bn: 'মোবাইল নম্বরটি ঠিক নেই, যেমন 01712345678',
    en: 'That mobile number is not right, e.g. 01712345678',
  },
  admitAgeError: { bn: 'বয়স বছরে লিখুন', en: 'Give the age in years' },
  admitSexError: { bn: 'লিঙ্গ বেছে নিন', en: 'Choose the sex' },
  admitDeskHint: {
    bn: 'একই নাম ও নম্বরের রোগী আগে থাকলে সেই রেকর্ডেই ভর্তি হবে।',
    en: 'A patient already on record with this name and number is admitted on that record.',
  },
  admitHeldRequest: {
    bn: 'এই বেডটি {name}-এর জন্য রাখা আছে।',
    en: 'This bed is held for {name}.',
  },

  discharge: { bn: 'ছাড়পত্র দিন', en: 'Discharge' },
  dischargeConsequence: {
    bn: 'ছাড়পত্র দিলে {bed} পরিষ্কারের তালিকায় যাবে। পরিষ্কার শেষ না হওয়া পর্যন্ত খালি দেখাবে না।',
    en: '{bed} goes for cleaning. It will not show as free until the cleaning is done.',
  },
  transfer: { bn: 'স্থানান্তর করুন', en: 'Transfer' },
  transferChoose: { bn: 'কোন বেডে নেবেন?', en: 'Move to which bed?' },
  transferConfirm: { bn: '{from} থেকে {to}-এ নিন', en: 'Move from {from} to {to}' },
  transferConsequence: {
    bn: '{from} পরিষ্কারের তালিকায় যাবে, রোগী {to}-এ থাকবেন।',
    en: '{from} goes for cleaning; the patient moves to {to}.',
  },
  noFreeBed: { bn: 'এখন কোনো খালি বেড নেই', en: 'No free bed right now' },
  reserve: { bn: 'সংরক্ষিত রাখুন', en: 'Hold this bed' },
  holdFor: { bn: '{minutes} মিনিট', en: '{minutes} min' },
  release: { bn: 'সংরক্ষণ তুলে নিন', en: 'Release the hold' },
  cleanStart: { bn: 'পরিষ্কারে পাঠান', en: 'Send for cleaning' },
  cleanDone: { bn: 'পরিষ্কার শেষ করুন', en: 'Mark cleaned' },
  outOfService: { bn: 'সেবার বাইরে রাখুন', en: 'Take out of service' },
  outOfServiceReason: { bn: 'কারণ লিখুন', en: 'Give a reason' },
  restore: { bn: 'সেবায় ফেরান', en: 'Return to service' },
  expectedDischarge: { bn: 'সম্ভাব্য ছুটি', en: 'Expected discharge' },
  expectedDischargeUnset: { bn: 'ঠিক হয়নি', en: 'Not set' },
  saveForecast: { bn: 'তারিখ রাখুন', en: 'Save date' },
  goBack: { bn: 'ফিরে যান', en: 'Back' },
  bedActionRefused: {
    bn: 'বোর্ড বদলে গেছে, তাই কাজটি হয়নি। বেডের এখনকার অবস্থা দেখুন।',
    en: 'The board changed, so that did not happen. Check the bed as it is now.',
  },
  bedActionQueued: {
    bn: 'সংযোগ নেই — কাজটি রাখা হলো, সংযোগ ফিরলে পাঠানো হবে।',
    en: 'Offline — saved, and it will be sent when the connection returns.',
  },
  patientAlreadyAdmitted: {
    bn: 'এই রোগী আগে থেকেই অন্য একটি বেডে ভর্তি আছেন।',
    en: 'This patient is already in another bed.',
  },

  // `<CapacityMirror>` (FR-BED-06): what a family's phone is showing.
  mirrorTitle: { bn: 'অ্যাপে দেখাচ্ছে', en: 'Showing in the app' },
  mirrorSubtitle: {
    bn: 'রোগী ও জরুরি বিভাগ এখন এই সংখ্যাগুলো দেখছেন।',
    en: 'What patients and emergency services are being shown right now.',
  },
  mirrorFreeOfTotal: { bn: '{free}/{total} খালি', en: '{free} of {total} free' },
  mirrorMismatch: {
    bn: 'বোর্ডে {board} খালি — অ্যাপ এখনো আগের সংখ্যা দেখাচ্ছে।',
    en: 'The board says {board} free — the app still shows the earlier number.',
  },
  mirrorEmpty: {
    bn: 'এই হাসপাতালের কোনো বেড অ্যাপে দেখানো হয় না।',
    en: 'No beds from this hospital are shown in the app.',
  },
  neverConfirmed: { bn: 'কখনো নিশ্চিত করা হয়নি', en: 'Never confirmed' },

  // FR-BED-04: staff only, and it says so.
  forecastTitle: { bn: 'আগামীকাল সম্ভাব্য খালি', en: 'Likely free tomorrow' },
  forecastStaffOnly: {
    bn: 'শুধু কর্মীদের জন্য — অ্যাপে দেখানো হয় না।',
    en: 'Staff only — never shown in the app.',
  },
  forecastRow: { bn: 'এখন {now} · কাল {tomorrow}', en: '{now} now · {tomorrow} tomorrow' },
  forecastBlind: {
    bn: '{count}টি ভর্তি বেডের ছুটির তারিখ ঠিক হয়নি।',
    en: '{count} occupied beds have no expected discharge.',
  },

  // LIST-B06-PENDING (FR-BED-07).
  pendingTitle: { bn: 'ভর্তির অপেক্ষায়', en: 'Waiting for admission' },
  pendingEmpty: { bn: 'কোনো অনুরোধ অপেক্ষায় নেই', en: 'No requests waiting' },
  pendingEmptyHint: {
    bn: 'অ্যাপ বা জরুরি বিভাগ থেকে বেডের অনুরোধ এলে এখানে দেখাবে।',
    en: 'Bed requests from the app or the emergency department appear here.',
  },
  pendingNeedsConnection: {
    bn: 'অনুরোধ দেখতে ও উত্তর দিতে সংযোগ লাগবে।',
    en: 'Requests need a connection to see and answer.',
  },
  pendingFromApp: { bn: 'অ্যাপ থেকে', en: 'From the app' },
  pendingArrives: { bn: '{time}-এ পৌঁছাবেন', en: 'Arriving {time}' },
  pendingHeld: { bn: '{bed} রাখা আছে {time} পর্যন্ত', en: '{bed} held until {time}' },
  pendingHold: { bn: 'বেড রাখুন', en: 'Hold a bed' },
  pendingHoldChoose: { bn: 'কোন {kind} বেড রাখবেন?', en: 'Hold which {kind} bed?' },
  pendingNoBedOfKind: { bn: 'এই ধরনের কোনো খালি বেড নেই', en: 'No free bed of this kind' },
  pendingDecline: { bn: 'ফিরিয়ে দিন', en: 'Decline' },
  pendingDeclineConsequence: {
    bn: '{name}-কে এসএমএসে জানানো হবে যে এখন বেড দেওয়া যাচ্ছে না।',
    en: '{name} will be told by SMS that a bed cannot be offered now.',
  },
  pendingAnswered: { bn: 'উত্তর পাঠানো হয়েছে', en: 'Answer sent' },
  pendingAnswerFailed: {
    bn: 'উত্তর পাঠানো যায়নি। আবার চেষ্টা করুন।',
    en: 'The answer could not be sent. Please try again.',
  },

  // LIST-B06-PENDING's ER half (FR-BED-07, BTN-B07-ADMIT).
  pendingFromEr: { bn: 'জরুরি বিভাগ থেকে', en: 'From the emergency department' },
  pendingErFor: { bn: '{kind} বেড চাই', en: 'Needs a {kind} bed' },
  pendingErSince: { bn: '{time} থেকে অপেক্ষায়', en: 'Waiting since {time}' },
  pendingErAdmit: { bn: 'বেডে ভর্তি করুন', en: 'Admit to a bed' },
  pendingErNameHint: {
    bn: 'জরুরি বিভাগ নাম নেয়নি। বেডে দেওয়ার সময় নাম ও ফোন নিন।',
    en: 'The ER did not take a name. Take the name and phone at the bed.',
  },

  // --- The ER console (S-B-07, APP_FLOW.md B4) -----------------------------
  roleEmergency: { bn: 'জরুরি বিভাগ', en: 'Emergency' },
  erSection: { bn: 'জরুরি বিভাগ', en: 'Emergency department' },
  openEr: { bn: 'জরুরি বিভাগ খুলুন', en: 'Open the emergency console' },
  erTitle: { bn: 'জরুরি বিভাগ', en: 'Emergency department' },
  // FR-EMG-04: counted from cases, and it says so.
  erLoad: { bn: 'এখন {count} জন', en: '{count} now' },
  erLoadHint: {
    bn: 'আসছেন ও জরুরি বিভাগে আছেন — গুনে বের করা, হাতে লেখা নয়।',
    en: 'On the way and in the ER — counted, never typed.',
  },

  // CARD-B07-<caseId> (FR-EMG-01).
  erInboundTitle: { bn: 'আসছেন', en: 'On the way' },
  erInboundEmpty: { bn: 'কেউ আসছেন বলে জানাননি', en: 'Nobody has said they are coming' },
  erInboundEmptyHint: {
    bn: 'অ্যাপে কেউ "আমি রওনা দিচ্ছি" চাপলে এখানে শব্দসহ দেখাবে।',
    en: 'When someone taps "I am on my way" in the app, it rings here.',
  },
  erNewAlert: { bn: 'নতুন', en: 'New' },
  erArrivesAt: { bn: 'আনুমানিক {time}-এ পৌঁছাবেন', en: 'Expected about {time}' },
  erNoEta: { bn: 'কখন পৌঁছাবেন জানা নেই', en: 'Arrival time unknown' },
  erAgeSex: { bn: '{age} বছর · {sex}', en: '{age} yrs · {sex}' },
  erNoDetails: { bn: 'বয়স ও লিঙ্গ জানানো হয়নি', en: 'Age and sex not given' },
  erPrepare: { bn: 'প্রস্তুতি নিন', en: 'Get ready' },
  erPrepared: { bn: 'প্রস্তুত — পরিবারকে জানানো হয়েছে', en: 'Ready — the family has been told' },
  erAccept: { bn: 'গ্রহণ করুন', en: 'Accept' },
  erAcceptHint: {
    bn: 'রোগী পৌঁছালে গ্রহণ করুন — টোকেন দেওয়া হবে।',
    en: 'Accept when they arrive — a token is given.',
  },
  erDecline: { bn: 'ফিরিয়ে দিন', en: 'Decline' },
  erDeclineTitle: { bn: 'কেন নিতে পারছেন না?', en: 'Why can you not take them?' },
  erDeclineReasonLabel: { bn: 'কারণ', en: 'Reason' },
  erDeclineConsequence: {
    bn: 'পরিবার জানবে আপনারা নিতে পারছেন না, আর অন্য হাসপাতাল খুঁজতে বলা হবে।',
    en: 'The family will be told you cannot take them, and to look elsewhere.',
  },
  erDeclineConfirm: { bn: 'ফিরিয়ে দিন ও জানান', en: 'Decline and tell them' },
  erSuggestTitle: { bn: 'কাছের অন্য জরুরি বিভাগ', en: 'Other emergency departments nearby' },
  erSuggestHint: {
    bn: 'রোগী পাঠানোর (রেফার) ব্যবস্থা পরের ধাপে আসছে। এখন ফোন করে জানান।',
    en: 'Sending a referral comes in a later step. For now, call them.',
  },
  erSuggestEmpty: {
    bn: 'কাছে এই চিকিৎসা আছে এমন অন্য জরুরি বিভাগ পাওয়া যায়নি।',
    en: 'No other emergency department nearby can treat this.',
  },
  erCall: { bn: 'ফোন করুন', en: 'Call' },
  erNoPhone: { bn: 'নম্বর দেননি', en: 'No number left' },
  erCallFailed: {
    bn: 'নম্বর আনা যায়নি — সংযোগ লাগবে।',
    en: 'Could not get the number — this needs a connection.',
  },

  // TBL-B07-TRIAGE (FR-EMG-03).
  erTriageTitle: { bn: 'জরুরি বিভাগে আছেন', en: 'In the ER' },
  erTriageEmpty: { bn: 'জরুরি বিভাগে এখন কেউ নেই', en: 'Nobody is in the ER' },
  erTriageEmptyHint: {
    bn: 'কেউ এলে "নতুন রোগী যোগ করুন" চাপুন, বা আসছেন তালিকা থেকে গ্রহণ করুন।',
    en: 'Tap "Add a patient" when someone walks in, or accept an arrival.',
  },
  erColToken: { bn: 'টোকেন', en: 'Token' },
  erColPatient: { bn: 'রোগী', en: 'Patient' },
  erColProblem: { bn: 'সমস্যা', en: 'Problem' },
  erColArrived: { bn: 'এসেছেন', en: 'Arrived' },
  erColTriage: { bn: 'ত্রিয়াজ', en: 'Triage' },
  erUntriaged: { bn: 'ত্রিয়াজ হয়নি', en: 'Not triaged' },
  erSetTriage: { bn: '{colour} করুন', en: 'Mark {colour}' },
  erTokenPending: { bn: 'টোকেন আসছে', en: 'Token pending' },
  erAdmit: { bn: 'ভর্তি করুন', en: 'Admit' },
  erAdmitTitle: { bn: 'কোন ধরনের বেডে?', en: 'Which kind of bed?' },
  erAdmitHint: {
    bn: 'ওয়ার্ড বোর্ডের অপেক্ষার তালিকায় যাবে। ওয়ার্ড বেড দেবে।',
    en: 'It goes on the ward board’s waiting list. The ward gives the bed.',
  },
  erHandedOff: { bn: 'ওয়ার্ডে পাঠানো — {kind} বেড', en: 'With the ward — {kind} bed' },
  erDischarge: { bn: 'ছেড়ে দিন', en: 'Discharge' },
  erDischargeConfirm: {
    bn: '{token}-কে জরুরি বিভাগ থেকে ছেড়ে দেবেন?',
    en: 'Discharge {token} from the ER?',
  },

  // Walk-in registration (POST /emergency/cases).
  erWalkIn: { bn: 'নতুন রোগী যোগ করুন', en: 'Add a patient' },
  erWalkInTitle: { bn: 'যিনি সরাসরি এসেছেন', en: 'Someone who walked in' },
  erWalkInProblem: { bn: 'কী হয়েছে?', en: 'What happened?' },
  erWalkInTriage: { bn: 'ত্রিয়াজ (পরেও দেওয়া যায়)', en: 'Triage (can be set later)' },
  erWalkInPhone: { bn: 'ফোন (ঐচ্ছিক)', en: 'Phone (optional)' },
  erWalkInAge: { bn: 'বয়স (ঐচ্ছিক)', en: 'Age (optional)' },
  erWalkInSave: { bn: 'যোগ করুন', en: 'Add' },

  // SW-B07-<capability> (FR-EMG-05).
  erCapabilitiesTitle: { bn: 'আমরা এখন কী নিতে পারি', en: 'What we can take now' },
  erCapabilitiesHint: {
    bn: 'এখানে যা চালু, রোগীরা অ্যাপে তাই দেখেন।',
    en: 'What is switched on here is what patients see in the app.',
  },
  erCapabilitiesConfirm: { bn: 'সব ঠিক আছে — নিশ্চিত করুন', en: 'All correct — confirm' },
  erCapabilityOn: { bn: 'চালু', en: 'On' },
  erCapabilityOff: { bn: 'বন্ধ', en: 'Off' },
  erCapabilitiesNone: {
    bn: 'এই হাসপাতালের কোনো সক্ষমতা ঘোষণা করা নেই।',
    en: 'This hospital has declared no capabilities.',
  },

  // "ICU/bed counters — read from the bed board, not typed twice."
  erBedsTitle: { bn: 'বেড (বেড বোর্ড থেকে)', en: 'Beds (from the bed board)' },

  // The alarm (CARD-B07: "audible + visual alert on arrival").
  erSoundOn: { bn: 'শব্দ চালু', en: 'Sound on' },
  erSoundEnable: { bn: 'সতর্কসংকেতের শব্দ চালু করুন', en: 'Turn on the alert sound' },
  erSoundBlocked: {
    bn: 'ব্রাউজার শব্দ বন্ধ রেখেছে। একবার চাপলে চালু হবে।',
    en: 'The browser has muted the alert. Tap once to turn it on.',
  },

  // Offline (FR-OFF-01).
  erOffline: {
    bn: 'সংযোগ নেই — নতুন "আসছি" বার্তা এখন আসবে না। ত্রিয়াজ, নতুন রোগী আর সক্ষমতা চলবে, পরে পাঠানো হবে।',
    en: 'No connection — new "on my way" alerts cannot arrive. Triage, walk-ins and capabilities keep working and are sent later.',
  },
  erRefused: {
    bn: 'সার্ভার এই কাজটি নেয়নি — তালিকা হালনাগাদ করা হয়েছে।',
    en: 'The server did not accept that — the list has been updated.',
  },
  erColActions: { bn: 'কাজ', en: 'Actions' },
  erDistanceKm: { bn: '{km} কিমি', en: '{km} km' },
  // BTN-A10C-CANCEL reaches the ER: the family is not coming.
  erFamilyCancelled: {
    bn: 'পরিবার জানিয়েছে তাঁরা আসছেন না ({problem})।',
    en: 'The family says they are not coming ({problem}).',
  },

  // --- Demo mode (FR-DEM-07, CLAUDE.md §1.1) -------------------------------
  demoBanner: {
    bn: 'এটি একটি ডেমো। সব তথ্য প্রদর্শনের জন্য তৈরি।',
    en: 'This is a demonstration. All data here is for display only.',
  },
} as const satisfies Record<string, Message>;

export type ConsoleKey = keyof typeof CONSOLE;

/**
 * Patient copy (`APP_FLOW.md` Part A).
 *
 * Written for somebody standing in a corridor on a cheap phone, often not
 * reading carefully. Short sentences, no clinical vocabulary the person did
 * not use first, and every number they might act on carries its own label
 * rather than relying on position.
 */
export const PATIENT = {
  // --- Home (S-A-02) -------------------------------------------------------
  appName: { bn: 'স্বাস্থ্যসেবা', en: 'Healthcare' },
  findDoctor: { bn: 'ডাক্তার খুঁজুন', en: 'Find a doctor' },
  findHospital: { bn: 'হাসপাতাল খুঁজুন', en: 'Find a hospital' },
  emergency: { bn: 'জরুরি', en: 'Emergency' },
  // `BTN-A10-999` — "tel:999 immediately; always visible at top"
  // (`APP_FLOW.md` A6). The one emergency action this version can honestly
  // offer, so the red card on Home leads to something that works.
  call999: { bn: '৯৯৯ এ কল করুন', en: 'Call 999' },
  call999Line: {
    bn: 'বুকে ব্যথা, প্রচণ্ড রক্তপাত, শ্বাস নিতে না পারা বা অচেতন হলে আগে ৯৯৯ এ কল করুন।',
    en: 'Chest pain, heavy bleeding, trouble breathing or unconsciousness: call 999 first.',
  },
  emergencyLine: {
    bn: 'কাছের হাসপাতালে জায়গা আছে কিনা এখনই দেখুন।',
    en: 'See which nearby hospital has room, right now.',
  },
  mySerials: { bn: 'আমার সিরিয়াল', en: 'My serials' },

  // --- Bottom navigation (NAV-A, APP_FLOW.md S-A-02) ------------------------
  navHome: { bn: 'হোম', en: 'Home' },
  navSerials: { bn: 'সিরিয়াল', en: 'Serials' },
  navRecords: { bn: 'রেকর্ড', en: 'Records' },
  navProfile: { bn: 'প্রোফাইল', en: 'Profile' },

  // --- Home (S-A-02) --------------------------------------------------------
  seeADoctor: { bn: 'ডাক্তার দেখান', en: 'See a doctor' },
  seeADoctorSub: { bn: 'কোন সমস্যার জন্য দেখাবেন?', en: 'What do you need to be seen for?' },
  quickBed: { bn: 'বেড', en: 'Beds' },
  quickAmbulance: { bn: 'অ্যাম্বুলেন্স', en: 'Ambulance' },
  quickBlood: { bn: 'রক্ত', en: 'Blood' },
  quickReport: { bn: 'রিপোর্ট', en: 'Reports' },
  activeSerialTitle: { bn: 'আজকের সিরিয়াল চলছে', en: 'Your serial today' },
  activeSerialMeta: { bn: '{doctor} · এখন চলছে {serving}', en: '{doctor} · now serving {serving}' },
  doctorsHere: { bn: '{count} জন ডাক্তার', en: '{count} doctors' },

  // --- Hospitals for a specialty (S-A-07) -----------------------------------
  chooseHospitalFirst: { bn: 'কোথায় দেখাবেন?', en: 'Where would you like to be seen?' },
  hospitalsOffering: { bn: '{specialty} আছে যেসব জায়গায়', en: 'Places offering {specialty}' },
  sittingNowCount: { bn: '{count} জন এখন বসছেন', en: '{count} sitting now' },
  nobodySittingNow: { bn: 'এখন কেউ বসছেন না', en: 'Nobody is sitting right now' },
  serialsOpenToday: { bn: 'আজ {count}টি সিরিয়াল খালি', en: '{count} serials open today' },
  noHospitals: {
    bn: 'এই বিভাগে এখন কোনো হাসপাতাল পাওয়া যায়নি।',
    en: 'No hospital offers this department right now.',
  },

  // --- Doctors at a hospital (S-A-05h) --------------------------------------
  chooseDoctor: { bn: 'কোন ডাক্তার?', en: 'Which doctor?' },
  inChamberNow: { bn: 'এখন চেম্বারে আছেন', en: 'In the chamber now' },
  nextSitting: { bn: 'বসবেন {time}', en: 'Sitting at {time}' },
  notSittingSoon: { bn: 'আগামী দিনে সময় নেই', en: 'No upcoming chamber' },
  serialsLeft: { bn: '{count}টি সিরিয়াল বাকি', en: '{count} serials left' },
  noDoctorsHere: {
    bn: 'এই হাসপাতালে এই বিভাগে কেউ নেই।',
    en: 'Nobody sits in this department here.',
  },
  bookHere: { bn: 'সিরিয়াল নিন', en: 'Book' },
  back: { bn: 'পিছনে', en: 'Back' },

  // --- My serials (S-A-09) --------------------------------------------------
  serialsToday: { bn: 'আজ', en: 'Today' },
  serialsUpcoming: { bn: 'আসছে', en: 'Upcoming' },
  serialsPast: { bn: 'আগের', en: 'Past' },
  noSerials: {
    bn: 'এখনো কোনো সিরিয়াল নেই। ডাক্তার দেখাতে হোম থেকে শুরু করুন।',
    en: 'No serials yet. Start from home to see a doctor.',
  },
  openSerial: { bn: 'লাইভ দেখুন', en: 'See it live' },
  serialsOnThisDevice: {
    bn: 'এই ফোনে নেওয়া সিরিয়াল। অ্যাকাউন্ট খুললে সব ফোনে দেখা যাবে।',
    en: 'Serials booked on this phone. An account shows them on every device.',
  },

  // --- S-A-12 health wallet (FR-PAT-60..65) --------------------------------
  noRecordsYet: {
    bn: 'এখনো কোনো রেকর্ড নেই। ডাক্তার দেখানোর পর এখানে জমা হবে।',
    en: 'No records yet. They collect here after a visit.',
  },
  recordsAfterVisit: {
    bn: '{count}টি সিরিয়াল নেওয়া আছে। ডাক্তার দেখানোর পর রেকর্ড এখানে আসবে।',
    en: '{count} booked. The record appears here after the visit.',
  },
  recordsPending: {
    bn: 'আরও {count}টি সিরিয়াল আছে, এখনো দেখানো হয়নি।',
    en: '{count} more booked, not yet seen.',
  },
  followUpOn: { bn: 'আবার দেখাবেন {date}', en: 'Follow up on {date}' },
  recordsExpiredLinks: {
    bn: '{count}টি পুরোনো সিরিয়ালের লিংকের মেয়াদ শেষ, তাই সেগুলোর রেকর্ড এই ফোন থেকে আর খোলা যাচ্ছে না।',
    en: 'The links for {count} older serials have expired, so their records no longer open from this phone.',
  },
  recordsPartlyFailed: {
    bn: '{count}টি রেকর্ড আনা যায়নি।',
    en: '{count} records could not be loaded.',
  },
  recordsOffline: {
    bn: 'ইন্টারনেট সংযোগ নেই। রেকর্ড খুলতে সংযোগ লাগবে।',
    en: 'No internet connection. Records need a connection to open.',
  },

  // BTN-A12-QR and BTN-A12-ACCESS (FR-PAT-63, FR-PAT-64).
  walletShare: { bn: 'ডাক্তারকে আগের রেকর্ড দেখান', en: 'Let a doctor see your records' },
  walletPatient: { bn: 'রোগী: {name}', en: 'Patient: {name}' },
  showCode: { bn: 'কোড দেখান', en: 'Show code' },
  whoLooked: { bn: 'কে দেখেছে', en: 'Who has looked' },
  consentCodeTitle: { bn: 'ডাক্তারকে এই কোডটি দিন', en: 'Give the doctor this code' },
  // "Shows consent scope and expiry" (APP_FLOW.md S-A-12), before anything is
  // handed over. The hours come from the server, never from this sentence.
  consentScope: {
    bn: 'ডাক্তার কোডটি দিলে তাঁর হাসপাতাল {hours} ঘণ্টা আপনার আগের রেকর্ড দেখতে পারবে। "কে দেখেছে" থেকে যেকোনো সময় বন্ধ করতে পারবেন।',
    en: 'Once the doctor enters it, their hospital can read your earlier records for {hours} hours. You can stop that any time from "Who has looked".',
  },
  consentCodeExpiresIn: {
    bn: 'কোডটি আর {seconds} সেকেন্ড কাজ করবে',
    en: 'This code works for {seconds} more seconds',
  },
  consentCodeExpired: {
    bn: 'কোডের মেয়াদ শেষ। নতুন কোড নিন।',
    en: 'This code has expired. Get a new one.',
  },
  newCode: { bn: 'নতুন কোড', en: 'New code' },
  copyCode: { bn: 'কোড কপি করুন', en: 'Copy code' },
  copied: { bn: 'কপি হয়েছে', en: 'Copied' },
  close: { bn: 'বন্ধ করুন', en: 'Close' },

  grantsTitle: { bn: 'যে হাসপাতালকে অনুমতি দিয়েছেন', en: 'Hospitals you have given access' },
  noGrants: {
    bn: 'কোনো হাসপাতালকে রেকর্ড দেখার অনুমতি দেওয়া হয়নি।',
    en: 'You have not given any hospital access to your records.',
  },
  grantLive: { bn: 'চালু', en: 'Open' },
  grantLiveUntil: { bn: '{time} পর্যন্ত চালু', en: 'Open until {time}' },
  grantRevoked: { bn: 'বন্ধ করা হয়েছে', en: 'Stopped' },
  grantExpired: { bn: 'মেয়াদ শেষ', en: 'Expired' },
  revokeGrant: { bn: 'অনুমতি বন্ধ করুন', en: 'Stop access' },
  revokeFailed: { bn: 'বন্ধ করা যায়নি। আবার চেষ্টা করুন।', en: 'Could not stop it. Try again.' },
  viewsTitle: { bn: 'যাঁরা রেকর্ড দেখেছেন', en: 'Who has read your records' },
  noViews: {
    bn: 'এখনো কোনো হাসপাতালের কেউ আপনার রেকর্ড দেখেননি।',
    en: 'Nobody at a hospital has read your records yet.',
  },
  hospitalStaff: { bn: 'হাসপাতালের কর্মী', en: 'Hospital staff' },
  recordsOnThisDevice: {
    bn: 'এই ফোনে নেওয়া সিরিয়ালের রেকর্ড। অ্যাকাউন্ট খুললে সব এক জায়গায় থাকবে।',
    en: 'Records from serials booked on this phone. An account keeps them in one place.',
  },
  // `PRD.md` §3.2: an empty Reports tab would be a claim about the patient's
  // health. This is a claim about the build, which is the true one.
  walletAbsent: {
    bn: 'টেস্টের রিপোর্ট, ব্যবস্থাপত্র, পুরোনো কাগজ যোগ করা আর পিডিএফ ডাউনলোড — এগুলো এখনো তৈরি হয়নি।',
    en: 'Test reports, prescriptions, adding old paper records and PDF download are not built yet.',
  },

  // --- Tabs not built in this version --------------------------------------
  comingSoon: { bn: 'শীঘ্রই আসছে', en: 'Coming soon' },
  profileComing: {
    bn: 'অ্যাকাউন্ট আর প্রোফাইল এখনো তৈরি হয়নি। সিরিয়াল নিতে অ্যাকাউন্ট লাগে না।',
    en: 'Accounts are not built yet. Booking a serial needs no account.',
  },
  // --- Bed search (S-A-11, FR-PAT-50..52) -----------------------------------
  bedsTitle: { bn: 'বেড খুঁজুন', en: 'Find a bed' },
  bedsChooseKind: { bn: 'কোন ধরনের বেড লাগবে?', en: 'What kind of bed?' },
  bedsFree: { bn: '{free}টি খালি', en: '{free} free' },
  bedsNoneFree: { bn: 'এখন খালি নেই', en: 'None free now' },
  bedsOfTotal: { bn: 'মোট {total}টি', en: 'of {total}' },
  bedsNightly: { bn: 'প্রতি রাত {price}', en: '{price} a night' },
  bedsNightlyRange: { bn: 'প্রতি রাত {min}–{max}', en: '{min}–{max} a night' },
  bedsNoHospitals: {
    bn: 'তালিকার কোনো হাসপাতালে এই ধরনের বেড নেই।',
    en: 'No listed hospital has this kind of bed.',
  },
  bedsNoHospitalsHint: {
    bn: 'অন্য ধরন বেছে দেখুন, অথবা জরুরি অবস্থায় ৯৯৯-এ কল করুন।',
    en: 'Try another kind, or call 999 in an emergency.',
  },
  bedsHowItWorks: {
    bn: 'সংখ্যাগুলো হাসপাতালের ওয়ার্ড থেকে আসে, আর প্রতিটির পাশে লেখা থাকে কখন শেষবার নিশ্চিত করা হয়েছে।',
    en: 'These numbers come from each ward, and each says when it was last confirmed.',
  },
  bedsStaleCaution: {
    bn: 'এই সংখ্যা অনেকক্ষণ নিশ্চিত হয়নি — যাওয়ার আগে হাসপাতালে ফোন করুন।',
    en: 'This has not been confirmed for a while — call the hospital before you go.',
  },
  bedsOfflineCached: {
    bn: 'ইন্টারনেট নেই — শেষবার পাওয়া সংখ্যা দেখানো হচ্ছে, এখন বদলে থাকতে পারে।',
    en: 'No internet — showing the last numbers received; they may have changed.',
  },

  requestBed: { bn: 'বেড অনুরোধ করুন', en: 'Request a bed' },
  requestTitle: { bn: '{hospital}-এ {kind} বেড', en: '{kind} bed at {hospital}' },
  requestNotAHold: {
    bn: 'অনুরোধ মানে বেড রাখা নয়। হাসপাতাল বেড রাখলে এসএমএসে জানানো হবে।',
    en: 'A request does not reserve a bed. You will be told by SMS if the hospital holds one.',
  },
  requestArrival: { bn: 'কখন পৌঁছাবেন?', en: 'When will you arrive?' },
  requestArrivalIn: { bn: '{minutes} মিনিটের মধ্যে', en: 'Within {minutes} min' },
  requestNote: { bn: 'রোগীর অবস্থা (ইচ্ছা হলে লিখুন)', en: 'Condition (optional)' },
  requestSend: { bn: 'অনুরোধ পাঠান', en: 'Send the request' },
  requestMobileHelper: {
    bn: 'হাসপাতালের উত্তর এই নম্বরে এসএমএসে যাবে।',
    en: "The hospital's answer is sent to this number by SMS.",
  },
  requestFillAll: {
    bn: 'রোগীর নাম, মোবাইল নম্বর, বয়স ও লিঙ্গ দিন।',
    en: "Give the patient's name, mobile number, age and sex.",
  },
  yourRequests: { bn: 'আপনার অনুরোধ', en: 'Your requests' },
  requestFailed: { bn: 'অনুরোধ পাঠানো যায়নি', en: 'The request could not be sent' },
  requestKindNotHere: {
    bn: 'এই হাসপাতালে এই ধরনের বেড নেই।',
    en: 'This hospital does not have this kind of bed.',
  },
  requestStatus: { bn: 'বেডের অনুরোধ', en: 'Bed request' },
  requestStateRequested: { bn: 'অনুরোধ পাঠানো হয়েছে', en: 'Request sent' },
  requestStateHeld: {
    bn: 'গৃহীত — আপনার জন্য বেড রাখা আছে',
    en: 'Accepted — a bed is held for you',
  },
  requestStateConfirmed: { bn: 'নিশ্চিত — ভর্তি হয়েছেন', en: 'Confirmed — admitted' },
  requestStateDeclined: {
    bn: 'এই হাসপাতাল এখন বেড দিতে পারছে না',
    en: 'This hospital cannot offer a bed right now',
  },
  requestStateExpired: {
    bn: 'রাখার সময় শেষ, বেডটি ছেড়ে দেওয়া হয়েছে',
    en: 'The hold ran out and the bed was released',
  },
  requestWaitingExplainer: {
    bn: 'হাসপাতাল উত্তর দিলে এখানে ও এসএমএসে জানানো হবে।',
    en: 'You will see the answer here and by SMS.',
  },
  requestHeldUntil: { bn: '{time} পর্যন্ত রাখা', en: 'Held until {time}' },
  requestHoldLeft: { bn: 'আর {minutes} মিনিট', en: '{minutes} min left' },
  requestCallHospital: { bn: 'হাসপাতালে কল করুন', en: 'Call the hospital' },
  requestSeeOthers: { bn: 'অন্য হাসপাতাল দেখুন', en: 'See other hospitals' },
  requestLinkInvalid: {
    bn: 'এই লিংকটি আর কাজ করছে না।',
    en: 'This link no longer works.',
  },
  requestCheckedAt: { bn: 'দেখা হয়েছে {time}', en: 'Checked {time}' },

  // --- Beds on a hospital card (FR-PAT-14) ----------------------------------
  cardBedsFree: { bn: 'খালি বেড {free}', en: '{free} beds free' },
  cardIcu: { bn: 'আইসিইউ {free}/{total}', en: 'ICU {free}/{total}' },
  cardNoIcu: { bn: 'আইসিইউ নেই', en: 'No ICU' },
  cardNoBeds: { bn: 'ভর্তির ব্যবস্থা নেই', en: 'No inpatient beds' },
  ambulanceComing: {
    bn: 'কাছের অ্যাম্বুলেন্স ডাকা আর ভাড়া দেখা এখানে আসবে। এখন জরুরি প্রয়োজনে ৯৯৯ এ কল করুন।',
    en: 'Calling a nearby ambulance and seeing the fare will come here. For now, call 999 in an emergency.',
  },
  bloodComing: {
    bn: 'রক্তের গ্রুপ ধরে ব্লাড ব্যাংক আর ডোনার খোঁজা এখানে আসবে।',
    en: 'Searching blood banks and donors by group will come here.',
  },

  // --- Emergency (S-A-10, S-A-10b, S-A-10c; FR-PAT-40..47) ------------------
  //
  // Written for P6: panicked, one-handed, possibly in a moving car. One
  // question per screen, the biggest control first, and nothing asked that
  // the emergency does not need (`FR-GST-03`).
  emergencyTitle: { bn: 'জরুরি অবস্থা', en: 'Emergency' },
  // FR-PAT-41: the entry splits critical and urgent (owner's ruling,
  // 2026-09-21: two buttons under the call).
  emergencyCritical: { bn: 'জীবন ঝুঁকিতে', en: 'Life in danger' },
  emergencyCriticalLine: {
    bn: 'সবচেয়ে কাছের জরুরি বিভাগ, এখনই।',
    en: 'The nearest emergency department, now.',
  },
  emergencyUrgent: { bn: 'জরুরি', en: 'Urgent' },
  emergencyUrgentLine: {
    bn: 'কী হয়েছে বলুন — চিকিৎসা আছে এমন হাসপাতাল দেখাব।',
    en: 'Say what happened — we show hospitals that can treat it.',
  },
  emergencyWhatHappened: { bn: 'কী হয়েছে?', en: 'What happened?' },
  emergencyAmbulance: { bn: 'অ্যাম্বুলেন্স ডাকুন', en: 'Call an ambulance' },

  // Where the phone is. The browser asks; nothing is stored.
  emergencyLocating: { bn: 'আপনার অবস্থান দেখা হচ্ছে', en: 'Finding where you are' },
  emergencyNoLocation: {
    bn: 'অবস্থান জানা যায়নি, তাই দূরত্ব ও সময় দেখানো যাচ্ছে না। হাসপাতালগুলো চিকিৎসা আর ভিড় অনুযায়ী সাজানো।',
    en: 'Your location is unknown, so distance and time cannot be shown. Hospitals are ordered by treatment and how busy they are.',
  },
  emergencyTryLocation: { bn: 'অবস্থান দিন', en: 'Share location' },

  // S-A-10b results (FR-PAT-43, FR-PAT-44).
  emergencyResultsFor: { bn: '{problem} — কাছের হাসপাতাল', en: '{problem} — nearby hospitals' },
  emergencyNearestTitle: { bn: 'কাছের জরুরি বিভাগ', en: 'Emergency departments nearby' },
  // Not "nearest": the first result is ranked, and a nearer hospital whose
  // data is stale can sit below it (FR-PAT-45). The heading claims only what
  // the ranking decided.
  emergencyNearestCapable: {
    bn: '{problem} চিকিৎসার জন্য এখন সবচেয়ে উপযুক্ত',
    en: 'Best placed to treat {problem} now',
  },
  emergencyBestNow: {
    bn: 'এখন সবচেয়ে উপযুক্ত জরুরি বিভাগ',
    en: 'Best placed emergency department now',
  },
  emergencyOtherHospitals: { bn: 'অন্যান্য হাসপাতাল', en: 'Other hospitals' },
  emergencyCapable: { bn: 'চিকিৎসা আছে', en: 'Can treat' },
  emergencyNotCapable: { bn: 'চিকিৎসা নেই', en: 'Cannot treat' },
  emergencyDistance: { bn: '{km} কিমি', en: '{km} km' },
  emergencyTravel: { bn: 'আনুমানিক {minutes} মিনিট', en: 'About {minutes} min' },
  emergencyLoad: { bn: 'জরুরি বিভাগে এখন {count} জন', en: '{count} in the ER now' },
  emergencyFreeBeds: { bn: 'খালি বেড {free}', en: '{free} beds free' },
  emergencyFreeKind: { bn: '{kind} বেড খালি {free}', en: '{free} {kind} beds free' },
  emergencyNoKind: { bn: '{kind} বেড নেই', en: 'No {kind} beds' },
  emergencyNoBeds: { bn: 'ভর্তির ব্যবস্থা নেই', en: 'No inpatient beds' },
  emergencyStale: { bn: 'তথ্য {time} মিনিট পুরোনো', en: 'Data {time} minutes old' },
  emergencyNeverConfirmed: {
    bn: 'তথ্য কখনো নিশ্চিত করা হয়নি',
    en: 'Never confirmed',
  },
  emergencyNoResults: {
    bn: 'কাছাকাছি কোনো জরুরি বিভাগ পাওয়া যায়নি। এখনই ৯৯৯ এ কল করুন।',
    en: 'No emergency department found nearby. Call 999 now.',
  },
  emergencyOnWay: { bn: 'আমি রওনা দিচ্ছি', en: 'I am on my way' },
  emergencyDirections: { bn: 'দিকনির্দেশ', en: 'Directions' },
  emergencyCallEr: { bn: 'কল করুন', en: 'Call' },
  emergencyOffline: {
    bn: 'ইন্টারনেট নেই। নিচে শেষবার দেখা তালিকা — এখনই ৯৯৯ বা হাসপাতালে সরাসরি কল করুন।',
    en: 'No internet. Below is the list as last seen — call 999 or the hospital directly now.',
  },
  emergencyOfflineNoList: {
    bn: 'ইন্টারনেট নেই। এখনই ৯৯৯ এ কল করুন।',
    en: 'No internet. Call 999 now.',
  },

  // BTN-A10-ONWAY: nothing is required (APP_FLOW.md A1.4).
  onWayTitle: { bn: '{hospital}-কে জানাব', en: 'We will tell {hospital}' },
  onWayOptional: {
    bn: 'নিচের কিছু না দিলেও হাসপাতালকে জানানো হবে।',
    en: 'The hospital is told even if you leave all of this blank.',
  },
  onWayPhone: { bn: 'ফোন নম্বর — হাসপাতাল ফোন করতে পারবে', en: 'Phone — so the hospital can call' },
  onWayAge: { bn: 'রোগীর বয়স', en: 'Patient’s age' },
  onWaySend: { bn: 'জানান ও রওনা দিন', en: 'Tell them and go' },
  onWayNotifying: { bn: 'জানানো হচ্ছে', en: 'Telling them' },
  onWayNotified: { bn: 'জানানো হয়েছে', en: 'They have been told' },
  onWayFailed: {
    bn: 'হাসপাতালকে জানানো যায়নি। রওনা দিন আর ফোন করে জানান।',
    en: 'The hospital could not be told. Go, and call them on the way.',
  },

  // S-A-10c On the way.
  onWayScreenTitle: { bn: 'পথে আছেন', en: 'On the way' },
  onWayWaiting: { bn: 'হাসপাতালের উত্তরের অপেক্ষায়', en: 'Waiting for the hospital' },
  onWayReady: { bn: 'হাসপাতাল প্রস্তুত', en: 'The hospital is ready' },
  onWayReadyLine: {
    bn: '{hospital} জরুরি বিভাগ আপনার জন্য প্রস্তুত।',
    en: '{hospital} emergency department is ready for you.',
  },
  onWayDeclined: { bn: 'হাসপাতাল এখন নিতে পারছে না', en: 'The hospital cannot take you now' },
  onWayDeclinedReason: { bn: 'কারণ: {reason}', en: 'Reason: {reason}' },
  onWayFindAnother: { bn: 'অন্য হাসপাতাল দেখুন', en: 'See other hospitals' },
  onWayCancelled: { bn: 'যাত্রা বাতিল করা হয়েছে', en: 'You called this off' },
  onWayArrived: { bn: 'জরুরি বিভাগ আপনাকে গ্রহণ করেছে', en: 'The ER has received you' },
  onWayEta: { bn: 'আনুমানিক {minutes} মিনিটে পৌঁছাবেন', en: 'About {minutes} minutes away' },
  onWayNavigate: { bn: 'নেভিগেশন খুলুন', en: 'Open navigation' },
  onWayCallEr: { bn: 'জরুরি বিভাগে কল করুন', en: 'Call the ER' },
  onWayCancel: { bn: 'যাচ্ছি না — বাতিল করুন', en: 'Not coming — call it off' },
  onWayCancelConfirm: {
    bn: 'বাতিল করলে হাসপাতাল আপনার জন্য প্রস্তুতি বন্ধ করবে।',
    en: 'If you call this off, the hospital stops getting ready for you.',
  },
  onWayKeep: { bn: 'না, যাচ্ছি', en: 'No, I am going' },
  onWayLinkExpired: {
    bn: 'এই লিংকের মেয়াদ শেষ। দরকার হলে আবার জরুরি অবস্থা থেকে শুরু করুন।',
    en: 'This link has expired. Start again from Emergency if you need to.',
  },

  // --- Specialties and results (S-A-07) ------------------------------------
  chooseSpecialty: { bn: 'কোন বিভাগ?', en: 'Which department?' },
  doctorsAvailable: { bn: 'ডাক্তার পাওয়া যাচ্ছে', en: 'doctors available' },
  searchPlaceholder: { bn: 'ডাক্তার বা হাসপাতালের নাম', en: 'Doctor or hospital name' },
  noResults: { bn: 'কিছু পাওয়া যায়নি', en: 'Nothing found' },
  verified: { bn: 'যাচাই করা', en: 'Verified' },

  // --- Session picker (S-A-07b) --------------------------------------------
  chooseTime: { bn: 'কখন দেখাবেন?', en: 'When would you like to be seen?' },
  serialsTaken: { bn: 'সিরিয়াল নেওয়া হয়েছে', en: 'serials taken' },
  seatsLeft: { bn: 'বাকি আছে', en: 'left' },
  sessionFull: { bn: 'পূর্ণ', en: 'Full' },
  expectedWait: { bn: 'আনুমানিক অপেক্ষা', en: 'Expected wait' },
  waitUnknown: { bn: 'এখনো বলা যাচ্ছে না', en: 'Not known yet' },
  noSessions: { bn: 'আগামী সাত দিনে কোনো চেম্বার নেই', en: 'No chambers in the next seven days' },
  continue: { bn: 'এগিয়ে যান', en: 'Continue' },

  // --- Confirm (S-A-07c) ---------------------------------------------------
  confirmTitle: { bn: 'সিরিয়াল নিশ্চিত করুন', en: 'Confirm your serial' },
  yourDetails: { bn: 'আপনার তথ্য', en: 'Your details' },
  patientName: { bn: 'রোগীর নাম', en: 'Patient name' },
  mobileNumber: { bn: 'মোবাইল নম্বর', en: 'Mobile number' },
  mobileHelper: {
    bn: 'সিরিয়ালের খবর আর রসিদ এই নম্বরে যাবে।',
    en: 'Serial updates and the receipt go to this number.',
  },
  mobileInvalid: { bn: '১১ সংখ্যার মোবাইল নম্বর দিন', en: 'Enter an 11-digit mobile number' },
  age: { bn: 'বয়স', en: 'Age' },
  sex: { bn: 'লিঙ্গ', en: 'Sex' },
  male: { bn: 'পুরুষ', en: 'Male' },
  female: { bn: 'মহিলা', en: 'Female' },
  other: { bn: 'অন্যান্য', en: 'Other' },
  reason: { bn: 'কী সমস্যা? (ঐচ্ছিক)', en: 'What is the problem? (optional)' },

  // --- Fees (FR-PAT-21) ----------------------------------------------------
  feeConsultation: { bn: 'ডাক্তারের ফি', en: 'Consultation' },
  feePlatform: { bn: 'সেবা ফি', en: 'Service fee' },
  feeTotal: { bn: 'মোট', en: 'Total' },
  feeDueAtHospital: { bn: 'হাসপাতালে দিতে হবে', en: 'Due at the hospital' },
  payWith: { bn: 'কীভাবে দেবেন?', en: 'How will you pay?' },
  payBkash: { bn: 'বিকাশ', en: 'bKash' },
  payNagad: { bn: 'নগদ', en: 'Nagad' },
  payCard: { bn: 'কার্ড', en: 'Card' },
  payAtHospital: { bn: 'হাসপাতালে দেব', en: 'Pay at the hospital' },
  confirmBooking: { bn: 'নিশ্চিত করুন', en: 'Confirm' },

  // --- Success (S-A-07d) ---------------------------------------------------
  bookingDone: { bn: 'সিরিয়াল নেওয়া হয়েছে', en: 'Your serial is booked' },
  yourSerial: { bn: 'আপনার সিরিয়াল', en: 'Your serial' },
  smsSent: {
    bn: 'বিস্তারিত এসএমএসে পাঠানো হয়েছে। ওই লিংক থেকে সিরিয়াল সরাসরি দেখতে পারবেন।',
    en: 'The details have been sent by SMS. That link shows your serial live.',
  },
  viewLiveSerial: { bn: 'লাইভ সিরিয়াল দেখুন', en: 'See my live serial' },
  backHome: { bn: 'হোমে ফিরুন', en: 'Back to home' },

  // --- Live serial (S-A-08, FR-PAT-30…37) -----------------------------------
  //
  // The screen the product is for. Every line here is written to be read once,
  // at a glance, by somebody standing up in a corridor — so the sentences are
  // short and every one of them says a thing that can be acted on.
  liveSerialTitle: { bn: 'আপনার সিরিয়াল', en: 'Your serial' },
  nowServing: { bn: 'এখন চলছে', en: 'Now serving' },
  nobodyCalledYet: { bn: 'এখনো কাউকে ডাকা হয়নি', en: 'Nobody has been called yet' },
  sessionProgress: { bn: 'সেশনের অগ্রগতি', en: 'Progress through the session' },
  estimatedTime: { bn: 'আনুমানিক সময়', en: 'Estimated time' },

  // FR-QUE-13: a time with a band, never false precision. `{time}` is the
  // clock reading and `{band}` the half-width in minutes. No "আনুমানিক" here —
  // the label beside it already says আনুমানিক সময়, and saying it twice reads
  // like a string that was written without looking at the screen.
  etaWithBand: { bn: '{time} · ±{band} মিনিট', en: '{time} · ±{band} min' },
  etaUnknown: { bn: 'এখনো বলা যাচ্ছে না', en: 'Not known yet' },
  countdown: { bn: 'আর বাকি প্রায় {minutes} মিনিট', en: 'About {minutes} min to go' },
  patientsAhead: { bn: 'আপনার আগে {count} জন', en: '{count} ahead of you' },
  youAreNext: { bn: 'আপনিই পরবর্তী', en: 'You are next' },

  // --- Doctor status line (FR-PAT-30) ---------------------------------------
  doctorNotArrived: { bn: 'ডাক্তার এখনো আসেননি', en: 'The doctor has not arrived yet' },
  doctorArrivedAt: { bn: 'ডাক্তার এসেছেন {time}', en: 'The doctor arrived at {time}' },
  doctorDelayed: { bn: '{minutes} মিনিট দেরি', en: '{minutes} min late' },
  sessionPaused: { bn: 'চেম্বারে বিরতি চলছে', en: 'The chamber is on a break' },
  sessionEnded: { bn: 'আজকের চেম্বার শেষ', en: "Today's chamber has finished" },

  // --- Called takeover (EVT-PATIENT_CALLED) ---------------------------------
  yourTurn: { bn: 'আপনার ডাক এসেছে', en: 'You have been called' },
  goToRoom: { bn: '{room} নম্বর কক্ষে যান', en: 'Go to room {room}' },
  goToChamber: { bn: 'ডাক্তারের কক্ষে যান', en: 'Go to the chamber' },
  acknowledge: { bn: 'বুঝেছি', en: 'Got it' },

  // --- Leave-home banner (BANNER-A08-LEAVE, FR-PAT-32) ----------------------
  leaveNow: {
    bn: 'এখন রওনা দিন। পৌঁছাতে প্রায় {minutes} মিনিট লাগবে।',
    en: 'Leave now. It takes about {minutes} min to get there.',
  },

  // --- Queue preview (LIST-A08-QUEUE) ---------------------------------------
  queuePreview: { bn: 'সিরিয়ালের অবস্থা', en: 'The queue' },
  youMarker: { bn: 'আপনি', en: 'You' },
  inChamber: { bn: 'চেম্বারে', en: 'In the chamber' },
  waitingHere: { bn: 'অপেক্ষায়', en: 'Waiting' },
  runningLate: { bn: 'দেরিতে', en: 'Late' },
  seenAlready: { bn: 'দেখা হয়েছে', en: 'Seen' },

  // --- I'm running late (BTN-A08-LATE, MOD-A08-LATE, FR-PAT-33) -------------
  declareLate: { bn: 'আমি দেরি করছি', en: 'I am running late' },
  lateQuestion: { bn: 'কত দেরি হবে?', en: 'How late will you be?' },
  lateMinutes: { bn: '{minutes} মিনিট', en: '{minutes} min' },
  lateSending: { bn: 'জানানো হচ্ছে…', en: 'Letting them know…' },
  lateDone: {
    bn: 'আপনাকে {count} জন পরে ডাকা হবে।',
    en: 'You will be called after {count} more patients.',
  },
  lateFailed: {
    bn: 'জানানো যায়নি। কাউন্টারে বলে দিন।',
    en: 'That did not get through. Please tell the counter.',
  },

  // --- Cancel (BTN-A08-CANCEL, MOD-A08-CANCEL, GR-01, FR-PAY-03) ------------
  cancelBooking: { bn: 'বাতিল করুন', en: 'Cancel my serial' },
  cancelQuestion: { bn: 'সিরিয়াল বাতিল করবেন?', en: 'Cancel your serial?' },
  // GR-01: the confirm names the consequence, never "are you sure".
  cancelConsequence: {
    bn: 'আপনার {serial} নম্বর সিরিয়াল ছেড়ে দেওয়া হবে এবং অন্য কাউকে দেওয়া হতে পারে।',
    en: 'Serial {serial} will be released and may be given to somebody else.',
  },
  // FR-PAY-03: the refund rule is stated before confirming. When the hospital
  // has recorded none, saying so is the honest answer — inventing a percentage
  // would be worse than admitting the rule is not on file (`PRD.md` §3.2).
  refundPolicyUnknown: {
    bn: 'ফেরতের বিষয়টি হাসপাতাল জানাবে।',
    en: 'The hospital will confirm anything owed back to you.',
  },
  cancelKeep: { bn: 'না, থাক', en: 'Keep my serial' },
  cancelConfirm: { bn: 'হ্যাঁ, বাতিল করুন', en: 'Yes, cancel it' },
  cancelled: { bn: 'সিরিয়াল বাতিল করা হয়েছে', en: 'Your serial has been cancelled' },
  cancelFailed: { bn: 'বাতিল করা যায়নি', en: 'Could not cancel' },

  // --- Live serial failures -------------------------------------------------
  linkExpired: {
    bn: 'এই লিংকের মেয়াদ শেষ। নতুন সিরিয়াল নিতে আবার শুরু করুন।',
    en: 'This link has expired. Start again to book a new serial.',
  },
  serialNotFound: { bn: 'সিরিয়ালটি পাওয়া যায়নি', en: 'That serial could not be found' },
  disconnected: { bn: 'সংযোগ নেই', en: 'No connection' },
  reconnecting: { bn: 'আবার যুক্ত হচ্ছে…', en: 'Reconnecting…' },

  // --- Failures ------------------------------------------------------------
  alreadyBooked: {
    bn: 'এই ডাক্তারের কাছে আজ আপনার সিরিয়াল আগেই নেওয়া আছে।',
    en: 'You already have a serial with this doctor today.',
  },
  chamberFull: {
    bn: 'এই চেম্বারের সব সিরিয়াল শেষ।',
    en: 'Every serial in this chamber has been taken.',
  },
  bookingFailed: { bn: 'সিরিয়াল নেওয়া যায়নি', en: 'Could not book' },
  tryAgain: { bn: 'আবার চেষ্টা করুন', en: 'Try again' },

  // GR-03's third state, and it is not the same as the empty one. "No hospital
  // offers this" is a statement about the world; a request that failed is a
  // statement about us, and saying the first when the second is true is the
  // dishonesty `PRD.md` §3.2 forbids.
  listFailed: {
    bn: 'তথ্য আনা যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।',
    en: 'Could not load this. Check your connection and try again.',
  },
  loading: { bn: 'লোড হচ্ছে', en: 'Loading' },

  minutesShort: { bn: 'মিনিট', en: 'min' },

  // --- Freshness (FR-OFF-03, GR-05, DoD §5.8) -------------------------------
  // A live figure never appears without saying how old it is, on this surface
  // as much as on the console.
  updatedJustNow: { bn: 'এইমাত্র হালনাগাদ', en: 'Updated just now' },
  updatedAgo: { bn: 'হালনাগাদ {time} আগে', en: 'Updated {time} ago' },
  updatedNever: { bn: 'এখনো হালনাগাদ হয়নি', en: 'Not updated yet' },
  staleWarning: { bn: 'তথ্য পুরনো হতে পারে', en: 'This may be out of date' },

  // --- Offline (GR-03) ------------------------------------------------------
  // Booking takes a serial from a shared queue, so it cannot be completed
  // without a network. Saying so is the honest state; letting the form look
  // ready is not (`PRD.md` §3.2).
  offline: { bn: 'ইন্টারনেট সংযোগ নেই', en: 'No internet connection' },
  offlineBooking: {
    bn: 'সিরিয়াল নিতে ইন্টারনেট লাগবে। সংযোগ ফিরলে আবার চেষ্টা করুন।',
    en: 'Booking a serial needs a connection. Try again once you are back online.',
  },

  demoBanner: {
    bn: 'এটি একটি ডেমো। সব তথ্য প্রদর্শনের জন্য তৈরি।',
    en: 'This is a demonstration. All data here is for display only.',
  },
} as const satisfies Record<string, Message>;

export type PatientKey = keyof typeof PATIENT;

/** Reads a patient message. */
export function tp(key: PatientKey, locale: Locale): string {
  return PATIENT[key][locale];
}

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
