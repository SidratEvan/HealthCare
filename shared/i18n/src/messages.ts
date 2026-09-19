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

  // --- Tabs not built in this version --------------------------------------
  comingSoon: { bn: 'শীঘ্রই আসছে', en: 'Coming soon' },
  recordsComing: {
    bn: 'ডাক্তার দেখানোর পর প্রেসক্রিপশন আর রিপোর্ট এখানে জমা হবে।',
    en: 'Prescriptions and reports will collect here after a visit.',
  },
  profileComing: {
    bn: 'অ্যাকাউন্ট আর প্রোফাইল এখনো তৈরি হয়নি। সিরিয়াল নিতে অ্যাকাউন্ট লাগে না।',
    en: 'Accounts are not built yet. Booking a serial needs no account.',
  },
  bedsComing: {
    bn: 'কোন হাসপাতালে কয়টি বেড আর আইসিইউ খালি, তা এখানে দেখা যাবে।',
    en: 'Free beds and ICU capacity per hospital will show here.',
  },
  ambulanceComing: {
    bn: 'কাছের অ্যাম্বুলেন্স ডাকা আর ভাড়া দেখা এখানে আসবে। এখন জরুরি প্রয়োজনে ৯৯৯ এ কল করুন।',
    en: 'Calling a nearby ambulance and seeing the fare will come here. For now, call 999 in an emergency.',
  },
  bloodComing: {
    bn: 'রক্তের গ্রুপ ধরে ব্লাড ব্যাংক আর ডোনার খোঁজা এখানে আসবে।',
    en: 'Searching blood banks and donors by group will come here.',
  },
  emergencyComing: {
    bn: 'জরুরি বিভাগ বেছে নেওয়া আর "আসছি" জানানো এখানে আসবে। এখনই দরকার হলে ৯৯৯ এ কল করুন।',
    en: 'Emergency triage and telling an ER you are on the way will come here. If you need help now, call 999.',
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
