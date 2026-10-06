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
  navPharmacy: { bn: 'ফার্মেসি', en: 'Pharmacy' },
  navBilling: { bn: 'বিল', en: 'Billing' },
  navDashboard: { bn: 'ড্যাশবোর্ড', en: 'Dashboard' },
  /** Under an item whose screen this version does not have (`S-B-03`, `S-B-04`). */
  navNotInVersion: { bn: 'এই সংস্করণে নেই', en: 'Not in this version' },
  /** Under an item whose console this facility does not run. */
  navNotHere: { bn: 'এই প্রতিষ্ঠানে নেই', en: 'Not at this facility' },
  navOpening: { bn: 'খোলা হচ্ছে…', en: 'Opening…' },
  navOpenFailed: { bn: 'খোলা যায়নি। আবার চাপুন।', en: 'Could not open. Tap again.' },

  // --- Session bar (B1.2) --------------------------------------------------
  sessionSelector: { bn: 'চেম্বার নির্বাচন', en: 'Select chamber' },
  doctorArrived: { bn: 'ডাক্তার এসেছেন', en: 'Doctor has arrived' },
  declareDelay: { bn: 'দেরি ঘোষণা', en: 'Declare delay' },
  pause: { bn: 'বিরতি', en: 'Pause' },
  resume: { bn: 'আবার শুরু', en: 'Resume' },
  /** Under the session bar for as long as the chamber is paused (`FR-REC-05`). */
  sessionPausedSince: {
    bn: 'বিরতি চলছে — {time} থেকে। রোগী ডাকতে “আবার শুরু” চাপুন।',
    en: 'On a break since {time}. Press “Resume” to call patients.',
  },
  /** Why `BTN-B02-NEXT` is off, and what the `N` key says, during a break. */
  pausedResumeFirst: {
    bn: 'বিরতি চলছে। আগে আবার শুরু করুন।',
    en: 'The chamber is on a break. Resume it first.',
  },
  /** Why `BTN-B02-PAUSE` is off before the doctor is in, or after the chamber ended. */
  pauseNeedsRunning: {
    bn: 'চেম্বার চলার সময় বিরতি দেওয়া যায়।',
    en: 'A break can be taken while the chamber is running.',
  },

  // --- Ending a chamber (`BTN-B02-END`, `MOD-B02-END`) ----------------------
  endChamber: { bn: 'চেম্বার শেষ করুন', en: 'End chamber' },
  /** Why the control is off while somebody is in the chamber. */
  endPatientInChamber: {
    bn: 'একজন রোগী চেম্বারে আছেন। আগে তাঁর দেখা শেষ করুন।',
    en: 'A patient is in the chamber. Finish that consultation first.',
  },
  /** Why it is off with no connection: an end the server has not heard is not one. */
  endNeedsConnection: {
    bn: 'চেম্বার শেষ করতে সংযোগ লাগে।',
    en: 'Ending a chamber needs a connection.',
  },
  endChamberTitle: { bn: 'চেম্বার শেষ করবেন?', en: 'End this chamber?' },
  /** `MOD-B02-END`: the count, when patients are left unseen. */
  endChamberUnseen: {
    bn: '{count} জন রোগীকে দেখা হয়নি।',
    en: '{count} patients have not been seen.',
  },
  endChamberNobodyLeft: {
    bn: 'কোনো রোগী অপেক্ষায় নেই।',
    en: 'Nobody is waiting.',
  },
  /** The consequence, said whatever the count (`GR-01`). */
  endChamberConsequence: {
    bn: 'চেম্বার শেষ করলে এই সেশনে আর কোনো কাজ করা যাবে না।',
    en: 'Ending this chamber will stop further queue actions for this session.',
  },
  /** The deliberate tick, required when patients are left unseen. */
  endChamberAcknowledge: {
    bn: 'আমি বুঝেছি, এই রোগীদের দেখা হয়নি',
    en: 'I understand these patients have not been seen',
  },
  endChamberConfirm: { bn: 'চেম্বার শেষ করুন', en: 'End chamber' },
  endChamberKeep: { bn: 'ফিরে যান', en: 'Go back' },
  /** Across the screen once the chamber has ended. */
  chamberEnded: {
    bn: 'এই চেম্বার শেষ হয়েছে। এখানে আর কোনো কাজ করা যাবে না।',
    en: 'This chamber has ended. Nothing more can be done here.',
  },
  /** Why every control is off after that. */
  chamberHasEnded: { bn: 'চেম্বার শেষ হয়েছে।', en: 'The chamber has ended.' },
  backToChambers: { bn: 'চেম্বারের তালিকায় ফিরুন', en: 'Back to the chambers' },
  /** The server refused: somebody was called in from another counter. */
  endRefusedInChamber: {
    bn: 'চেম্বার শেষ হয়নি: একজন রোগী চেম্বারে আছেন। তালিকা হালনাগাদ করা হয়েছে।',
    en: 'The chamber was not ended: a patient is in the chamber. The queue has been brought up to date.',
  },
  endFailed: {
    bn: 'চেম্বার শেষ করা যায়নি। আবার চেষ্টা করুন।',
    en: 'The chamber could not be ended. Try again.',
  },
  /** `S-B-01`: when a chamber on the picker is today's, and when it is not. */
  chamberToday: { bn: 'আজ · শুরু {time}', en: 'Today · starts {time}' },
  chamberEarlierDay: {
    bn: 'আগের দিনের চেম্বার · {when}',
    en: 'An earlier day’s chamber · {when}',
  },

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
  /** The browser tab's title, which the layout's metadata gives in `bn`. */
  consoleTitle: { bn: 'হাসপাতাল কনসোল', en: 'Hospital console' },
  /** `SEG-B00-LANG`: the group the two language buttons sit in. */
  language: { bn: 'ভাষা', en: 'Language' },
  sessionRunning: { bn: 'চলছে', en: 'Running' },
  sessionScheduled: { bn: 'শুরু হয়নি', en: 'Not started' },
  sessionEnded: { bn: 'শেষ', en: 'Finished' },
  waitingCount: { bn: '{count} জন অপেক্ষায়', en: '{count} waiting' },
  chamberHours: { bn: 'চেম্বার', en: 'Chamber' },
  openConsole: { bn: 'কনসোল খুলুন', en: 'Open the console' },
  noConsoles: {
    bn: 'আজ কোনো চেম্বার চলছে না। ডেমো তথ্য আবার তৈরি করুন।',
    en: 'No chambers are running today. Rebuild the demo data.',
  },
  /** A facility with no chamber today still has its ward, ER, lab and office. */
  noChambersToday: {
    bn: 'আজ এখানে কোনো চেম্বার নেই। ওপরের কনসোলগুলো খোলা আছে।',
    en: 'No chambers here today. The consoles above are open.',
  },
  changeConsole: { bn: 'কনসোল বদলান', en: 'Change console' },
  facilityConsoles: { bn: 'হাসপাতালের কনসোল', en: 'Hospital consoles' },
  consoleLoadFailed: { bn: 'কনসোলের তালিকা আনা যায়নি', en: 'Could not load the consoles' },

  // --- Staff sign-in (S-B-00, S-B-00c, pilot step 21) ------------------------
  //
  // Wrong email and wrong password get one message: saying which would tell a
  // stranger which addresses have accounts (`AUTH_INVALID_CREDENTIALS`).
  loginTitle: { bn: 'লগ ইন', en: 'Sign in' },
  loginIntro: {
    bn: 'আপনার নিজের ইমেইল ও পাসওয়ার্ড দিন। একজনের অ্যাকাউন্ট অন্যজন ব্যবহার করবেন না।',
    en: 'Use your own email and password. Never use somebody else’s account.',
  },
  loginEmail: { bn: 'ইমেইল', en: 'Email' },
  loginPassword: { bn: 'পাসওয়ার্ড', en: 'Password' },
  loginHospitalCode: { bn: 'হাসপাতালের কোড', en: 'Hospital code' },
  loginHospitalCodeHint: {
    bn: 'এই ইমেইলে একাধিক প্রতিষ্ঠানে অ্যাকাউন্ট আছে। কোনটিতে ঢুকবেন, তার কোড লিখুন (যেমন MARKS)।',
    en: 'This email has accounts at more than one facility. Enter the code of the one you want (for example MARKS).',
  },
  loginSubmit: { bn: 'লগ ইন করুন', en: 'Sign in' },
  loginSubmitting: { bn: 'যাচাই হচ্ছে…', en: 'Checking…' },
  /** Why `BTN-B00-LOGIN` is off (§5.1: a disabled control says why). */
  loginNeedsFields: { bn: 'ইমেইল ও পাসওয়ার্ড দিন', en: 'Enter your email and password' },
  passwordNeedsFields: {
    bn: 'এখনকার পাসওয়ার্ড দিন, আর নতুনটি দুবার — অন্তত ১০ অক্ষর',
    en: 'Enter the current password, and the new one twice — at least 10 characters',
  },
  loginInvalid: { bn: 'ইমেইল বা পাসওয়ার্ড মেলেনি।', en: 'The email or password is wrong.' },
  loginLocked: {
    bn: 'বারবার ভুল হওয়ায় অ্যাকাউন্টটি {time} পর্যন্ত বন্ধ আছে।',
    en: 'Too many wrong attempts. The account is locked until {time}.',
  },
  loginNoRoles: {
    bn: 'এই অ্যাকাউন্টে কোনো দায়িত্ব দেওয়া নেই। হাসপাতালের প্রশাসককে বলুন।',
    en: 'This account has no role yet. Ask the hospital administrator.',
  },
  loginOffline: {
    bn: 'ইন্টারনেট সংযোগ নেই। সংযোগ ফিরলে আবার চেষ্টা করুন।',
    en: 'No internet connection. Try again when it is back.',
  },
  loginFailed: {
    bn: 'এখন লগ ইন করা গেল না। একটু পরে আবার চেষ্টা করুন।',
    en: 'Could not sign in just now. Try again shortly.',
  },
  loginForgot: {
    bn: 'পাসওয়ার্ড ভুলে গেলে হাসপাতালের প্রশাসককে বলুন — তিনি নতুন একটি দেবেন।',
    en: 'Forgotten your password? Ask the hospital administrator for a new one.',
  },
  loginDemoLink: { bn: 'স্টাফ অ্যাকাউন্টে লগ ইন', en: 'Sign in with a staff account' },
  loginDemoNote: {
    bn: 'ডেমোর সব অ্যাকাউন্টের পাসওয়ার্ড: demo-password-2026',
    en: 'Every demo account’s password: demo-password-2026',
  },
  signOut: { bn: 'লগ আউট', en: 'Sign out' },
  signedInAs: { bn: 'লগ ইন: {name}', en: 'Signed in: {name}' },
  sessionExpired: {
    bn: 'অনেকক্ষণ কিছু না হওয়ায় আবার লগ ইন করতে হবে।',
    en: 'Your session has ended. Please sign in again.',
  },
  staffPickerNote: {
    bn: 'আপনার দায়িত্ব অনুযায়ী কনসোলগুলো দেখানো হচ্ছে।',
    en: 'These are the consoles your roles open.',
  },
  passwordTitle: { bn: 'নিজের পাসওয়ার্ড দিন', en: 'Set your own password' },
  passwordIntro: {
    bn: 'এই পাসওয়ার্ড প্রশাসক দিয়েছিলেন। কোনো কনসোল খোলার আগে নিজের একটি পাসওয়ার্ড দিন — অন্তত ১০ অক্ষর।',
    en: 'An administrator set this password. Before any console opens, choose your own — at least 10 characters.',
  },
  passwordCurrent: { bn: 'এখনকার পাসওয়ার্ড', en: 'Current password' },
  passwordNew: { bn: 'নতুন পাসওয়ার্ড', en: 'New password' },
  passwordRepeat: { bn: 'নতুন পাসওয়ার্ড আবার', en: 'New password again' },
  passwordMismatch: {
    bn: 'দুটি নতুন পাসওয়ার্ড মেলেনি।',
    en: 'The two new passwords do not match.',
  },
  passwordShort: { bn: 'অন্তত ১০ অক্ষরের পাসওয়ার্ড দিন।', en: 'Use at least 10 characters.' },
  passwordUnchanged: {
    bn: 'নতুন পাসওয়ার্ড আগেরটির চেয়ে আলাদা হতে হবে।',
    en: 'The new password must differ from the current one.',
  },
  passwordWrong: { bn: 'এখনকার পাসওয়ার্ড মেলেনি।', en: 'The current password is wrong.' },
  passwordSubmit: { bn: 'পাসওয়ার্ড রাখুন', en: 'Save the password' },

  // --- The second factor (S-B-00b, S-B-00d, pilot step 28, FR-SEC-10) ---------
  tfaCodeTitle: { bn: 'দুই ধাপের যাচাই', en: 'Two-step verification' },
  tfaCodeIntro: {
    bn: 'ফোনের অথেনটিকেটর অ্যাপ খুলে এই অ্যাকাউন্টের ৬ সংখ্যার কোডটি লিখুন।',
    en: 'Open the authenticator app on your phone and enter this account’s six-digit code.',
  },
  tfaCodeLabel: { bn: 'কোড', en: 'Code' },
  tfaCodeHint: {
    bn: 'ফোন হারালে একটি রিকভারি কোড লিখুন (xxxx-xxxx-xxxx)।',
    en: 'Lost your phone? Enter one of your recovery codes (xxxx-xxxx-xxxx).',
  },
  tfaCodeSubmit: { bn: 'যাচাই করুন', en: 'Verify' },
  tfaCodeNeeds: { bn: 'কোডটি লিখুন', en: 'Enter the code' },
  tfaCodeInvalid: {
    bn: 'কোডটি মেলেনি, বা আগেই ব্যবহার হয়েছে। অ্যাপে এখন যেটি দেখাচ্ছে সেটি দিন।',
    en: 'That code is wrong or has been used. Enter the one the app shows now.',
  },
  tfaCodeExpired: {
    bn: 'অনেক সময় পেরিয়ে গেছে। আবার পাসওয়ার্ড দিয়ে লগ ইন করুন।',
    en: 'That took too long. Sign in with your password again.',
  },
  tfaBack: { bn: 'আবার পাসওয়ার্ড দিন', en: 'Start again' },
  tfaSetupTitle: { bn: 'দুই ধাপের যাচাই চালু করুন', en: 'Turn on two-step verification' },
  tfaSetupIntroRequired: {
    bn: 'প্রশাসকের অ্যাকাউন্টে পাসওয়ার্ডের সঙ্গে ফোনের একটি কোডও লাগে। এটি চালু না করা পর্যন্ত কোনো কনসোল খুলবে না।',
    en: 'An administrator’s account needs a code from a phone as well as the password. No console opens until it is on.',
  },
  tfaSetupIntroOptional: {
    bn: 'চালু করলে প্রতিবার লগ ইনে পাসওয়ার্ডের পর ফোনের একটি কোডও লাগবে।',
    en: 'Once it is on, every sign-in asks for a code from your phone after the password.',
  },
  tfaSetupStep1: {
    bn: '১. ফোনে একটি অথেনটিকেটর অ্যাপ নিন — Google Authenticator, Microsoft Authenticator বা এ রকম যেকোনোটি।',
    en: '1. Install an authenticator app on your phone — Google Authenticator, Microsoft Authenticator or any like them.',
  },
  tfaSetupStep2: {
    bn: '২. অ্যাপে নতুন অ্যাকাউন্ট যোগ করে এই QR কোডটি স্ক্যান করুন।',
    en: '2. Add an account in the app and scan this QR code.',
  },
  tfaSetupManual: {
    bn: 'স্ক্যান করা না গেলে এই চাবিটি অ্যাপে হাতে লিখুন:',
    en: 'Cannot scan it? Type this key into the app instead:',
  },
  tfaSetupStep3: {
    bn: '৩. অ্যাপে যে ৬ সংখ্যার কোড দেখাচ্ছে, সেটি লিখুন।',
    en: '3. Enter the six-digit code the app shows.',
  },
  tfaSetupSubmit: { bn: 'চালু করুন', en: 'Turn it on' },
  tfaSetupLoading: { bn: 'তৈরি হচ্ছে…', en: 'Preparing…' },
  tfaSetupFailed: {
    bn: 'এখন শুরু করা গেল না। একটু পরে আবার চেষ্টা করুন।',
    en: 'Could not start just now. Try again shortly.',
  },
  tfaSetupInvalid: {
    bn: 'কোডটি মেলেনি। অ্যাপে এখন যেটি দেখাচ্ছে সেটি দিন, আর ফোনের সময় ঠিক আছে কি না দেখুন।',
    en: 'That code does not match. Enter the one the app shows now, and check the phone’s clock is right.',
  },
  tfaSetupNeeds: {
    bn: 'অ্যাপের ৬ সংখ্যার কোডটি লিখুন',
    en: 'Enter the six-digit code from the app',
  },
  tfaQrAlt: { bn: 'অথেনটিকেটর অ্যাপের জন্য QR কোড', en: 'QR code for the authenticator app' },
  tfaCancel: { bn: 'এখন নয়', en: 'Not now' },
  tfaRecoveryTitle: { bn: 'রিকভারি কোড', en: 'Recovery codes' },
  tfaRecoveryIntro: {
    bn: 'ফোন হারালে এর যেকোনো একটি দিয়ে একবার লগ ইন করা যাবে। কোডগুলো শুধু এখনই দেখানো হচ্ছে — লিখে বা প্রিন্ট করে নিরাপদ জায়গায় রাখুন।',
    en: 'If you lose your phone, each of these signs you in once. They are shown only now — write them down or print them, and keep them somewhere safe.',
  },
  tfaRecoveryPrint: { bn: 'প্রিন্ট করুন', en: 'Print' },
  tfaRecoverySaved: { bn: 'আমি কোডগুলো নিরাপদে রেখেছি', en: 'I have kept these codes safe' },
  tfaRecoveryNeeds: {
    bn: 'আগে নিশ্চিত করুন যে কোডগুলো রেখেছেন',
    en: 'First confirm you have kept the codes',
  },
  tfaRecoveryContinue: { bn: 'কনসোলে যান', en: 'Continue' },
  tfaOnNote: { bn: 'দুই ধাপের যাচাই চালু আছে', en: 'Two-step verification is on' },
  tfaRecoveryLow: {
    bn: 'আর {count}টি রিকভারি কোড বাকি। ফুরোনোর আগে প্রশাসককে বলে দুই ধাপের যাচাই রিসেট করিয়ে আবার চালু করুন।',
    en: '{count} recovery codes left. Before they run out, ask an administrator to reset two-step verification, then turn it on again.',
  },

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

  // --- Check-in (FR-REC-18, BTN-B02-CHECKIN, MOD-B02-CHECKIN) ----------------
  // A button, so a verb in English as in Bangla (FRONTEND.md §5.1).
  checkIn: { bn: 'এসেছেন', en: 'Check in' },
  checkInTitle: { bn: 'সিরিয়াল {serial} এসেছেন', en: 'Serial {serial} is here' },
  checkInDescription: {
    bn: 'রোগীকে আনুমানিক কতক্ষণ অপেক্ষা করতে হবে বলছেন?',
    en: 'Roughly how long are you telling them they will wait?',
  },
  checkInFromQueue: {
    bn: 'সারির হিসাব থেকে নেওয়া — দরকার হলে বদলান।',
    en: 'From the queue’s estimate — change it if you know better.',
  },
  checkInNoEstimate: {
    bn: 'সারির কোনো হিসাব নেই — নিজে ঠিক করুন।',
    en: 'The queue has no estimate for them — set it yourself.',
  },
  checkInMinutes: { bn: '{minutes} মিনিট', en: '{minutes} min' },
  checkInLess: { bn: '৫ মিনিট কম', en: '5 minutes less' },
  checkInMore: { bn: '৫ মিনিট বেশি', en: '5 minutes more' },
  checkInConfirm: { bn: 'নিশ্চিত করুন', en: 'Confirm' },
  checkInCancel: { bn: 'থাক', en: 'Not now' },
  checkedIn: {
    bn: 'সিরিয়াল {serial} — এসেছেন, {minutes} মিনিট বলা হয়েছে',
    en: 'Serial {serial} checked in, told {minutes} min',
  },
  quotedShort: { bn: '{minutes} মিনিট বলা', en: 'told {minutes} min' },

  // --- Statuses ------------------------------------------------------------
  statusBooked: { bn: 'অপেক্ষায়', en: 'Waiting' },
  statusWaiting: { bn: 'অপেক্ষায়', en: 'Waiting' },
  statusArrived: { bn: 'এসেছেন', en: 'Here' },
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
  sourceImport: { bn: 'হাসপাতালের খাতা থেকে', en: "From the hospital's register" },

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
  hoursShort: { bn: 'ঘণ্টা', en: 'h' },

  // --- Offline block (B1.5, FR-OFF-01) -------------------------------------
  online: { bn: 'সংযুক্ত', en: 'Online' },
  offline: { bn: 'সংযোগ নেই', en: 'Offline' },
  pendingToSync: { bn: 'পাঠানো বাকি', en: 'Waiting to sync' },
  lastSynced: { bn: 'সর্বশেষ সংযোগ', en: 'Last synced' },
  neverSynced: { bn: 'এখনো সংযোগ হয়নি', en: 'Not synced yet' },
  /**
   * An action the server answered and could not take (`FR-OFF-05`). Not the
   * network: a dead network leaves work queued, and that is not a fault.
   */
  syncStuck: {
    bn: '{count}টি কাজ সার্ভার নিতে পারেনি। বাকিগুলো পাঠানো হচ্ছে।',
    en: 'The server could not take {count} action(s). The rest are being sent.',
  },
  syncStuckRetry: { bn: 'আবার পাঠান', en: 'Send again' },
  syncStuckDiscard: { bn: 'বাদ দিন', en: 'Discard' },
  /** `GR-01`: a destructive action names its consequence before it happens. */
  syncStuckConfirm: {
    bn: 'বাদ দিলে এই কাজগুলো আর কখনো পাঠানো হবে না।',
    en: 'Discarded actions will never be sent.',
  },
  syncStuckKeep: { bn: 'রেখে দিন', en: 'Keep them' },
  /** The browser refused IndexedDB, so the outbox lives in this tab only. */
  queueNotDurable: {
    bn: 'এই ব্রাউজার অপেক্ষমাণ কাজ জমা রাখতে পারছে না। পাতা বন্ধ বা রিলোড করলে না-পাঠানো কাজ হারিয়ে যাবে।',
    en: 'This browser cannot keep queued actions. Closing or reloading the page will lose anything not yet sent.',
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
  /** `Ctrl+Z` with no action of this console's to take back (`GR-02`). */
  undoNothing: { bn: 'ফিরিয়ে নেওয়ার মতো কিছু নেই।', en: 'There is nothing to undo.' },
  /** The ten seconds are up (`FR-REC-16`). */
  undoExpired: {
    bn: 'ফিরিয়ে নেওয়ার সময় শেষ হয়ে গেছে।',
    en: 'It is too late to undo that.',
  },
  /** Already sent, and the network went before the undo could follow it. */
  undoOffline: {
    bn: 'সংযোগ নেই — কাজটি আগেই পাঠানো হয়েছে, তাই এখন ফিরিয়ে নেওয়া যাচ্ছে না।',
    en: 'No connection — that was already sent, so it cannot be undone right now.',
  },
  undoRefused: {
    bn: 'ফিরিয়ে নেওয়া যায়নি। সারিটি দেখে নিন।',
    en: 'That could not be undone. Check the queue.',
  },
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
  pastVisitsHereOnly: {
    bn: 'শুধু এই হাসপাতালের ভিজিট দেখানো হচ্ছে। অন্য হাসপাতালের রেকর্ড দেখতে রোগীর কোড লাগবে।',
    en: 'Only visits at this hospital are shown. Records from another hospital need the patient’s code.',
  },
  noPastVisitsHere: {
    bn: 'এই হাসপাতালে এই রোগীর আগের কোনো রেকর্ড নেই',
    en: 'No earlier records for this patient at this hospital',
  },
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
  /**
   * No network, and nothing kept on this device for this chamber. Said rather
   * than left on "loading", which would never end (`GR-03`, `FR-OFF-05`).
   */
  queueNotKeptOffline: {
    bn: 'সংযোগ নেই, আর এই চেম্বারের সিরিয়াল এই ডিভাইসে রাখা নেই। সংযোগ ফিরলে নিজে থেকেই খুলবে।',
    en: 'No connection, and this chamber’s queue is not kept on this device. It will open by itself when the connection returns.',
  },
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
  // A decline is before arrival, so it is not a referral: the family chooses,
  // and these are the places to tell them about (the owner's ruling, 2026-09-22).
  erSuggestHint: {
    bn: 'রেফার শুধু জরুরি বিভাগে আসা রোগীর জন্য। পরিবারকে এদের কথা বলুন, বা ফোন করে জানান।',
    en: 'A referral is for someone already in your ER. Tell the family about these, or call ahead.',
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
    bn: 'সংযোগ নেই — নতুন "আসছি" বার্তা বা রেফার এখন আসবে না। ত্রিয়াজ, নতুন রোগী, সক্ষমতা আর রেফারের উত্তর চলবে, পরে পাঠানো হবে।',
    en: 'No connection — new "on my way" alerts and referrals cannot arrive. Triage, walk-ins, capabilities and referral answers keep working and are sent later.',
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

  // --- Referrals (FR-EMG-07..09) --------------------------------------------
  // BTN-B07-REFER: the refer-out search, from a triage row.
  erRefer: { bn: 'রেফার খুঁজুন', en: 'Find a referral' },
  erReferTitle: { bn: '{token} — কোথায় পাঠাবেন?', en: 'Where to refer {token}?' },
  erReferNeed: { bn: 'কী দরকার', en: 'What is needed' },
  erReferNeedHint: {
    bn: 'সমস্যা থেকে ধরে নেওয়া — দরকার হলে বদলান।',
    en: 'Filled in from the problem — change it if needed.',
  },
  erReferNeedMissing: {
    bn: 'একটি সক্ষমতা বা বেডের ধরন বেছে নিন।',
    en: 'Choose a capability or a kind of bed.',
  },
  erReferCapability: { bn: 'সক্ষমতা', en: 'Capability' },
  erReferBedKind: { bn: 'খালি বেড', en: 'Free bed' },
  erNeedBed: { bn: '{kind} বেড', en: '{kind} bed' },
  // The emergency search's own order: fresh before stale, then nearest (FR-PAT-45).
  erReferResults: {
    bn: 'এই সক্ষমতা ও খালি বেড আছে এমন জরুরি বিভাগ — হালনাগাদ তথ্য আগে, তারপর কাছের',
    en: 'ERs with the capability and a free bed — fresh figures first, then nearest',
  },
  erReferExcluded: { bn: 'তালিকায় নেই: {reasons}।', en: 'Left out: {reasons}.' },
  erReferExcludedCapability: {
    bn: '{count}টির এই সক্ষমতা নেই',
    en: '{count} without the capability',
  },
  erReferExcludedBeds: { bn: '{count}টিতে খালি বেড নেই', en: '{count} without a free bed' },
  erReferEmpty: {
    bn: 'এই চাহিদা মেটাতে পারে এমন কোনো জরুরি বিভাগ কাছে পাওয়া যায়নি।',
    en: 'No ER within reach can meet this need.',
  },
  erReferNeedsConnection: {
    bn: 'অন্য হাসপাতাল খুঁজতে সংযোগ লাগবে।',
    en: 'Searching other hospitals needs a connection.',
  },
  erReferFreeBeds: { bn: '{count}টি খালি', en: '{count} free' },
  erReferTravel: { bn: 'আনুমানিক {minutes} মিনিট', en: 'About {minutes} min' },
  // BTN-B07-REFER-SEND-<hospitalId> (FR-EMG-08).
  erReferSend: { bn: 'রেফার পাঠান', en: 'Send referral' },
  erReferNote: { bn: 'নোট (ঐচ্ছিক)', en: 'Note (optional)' },
  erReferNoteHint: {
    bn: 'নাম বা ফোন নম্বর লিখবেন না। সারাংশে সমস্যা, ত্রিয়াজ, বয়স ও লিঙ্গ নিজেই যাবে।',
    en: 'Do not write a name or a number. The problem, triage, age and sex go with it.',
  },
  erReferConfirm: { bn: '{hospital}-এ পাঠান', en: 'Send to {hospital}' },
  erReferConsequence: {
    bn: '{hospital} রোগী পৌঁছানো নিশ্চিত না করা পর্যন্ত রোগী আপনাদের তালিকায় থাকবেন — ওয়ার্ডে পাঠানো বা ছেড়ে দেওয়া যাবে না।',
    en: 'Until {hospital} confirms the arrival, the patient stays on your list — they cannot be handed to the ward or discharged.',
  },

  // The sending ER's triage row: where its referral has got to.
  erReferralTo: { bn: '{hospital}-এ রেফার', en: 'Referred to {hospital}' },
  erReferralDeclinedBy: {
    bn: '{hospital} ফিরিয়ে দিয়েছে: {reason}',
    en: '{hospital} declined: {reason}',
  },
  erReferralOnTheWay: {
    bn: 'রাজি হয়েছে — {hospital} পৌঁছানো নিশ্চিত করা পর্যন্ত রোগী আপনাদের।',
    en: 'Accepted — the patient is yours until {hospital} confirms they arrived.',
  },
  erReferralHeld: {
    bn: 'রেফারের উত্তরের অপেক্ষায় — আগে রেফার প্রত্যাহার করুন।',
    en: 'A referral is waiting — withdraw it first.',
  },
  // BTN-B07-REFER-CANCEL — GR-01: the consequence named.
  erReferralCancel: { bn: 'রেফার প্রত্যাহার করুন', en: 'Withdraw the referral' },
  erReferralCancelConfirm: {
    bn: '{hospital}-এর রেফার প্রত্যাহার করবেন?',
    en: 'Withdraw the referral to {hospital}?',
  },
  erReferralCancelConsequence: {
    bn: '{hospital}-কে জানানো হবে যে রোগী আসছেন না। রোগী আপনাদের তালিকায় থাকবেন।',
    en: '{hospital} will be told the patient is not coming. The patient stays on your list.',
  },

  // The timeline (FR-EMG-08): each step and when.
  refStepSent: { bn: 'পাঠানো {time}', en: 'Sent {time}' },
  refStepSeen: { bn: 'দেখেছে {time}', en: 'Seen {time}' },
  refStepAccepted: { bn: 'রাজি {time}', en: 'Accepted {time}' },
  refStepDeclined: { bn: 'ফিরিয়েছে {time}', en: 'Declined {time}' },
  refStepArrived: { bn: 'পৌঁছেছেন {time}', en: 'Arrived {time}' },
  refStepCancelled: { bn: 'প্রত্যাহার {time}', en: 'Withdrawn {time}' },

  // LIST-B07-IN (FR-EMG-09).
  erIncomingTitle: { bn: 'অন্য হাসপাতাল পাঠাতে চায়', en: 'Referred to us' },
  erIncomingEmpty: {
    bn: 'অন্য হাসপাতাল থেকে কোনো রেফার নেই',
    en: 'No referrals from other hospitals',
  },
  erIncomingEmptyHint: {
    bn: 'অন্য জরুরি বিভাগ রেফার পাঠালে এখানে শব্দসহ দেখাবে।',
    en: 'When another ER sends a referral, it rings here.',
  },
  erIncomingFrom: { bn: '{hospital} থেকে', en: 'From {hospital}' },
  erIncomingAsks: { bn: 'চাইছে: {need}', en: 'Asking for: {need}' },
  erIncomingAccept: { bn: 'রাজি — পাঠাতে বলুন', en: 'Accept — ask them to send' },
  erIncomingDecline: { bn: 'ফিরিয়ে দিন', en: 'Decline' },
  erIncomingDeclineConsequence: {
    bn: '{hospital}-কে কারণসহ জানানো হবে। রোগী তাঁদের কাছেই থাকবেন, অন্য জায়গায় চেষ্টা করবেন।',
    en: '{hospital} will be told why. The patient stays with them, to try elsewhere.',
  },
  erIncomingAccepted: { bn: 'রাজি হয়েছেন — রোগী আসছেন', en: 'Accepted — on the way' },
  // BTN-B07-IN-ARRIVED: the handover.
  erIncomingArrived: { bn: 'এসে পৌঁছেছেন', en: 'They have arrived' },
  erIncomingArrivedHint: {
    bn: 'পৌঁছালে চাপুন — টোকেন দেওয়া হবে, আর রোগী {hospital}-এর তালিকা থেকে সরে যাবেন।',
    en: 'Tap when they arrive — a token is given, and they leave {hospital}’s list.',
  },
  erIncomingArrivedAs: {
    bn: '{token} হিসেবে জরুরি বিভাগে যোগ হয়েছে',
    en: 'Added to the ER as {token}',
  },

  // Today's referrals, with their timelines.
  erReferralsTodayTitle: { bn: 'আজকের রেফার', en: 'Today’s referrals' },
  erReferralsTodayEmpty: { bn: 'আজ কোনো রেফার হয়নি', en: 'No referrals today' },
  erReferralOut: { bn: 'পাঠানো → {hospital}', en: 'Sent → {hospital}' },
  erReferralIn: { bn: '{hospital} → এখানে', en: '{hospital} → here' },

  // --- The lab (S-B-08, APP_FLOW.md B5, FR-LAB-01..04) ---------------------
  roleLab: { bn: 'ল্যাব', en: 'Lab' },
  labSection: { bn: 'ল্যাব', en: 'Laboratory' },
  openLab: { bn: 'ল্যাব খুলুন', en: 'Open the lab' },
  labTitle: { bn: 'ল্যাব — পরীক্ষার তালিকা', en: 'Lab — test queue' },

  // The queue (FR-LAB-01). Oldest first, because a clock is running on each.
  labQueueOpen: { bn: 'চলমান', en: 'In progress' },
  labQueueReported: { bn: 'রিপোর্ট হয়েছে', en: 'Reported' },
  labQueueAll: { bn: 'সব', en: 'All' },
  labOpenCount: { bn: '{count}টি বাকি', en: '{count} waiting' },
  labEmpty: { bn: 'এখন কোনো পরীক্ষা বাকি নেই', en: 'Nothing waiting right now' },
  labEmptyHint: {
    bn: 'ডাক্তার পরীক্ষা লিখলে এখানে নিজে থেকেই আসবে।',
    en: 'When a doctor orders a test it appears here on its own.',
  },
  labLoadFailed: { bn: 'পরীক্ষার তালিকা আনা যায়নি', en: 'Could not load the test queue' },

  // A row. The patient's name is fetched separately and only when asked.
  labOrderedAt: { bn: '{time}-এ লেখা', en: 'Ordered at {time}' },
  labWaitingFor: { bn: '{duration} ধরে', en: 'For {duration}' },
  labShowPatient: { bn: 'রোগীর নাম দেখুন', en: 'Show the patient' },
  labPatientHint: {
    bn: 'নাম দেখা হলে তা রেকর্ড হয়।',
    en: 'Viewing the name is recorded.',
  },

  // State buttons (FR-LAB-02), in the words APP_FLOW.md B5 gives them.
  labCollect: { bn: 'নমুনা নেওয়া হয়েছে', en: 'Sample collected' },
  labProcess: { bn: 'প্রসেসিং', en: 'Processing' },
  labReady: { bn: 'রিপোর্ট প্রস্তুত', en: 'Report ready' },
  labCancel: { bn: 'বাতিল করুন', en: 'Cancel' },
  labStateOrdered: { bn: 'লেখা হয়েছে', en: 'Ordered' },
  labStateSampleCollected: { bn: 'নমুনা নেওয়া হয়েছে', en: 'Sample collected' },
  labStateProcessing: { bn: 'প্রসেসিং', en: 'Processing' },
  labStateReportReady: { bn: 'রিপোর্ট প্রস্তুত', en: 'Report ready' },
  labStateDelivered: { bn: 'রোগী পেয়েছেন', en: 'Delivered' },
  labStateCancelled: { bn: 'বাতিল', en: 'Cancelled' },

  // Upload (FR-LAB-03). The delivery is the point, so the button says it.
  labUpload: { bn: 'রিপোর্ট দিন', en: 'Upload the report' },
  labUploadHint: {
    bn: 'PDF বা ছবি। দেওয়ামাত্র রোগীর অ্যাপে ও ডাক্তারের কাছে পৌঁছে যাবে।',
    en: 'PDF or image. It reaches the patient’s app and the doctor at once.',
  },
  labUploading: { bn: 'পাঠানো হচ্ছে…', en: 'Sending…' },
  actionSending: { bn: 'আগেরটি পাঠানো হচ্ছে', en: 'Sending the last one' },

  // BTN-B05-TEST on the doctor console (FR-DOC-06).
  orderTests: { bn: 'পরীক্ষা দিন', en: 'Order tests' },
  orderTestsHint: {
    bn: 'বেছে নিলে রেকর্ড দেওয়ার সময় ল্যাবে চলে যাবে।',
    en: 'What you tick goes to the lab when you file the record.',
  },
  orderTestsCount: { bn: '{count}টি পরীক্ষা বেছে নেওয়া হয়েছে', en: '{count} tests ticked' },
  testsNotSent: {
    bn: 'রেকর্ড জমা হয়েছে, কিন্তু পরীক্ষাগুলো ল্যাবে যায়নি। আবার সেভ করুন।',
    en: 'The record saved, but the tests did not reach the lab. Save again.',
  },
  labUploaded: {
    bn: 'রোগী ও ডাক্তার দুজনেই পেয়েছেন',
    en: 'Both the patient and the doctor have it',
  },
  labUploadFailed: {
    bn: 'রিপোর্ট জমা হয়নি। কিছুই পাঠানো হয়নি — আবার চেষ্টা করুন।',
    en: 'The report was not stored. Nothing was sent — try again.',
  },
  labFileTooBig: { bn: 'ফাইলটি ১০ এমবি-র বেশি', en: 'That file is larger than 10 MB' },
  labFileWrongType: { bn: 'শুধু PDF বা ছবি দেওয়া যাবে', en: 'Only a PDF or an image can be sent' },
  labDeliveredTo: { bn: 'পৌঁছেছে: রোগী ও ডাক্তার', en: 'Delivered to: patient and doctor' },
  labDeliveredToPatient: { bn: 'পৌঁছেছে: রোগী', en: 'Delivered to: patient' },

  // Turnaround (FR-LAB-04), measured and never claimed.
  labTurnaroundTitle: { bn: 'কত সময় লাগছে', en: 'Turnaround' },
  labTurnaroundHint: {
    bn: 'লেখা থেকে রিপোর্ট পর্যন্ত — যা সত্যি হয়েছে তা থেকে মাপা।',
    en: 'Ordered to report ready — measured from what actually happened.',
  },
  labTurnaroundMedian: { bn: 'সাধারণত {duration}', en: 'Usually {duration}' },
  labTurnaroundNone: { bn: 'এখনো মাপা যায়নি', en: 'No measurement yet' },
  labTurnaroundOpen: { bn: '{count}টি চলছে', en: '{count} open' },
  labTurnaroundSlowest: { bn: 'সবচেয়ে ধীর {duration}', en: 'Slowest {duration}' },
  labOldestOpen: { bn: 'সবচেয়ে পুরোনো {duration} ধরে', en: 'Oldest waiting {duration}' },

  // --- The pharmacy (S-B-09, APP_FLOW.md B5, FR-PHR-02) --------------------
  rolePharmacy: { bn: 'ফার্মেসি', en: 'Pharmacy' },
  pharmacySection: { bn: 'ফার্মেসি', en: 'Pharmacy' },
  openPharmacy: { bn: 'ফার্মেসি খুলুন', en: 'Open the pharmacy' },
  pharmacyTitle: { bn: 'ফার্মেসি — ওষুধের মজুদ', en: 'Pharmacy — medicine stock' },
  pharmacyIntro: {
    bn: 'কোন ওষুধ আছে তা এখানে জানালে রোগীর অ্যাপে দেখা যাবে।',
    en: 'What you mark here is what patients searching see.',
  },
  pharmacyEmpty: {
    bn: 'এই ফার্মেসিতে কোনো ওষুধ যোগ করা হয়নি',
    en: 'No medicines listed for this pharmacy',
  },
  pharmacyEmptyHint: {
    bn: 'ওষুধ যোগ করতে ব্যবস্থাপনার সঙ্গে যোগাযোগ করুন।',
    en: 'Ask administration to add medicines.',
  },
  pharmacyLoadFailed: { bn: 'মজুদের তালিকা আনা যায়নি', en: 'Could not load the stock list' },
  pharmacyInStock: { bn: 'আছে', en: 'In stock' },
  pharmacyOutOfStock: { bn: 'নেই', en: 'Out of stock' },
  // The third answer: what the public is told when nobody has confirmed lately.
  pharmacyUnknown: { bn: 'জানা নেই', en: 'Not known' },
  pharmacyShownAs: { bn: 'রোগী দেখছেন: {answer}', en: 'Patients see: {answer}' },
  pharmacyConfirm: { bn: 'এখনো ঠিক আছে', en: 'Still correct' },
  pharmacyConfirmAll: { bn: 'পুরো তালিকা ঠিক আছে', en: 'The whole list is correct' },
  pharmacyConfirmHint: {
    bn: 'কিছু না বদলেও চাপুন — এতে রোগী জানবে তথ্যটি আজকের।',
    en: 'Tap even when nothing changed — it tells patients the list is today’s.',
  },
  pharmacySaved: { bn: 'মজুদ হালনাগাদ হয়েছে', en: 'Stock updated' },
  pharmacySaveFailed: { bn: 'হালনাগাদ হয়নি — আবার চেষ্টা করুন', en: 'Not updated — try again' },
  pharmacyStaleWarning: {
    bn: 'অনেকক্ষণ যাচাই হয়নি, তাই রোগীকে "জানা নেই" দেখানো হচ্ছে।',
    en: 'Not confirmed for a while, so patients are shown “not known”.',
  },
  pharmacyDispenseAbsent: {
    bn: 'প্রেসক্রিপশন স্ক্যান এই সংস্করণে নেই।',
    en: 'Prescription scanning is not in this version.',
  },
  pharmacyDispenseAbsentHint: {
    bn: 'এই সংস্করণে ব্যবস্থাপত্র লেখা হয় না, তাই স্ক্যান করার মতো কিছু নেই।',
    en: 'Prescriptions are not written in this version, so there is nothing to scan.',
  },

  // --- Hospital admin dashboard (S-B-10, FR-ADM-01..10) --------------------
  adminSection: { bn: 'হাসপাতাল ড্যাশবোর্ড', en: 'Hospital dashboard' },
  openAdmin: { bn: 'ড্যাশবোর্ড খুলুন', en: 'Open the dashboard' },
  adminTitle: { bn: 'হাসপাতাল ড্যাশবোর্ড', en: 'Hospital dashboard' },
  adminTabToday: { bn: 'সারসংক্ষেপ', en: 'Overview' },
  adminTabTrends: { bn: 'প্রবণতা', en: 'Trends' },
  adminTabLoss: { bn: 'ক্ষতি ও পুনরুদ্ধার', en: 'Loss & recovery' },
  adminTabRevenue: { bn: 'আয়', en: 'Revenue' },
  adminTabStaff: { bn: 'চিকিৎসক', en: 'Staff' },
  adminTabBeds: { bn: 'বেড', en: 'Beds' },
  adminTabReferrals: { bn: 'রেফারেল', en: 'Referrals' },
  adminTabFeedback: { bn: 'মতামত', en: 'Feedback' },
  adminTabForecast: { bn: 'পূর্বাভাস', en: 'Forecast' },

  adminRangeToday: { bn: 'আজ', en: 'Today' },
  adminRange7: { bn: 'গত ৭ দিন', en: 'Last 7 days' },
  adminRange30: { bn: 'গত ৩০ দিন', en: 'Last 30 days' },
  adminRange90: { bn: 'গত ৯০ দিন', en: 'Last 90 days' },
  adminExport: { bn: 'CSV নামান', en: 'Download CSV' },
  adminPrint: { bn: 'PDF হিসেবে ছাপুন', en: 'Print as PDF' },
  adminExporting: { bn: 'তৈরি হচ্ছে…', en: 'Preparing…' },
  adminExportFailed: {
    bn: 'নামানো যায়নি — আবার চেষ্টা করুন',
    en: 'Could not download — try again',
  },
  adminExportOffline: { bn: 'CSV নামাতে সংযোগ লাগবে', en: 'Downloading needs a connection' },
  adminOffline: {
    bn: 'সংযোগ নেই, তাই ড্যাশবোর্ড আনা যায়নি।',
    en: 'There is no connection, so the dashboard could not be fetched.',
  },
  adminOfflineStale: {
    bn: 'সংযোগ নেই — শেষবার পাওয়া হিসাব দেখানো হচ্ছে। প্রতিটি অংশে তার বয়স লেখা আছে।',
    en: 'Offline — showing the last figures received. Each section says how old its figures are.',
  },
  adminNeverRecorded: { bn: 'এখনো কিছু লেখা হয়নি', en: 'Nothing recorded yet' },

  adminSeen: { bn: 'রোগী দেখা হয়েছে', en: 'Patients seen' },
  adminBooked: { bn: 'মোট সিরিয়াল', en: 'Serials booked' },
  adminNoShows: { bn: 'অনুপস্থিত', en: 'No-shows' },
  adminWalkinRatio: { bn: 'ওয়াক-ইন / আগাম', en: 'Walk-in / booked' },
  adminOverrun: { bn: 'নির্ধারিত সময়ের চেয়ে দেরি', en: 'Later than the slot' },
  adminLongestOverrun: { bn: 'সবচেয়ে বেশি দেরি', en: 'Worst overrun' },
  adminSessionsLate: { bn: 'দেরিতে চলা চেম্বার', en: 'Chambers running late' },
  adminSessionsNeverStarted: { bn: 'শুরুই হয়নি', en: 'Never started' },

  /** FR-ADM-01's own wording, and why this product cannot answer it yet. */
  adminWaitUnmeasured: {
    bn: 'এই সময়ে অপেক্ষা মাপা যায়নি',
    en: 'No wait was measured in this period',
  },
  adminWaitUnmeasuredWhy: {
    bn: 'অপেক্ষা মাপা হয় কাউন্টারে "এসেছেন" চাপার সময় থেকে ডাকা পর্যন্ত। এই সময়ে কাউকে চেক-ইন করে ডাকা হয়নি। নিচের হিসাব নির্ধারিত সময়ের তুলনায় কত দেরিতে ডাকা হয়েছে।',
    en: 'Wait runs from check-in at the counter to being called, and nobody was checked in and called in this period. The figure below is how much later than their slot people were called.',
  },
  adminAvgWait: { bn: 'গড় অপেক্ষা', en: 'Average wait' },
  adminLongestWait: { bn: 'সবচেয়ে বেশি অপেক্ষা', en: 'Longest wait' },
  adminWaitsMeasured: { bn: '{count} জনের চেক-ইন থেকে', en: 'From {count} check-ins' },
  adminQuotesKept: { bn: 'বলা সময়ের মধ্যে ডাকা', en: 'Called within the quote' },
  adminQuotesKeptNote: {
    bn: '{quoted} জনের মধ্যে {kept} জন',
    en: '{kept} of {quoted}',
  },
  adminQuoteOver: { bn: 'বলা সময়ের চেয়ে গড় দেরি', en: 'Average past the quote' },
  adminQuoteNoOverrun: { bn: 'দেরি হয়নি', en: 'No overrun' },
  adminQuoteEarlyBy: {
    bn: 'গড়ে {minutes} মিনিট আগেই ডাকা হয়েছে',
    en: 'Called {minutes} min early on average',
  },
  adminNothingCollected: {
    bn: 'এই সময়ে এখনো কোনো টাকা আদায় হয়নি।',
    en: 'Nothing has been collected in this period yet.',
  },

  adminAdoption: { bn: 'লাইভ সিরিয়াল চালু', en: 'Live queue went live' },
  adminTrendCaption: {
    bn: 'প্রতিদিন গড়ে কত মিনিট দেরিতে ডাকা হয়েছে',
    en: 'Average minutes later than the slot, by day',
  },

  adminLossChartTitle: {
    bn: 'প্রতিদিন — যা আদায় হয়নি আর যা ফেরত এসেছে',
    en: 'By day — never collected, and recovered',
  },
  adminForgone: { bn: 'খালি চেয়ারের মূল্য', en: 'Value of empty chairs' },
  adminPrepaid: { bn: 'এর মধ্যে আগেই নেওয়া', en: 'Of which already paid' },
  adminUncollected: { bn: 'যা আদায় হয়নি', en: 'Never collected' },
  adminRecovered: { bn: 'স্ট্যান্ডবাই থেকে ফেরত', en: 'Recovered from standby' },
  adminNetLoss: { bn: 'প্রকৃত ক্ষতি', en: 'Net loss' },
  adminOffersMade: { bn: 'প্রস্তাব পাঠানো', en: 'Offers made' },
  adminOffersAccepted: { bn: 'গ্রহণ করা হয়েছে', en: 'Accepted' },
  adminRecoveryRate: { bn: 'পুনরুদ্ধারের হার', en: 'Recovery rate' },

  adminBilled: { bn: 'বিল করা হয়েছে', en: 'Billed' },
  adminCollected: { bn: 'আদায় হয়েছে', en: 'Collected' },
  adminRefunded: { bn: 'ফেরত', en: 'Refunded' },
  adminByDoctor: { bn: 'ডাক্তার অনুযায়ী', en: 'By doctor' },
  adminByDepartment: { bn: 'বিভাগ অনুযায়ী', en: 'By department' },
  adminByMethod: { bn: 'পরিশোধের মাধ্যম', en: 'By payment method' },
  adminByService: { bn: 'সেবা অনুযায়ী', en: 'By service' },
  adminServiceConsultation: { bn: 'চেম্বার', en: 'Consultation' },
  adminServiceTest: { bn: 'টেস্ট', en: 'Tests' },
  adminServiceBed: { bn: 'বেড', en: 'Beds' },
  adminServiceAmbulance: { bn: 'অ্যাম্বুলেন্স', en: 'Ambulance' },
  adminBookings: { bn: 'সিরিয়াল', en: 'Serials' },
  adminMethodBkash: { bn: 'বিকাশ', en: 'bKash' },
  adminMethodNagad: { bn: 'নগদ (মোবাইল)', en: 'Nagad' },
  adminMethodCard: { bn: 'কার্ড', en: 'Card' },
  adminMethodCash: { bn: 'ক্যাশ', en: 'Cash' },
  adminMethodAtHospital: { bn: 'হাসপাতালের কাউন্টারে', en: 'At the counter' },
  adminMethodUnpaid: { bn: 'এখনো পরিশোধ হয়নি', en: 'Not yet paid' },
  adminServiceNotCharged: {
    bn: 'এই সংস্করণে এর জন্য কোনো টাকা নেওয়া হয় না।',
    en: 'Nothing is charged for this in this version.',
  },

  adminDoctor: { bn: 'ডাক্তার', en: 'Doctor' },
  adminChambersCount: { bn: '{count}টি চেম্বার', en: '{count} chambers' },
  adminMedianLate: { bn: 'সাধারণত দেরি', en: 'Typically late by' },
  adminWorstLate: { bn: 'সবচেয়ে খারাপ দিন', en: 'Worst day' },
  adminOnTimeRate: { bn: 'সময়মতো শুরু', en: 'Started on time' },
  adminAvgConsult: { bn: 'গড় সময় প্রতি রোগী', en: 'Average per patient' },
  adminNeverStartedNote: { bn: 'কোনো চেম্বার শুরু হয়নি', en: 'No chamber was started' },

  adminBedKind: { bn: 'বেডের ধরন', en: 'Kind of bed' },
  adminBedsNone: {
    bn: 'এই প্রতিষ্ঠানে ভর্তির বেড নেই।',
    en: 'This facility has no inpatient beds.',
  },
  adminBedOccupied: { bn: 'ভর্তি', en: 'Occupied' },
  adminAdmissions: { bn: 'ভর্তি হয়েছে', en: 'Admissions' },
  adminAlos: { bn: 'গড় অবস্থান', en: 'Average stay' },
  adminTurnover: { bn: 'বেড খালি থাকার সময়', en: 'Turnover' },

  adminSent: { bn: 'পাঠানো', en: 'Sent' },
  adminReceived: { bn: 'পাওয়া', en: 'Received' },
  adminAccepted: { bn: 'গৃহীত', en: 'Accepted' },
  adminDeclined: { bn: 'ফেরানো', en: 'Declined' },
  adminOpen: { bn: 'অপেক্ষমাণ', en: 'Open' },
  adminReferralsNone: {
    bn: 'এই প্রতিষ্ঠানের কোনো রেফারেল এখনো লেখা হয়নি।',
    en: 'No referral has been recorded for this facility yet.',
  },
  adminLeaked: { bn: 'অন্য হাসপাতালে গেছে', en: 'Went elsewhere' },
  adminLeakedNote: {
    bn: 'যাদের রেফার করা হয়েছে এবং অন্য হাসপাতাল নিয়েছে।',
    en: 'Patients referred out whom another hospital took.',
  },

  adminFeedbackResponses: { bn: 'মতামত পাওয়া গেছে', en: 'Responses' },
  adminFeedbackCategory: { bn: 'বিষয়', en: 'Category' },
  adminFeedbackScore: { bn: 'গড় নম্বর (৫-এর মধ্যে)', en: 'Average (out of 5)' },
  adminFeedbackWait: { bn: 'অপেক্ষা', en: 'Waiting' },
  adminFeedbackDoctor: { bn: 'ডাক্তার', en: 'Doctor' },
  adminFeedbackCleanliness: { bn: 'পরিচ্ছন্নতা', en: 'Cleanliness' },
  adminFeedbackBilling: { bn: 'বিলের স্বচ্ছতা', en: 'Billing honesty' },
  adminComplaints: { bn: 'অভিযোগ', en: 'Complaints' },
  adminAnswered: { bn: 'উত্তর দিয়েছেন', en: 'answered' },
  adminFeedbackSeededOnly: {
    bn: 'রোগীর মতামতের ফর্ম এই সংস্করণে নেই — এগুলো ডেমো তথ্য।',
    en: 'The patient feedback form is not in this version — these are demonstration rows.',
  },

  adminForecastCaption: {
    bn: 'বিগত সপ্তাহগুলোর একই বারের গড়',
    en: 'Average of the same weekday in recent weeks',
  },
  adminForecastExpected: { bn: 'প্রত্যাশিত', en: 'Expected' },
  adminForecastRange: { bn: 'সীমা', en: 'Range' },
  adminForecastThin: { bn: 'যথেষ্ট তথ্য নেই', en: 'Too little history' },
  adminObservations: { bn: 'দিনের তথ্য', en: 'days of history' },

  adminSlotMorning: { bn: 'সকাল', en: 'Morning' },
  adminSlotAfternoon: { bn: 'দুপুর', en: 'Afternoon' },
  adminSlotEvening: { bn: 'সন্ধ্যা', en: 'Evening' },

  adminWeekday0: { bn: 'রবিবার', en: 'Sunday' },
  adminWeekday1: { bn: 'সোমবার', en: 'Monday' },
  adminWeekday2: { bn: 'মঙ্গলবার', en: 'Tuesday' },
  adminWeekday3: { bn: 'বুধবার', en: 'Wednesday' },
  adminWeekday4: { bn: 'বৃহস্পতিবার', en: 'Thursday' },
  adminWeekday5: { bn: 'শুক্রবার', en: 'Friday' },
  adminWeekday6: { bn: 'শনিবার', en: 'Saturday' },

  adminNothingYet: { bn: 'এখনো কিছু নেই', en: 'Nothing here yet' },
  adminNothingYetHint: {
    bn: 'অন্য সময়সীমা বেছে দেখুন — এই সময়ে কিছু লেখা হয়নি।',
    en: 'Try a longer range — nothing was recorded in this one.',
  },
  adminLoadFailed: { bn: 'ড্যাশবোর্ড আসেনি', en: 'The dashboard did not load' },
  adminHours: { bn: 'ঘণ্টা', en: 'h' },

  // --- Standby and freed slots (S-B-02, FR-QUE-30, FR-REC-30) --------------
  standbyTitle: { bn: 'স্ট্যান্ডবাই তালিকা', en: 'Standby list' },
  standbyCount: { bn: '{count} জন অপেক্ষায়', en: '{count} waiting' },
  standbyPrepaidCount: {
    bn: '{count} জন আগেই পরিশোধ করেছেন — প্রস্তাব দিলেই বসানো হবে',
    en: '{count} paid already — offering seats them at once',
  },
  standbyNothingFree: {
    bn: 'কোনো সিরিয়াল খালি হলে এখান থেকে প্রস্তাব পাঠাতে পারবেন।',
    en: 'When a serial frees up, you can offer it from here.',
  },
  standbyFreedSerial: { bn: 'সিরিয়াল {serial} খালি', en: 'Serial {serial} is free' },
  standbyOffer: { bn: 'খালি সিরিয়াল দিন', en: 'Offer the freed serial' },
  standbyOffered: { bn: 'প্রস্তাব পাঠানো হয়েছে', en: 'Offered' },
  standbyAccept: { bn: 'গ্রহণ করেছেন', en: 'They accepted' },
  standbyAccepted: { bn: 'গ্রহণ করেছেন', en: 'Accepted' },
  standbyAcceptFailed: { bn: 'গ্রহণ লেখা যায়নি', en: 'The acceptance could not be recorded' },
  standbyExpired: {
    bn: 'সময় শেষ — সিরিয়ালটি পরের জনকে দেওয়া যাবে',
    en: 'The window closed — the serial can go to the next person',
  },
  standbyWaitingFor: { bn: 'উত্তরের অপেক্ষায়', en: 'Awaiting an answer' },
  standbyAnswerBy: { bn: '{time} পর্যন্ত', en: 'until {time}' },
  standbyNoOne: {
    bn: 'স্ট্যান্ডবাই তালিকায় কেউ নেই, তাই সিরিয়ালটি খালি থাকছে।',
    en: 'Nobody is on the standby list, so the serial stays empty.',
  },
  standbyOfferFailed: { bn: 'প্রস্তাব পাঠানো যায়নি', en: 'The offer could not be sent' },
  standbyRecoveredAmount: { bn: '{amount} ফেরত এসেছে', en: '{amount} recovered' },
  standbyWorking: { bn: 'পাঠানো হচ্ছে…', en: 'Sending…' },
  standbySyncing: {
    bn: 'আগের কাজ সার্ভারে পৌঁছানোর অপেক্ষায়',
    en: 'Waiting for earlier actions to reach the server',
  },
  standbyOfflineReason: {
    bn: 'সংযোগ নেই — প্রস্তাব পাঠাতে সংযোগ লাগবে',
    en: 'Offline — an offer needs a connection',
  },

  // --- The public-health tag on a visit (CHIP-B05-SIGNAL, FR-GOV-03) -------
  visitSignal: { bn: 'জনস্বাস্থ্য সংকেত', en: 'Public health signal' },
  visitSignalNone: { bn: 'কোনোটি নয়', en: 'None of these' },
  visitSignalHint: {
    bn: 'ডেঙ্গু, ডায়রিয়া বা জ্বরের রোগী হলে বাছুন — জেলার হিসাবে যোগ হয়, রোগীর নাম যায় না।',
    en: "Choose if this was dengue, diarrhoeal disease or fever — it counts towards the district, without the patient's name.",
  },

  // --- The national layer (S-B-13, FR-GOV-01..06) --------------------------
  govSection: { bn: 'জাতীয় পর্যায়', en: 'National level' },
  govSectionHint: {
    bn: 'কোনো হাসপাতালের নয় — জেলা ও সারা দেশের সমষ্টিগত হিসাব।',
    en: 'Belongs to no hospital — district and national totals.',
  },
  openGov: { bn: 'জাতীয় ড্যাশবোর্ড খুলুন', en: 'Open the national dashboard' },

  // --- S-B-12 Hospital onboarding, the platform's side (FR-ONB-*) -----------
  platformSection: { bn: 'প্ল্যাটফর্ম পরিচালনা', en: 'Platform administration' },
  platformSectionHint: {
    bn: 'নতুন হাসপাতাল যোগ করুন, যাচাই করুন, রোগীদের সামনে আনার অনুমোদন দিন।',
    en: 'Add a hospital, verify it, and approve it to go in front of patients.',
  },
  openPlatform: { bn: 'হাসপাতাল অনবোর্ডিং খুলুন', en: 'Open hospital onboarding' },
  platformTitle: { bn: 'হাসপাতাল অনবোর্ডিং', en: 'Hospital onboarding' },
  platformIntro: {
    bn: 'এখানে শুধু প্রতিষ্ঠান ও তাদের প্রস্তুতির হিসাব দেখা যায়। কোনো রোগীর তথ্য এখানে নেই।',
    en: 'This screen shows organisations and how ready they are. No patient is shown here.',
  },
  platformOffline: {
    bn: 'সংযোগ নেই। সংযোগ ফিরলে পরিবর্তন করা যাবে।',
    en: 'You are offline. Changes can be made when the connection is back.',
  },
  platformListTitle: { bn: 'হাসপাতালসমূহ', en: 'Hospitals' },
  platformNew: { bn: 'নতুন হাসপাতাল যোগ করুন', en: 'Add a hospital' },
  platformEmpty: {
    bn: 'এখনো কোনো হাসপাতাল যোগ করা হয়নি।',
    en: 'No hospital has been added yet.',
  },
  platformLoadFailed: { bn: 'তথ্য আনা যায়নি।', en: 'This could not be loaded.' },
  platformListAge: { bn: 'এখনো আনা হয়নি', en: 'Not loaded yet' },
  platformPickOne: {
    bn: 'তালিকা থেকে একটি হাসপাতাল বেছে নিন, অথবা নতুন একটি যোগ করুন।',
    en: 'Choose a hospital from the list, or add a new one.',
  },
  platformWaitingCount: { bn: 'পর্যালোচনার অপেক্ষায়: {count}', en: 'Waiting for review: {count}' },
  platformStateSetup: { bn: 'সেটআপ চলছে', en: 'Setting up' },
  platformStateReview: { bn: 'পর্যালোচনার অপেক্ষায়', en: 'Waiting for review' },
  platformStateActive: { bn: 'লাইভ', en: 'Live' },
  platformStateSuspended: { bn: 'স্থগিত', en: 'Suspended' },
  platformStateClosed: { bn: 'বন্ধ', en: 'Closed' },
  platformCode: { bn: 'কোড {code}', en: 'Code {code}' },
  platformRegistration: { bn: 'নিবন্ধন নম্বর: {number}', en: 'Registration number: {number}' },
  platformRegistrationNone: {
    bn: 'নিবন্ধন নম্বর দেওয়া হয়নি',
    en: 'No registration number given',
  },
  platformRequestedAt: { bn: 'অনুরোধ এসেছে {when}', en: 'Requested {when}' },
  platformLastNote: { bn: 'হাসপাতালকে জানানো হয়েছে: {note}', en: 'The hospital was told: {note}' },
  platformDoctors: { bn: 'ডাক্তার ও বিএমডিসি যাচাই', en: 'Doctors and BMDC verification' },
  platformVerifyHint: {
    bn: 'বিএমডিসির নিবন্ধন তালিকায় নাম ও নম্বর মিলিয়ে দেখার পরেই চিহ্নিত করুন।',
    en: 'Mark a doctor only after checking the name and number against the BMDC register.',
  },
  platformNoDoctors: {
    bn: 'এখনো কোনো ডাক্তার যোগ করা হয়নি।',
    en: 'No doctor has been added yet.',
  },
  platformBmdc: { bn: 'বিএমডিসি {number}', en: 'BMDC {number}' },
  platformVerified: { bn: 'যাচাই হয়েছে', en: 'Verified' },
  platformUnverified: { bn: 'যাচাই বাকি', en: 'Not verified' },
  platformVerify: { bn: 'যাচাই হয়েছে বলে চিহ্নিত করুন', en: 'Mark as verified' },
  platformAdmins: { bn: 'হাসপাতালের প্রশাসক', en: 'The hospital’s administrators' },
  platformActionsTitle: { bn: 'সিদ্ধান্ত', en: 'Decision' },
  platformNoActions: {
    bn: 'এখন হাসপাতালের পালা। তারা পর্যালোচনার অনুরোধ করলে এখানে সিদ্ধান্ত নেওয়া যাবে।',
    en: 'It is the hospital’s move. A decision can be made here once they ask for review.',
  },
  platformClosedLine: {
    bn: 'এই ওয়ার্কস্পেস বন্ধ। আর কোনো পরিবর্তন করা যাবে না।',
    en: 'This workspace is closed. Nothing more can be changed.',
  },
  platformApprove: { bn: 'অনুমোদন দিয়ে লাইভ করুন', en: 'Approve and go live' },
  platformSendBack: { bn: 'ফেরত পাঠান', en: 'Send back' },
  platformSuspend: { bn: 'স্থগিত করুন', en: 'Suspend' },
  platformReinstate: { bn: 'আবার চালু করুন', en: 'Reinstate' },
  platformClose: { bn: 'স্থায়ীভাবে বন্ধ করুন', en: 'Close permanently' },
  platformCloseConfirm: {
    bn: 'বন্ধ করলে আর চালু করা যাবে না, বুঝেছি',
    en: 'I understand a closed workspace cannot be reopened',
  },
  platformNoteLabel: { bn: 'হাসপাতালকে যা জানাবেন', en: 'What to tell the hospital' },
  platformNoteHelper: {
    bn: 'ফেরত পাঠাতে, স্থগিত করতে বা বন্ধ করতে কারণ লিখতে হবে। হাসপাতালের প্রশাসক এটি পড়বেন।',
    en: 'A reason is required to send back, suspend or close. The hospital’s administrator reads it.',
  },
  platformNoteRequired: {
    bn: 'আগে কারণ লিখুন।',
    en: 'Write the reason first.',
  },
  platformNotReady: {
    bn: 'এখনই অনুমোদন দেওয়া যাবে না। বাকি আছে: {items}',
    en: 'This cannot be approved yet. Missing: {items}',
  },
  platformItemVerified: {
    bn: 'অন্তত একজন যাচাই হওয়া ডাক্তার',
    en: 'at least one verified doctor',
  },
  platformChanged: {
    bn: 'এই হাসপাতালের অবস্থা এর মধ্যে বদলে গেছে। নতুন অবস্থা দেখানো হলো।',
    en: 'This hospital’s state changed in the meantime. The current state is shown.',
  },
  platformActionFailed: {
    bn: 'কাজটি হয়নি। আবার চেষ্টা করুন।',
    en: 'That did not go through. Try again.',
  },
  platformFormTitle: { bn: 'নতুন হাসপাতালের ওয়ার্কস্পেস', en: 'A new hospital workspace' },
  platformFormIntro: {
    bn: 'ওয়ার্কস্পেস তৈরি হলে হাসপাতালের প্রশাসক নিজে বিভাগ, ডাক্তার ও সময়সূচি যোগ করবেন। আপনার অনুমোদনের আগে কিছুই রোগীদের সামনে যাবে না।',
    en: 'Once the workspace exists, the hospital’s administrator adds departments, doctors and schedules. Nothing reaches patients before you approve it.',
  },
  platformFieldNameBn: { bn: 'হাসপাতালের নাম (বাংলা)', en: 'Hospital name (Bangla)' },
  platformFieldNameEn: { bn: 'হাসপাতালের নাম (ইংরেজি)', en: 'Hospital name (English)' },
  platformFieldCode: { bn: 'হাসপাতালের কোড', en: 'Hospital code' },
  platformFieldCodeHelp: {
    bn: 'ইংরেজি অক্ষর ও সংখ্যা, যেমন MARKS। পরে বদলানো যায় না।',
    en: 'Letters and digits, such as MARKS. It cannot be changed later.',
  },
  platformFieldRegistration: {
    bn: 'নিবন্ধন বা লাইসেন্স নম্বর',
    en: 'Registration or licence number',
  },
  platformFieldKind: { bn: 'ধরন', en: 'Kind' },
  platformFieldDivision: { bn: 'প্রশাসনিক বিভাগ', en: 'Division' },
  platformFieldDistrict: { bn: 'জেলা', en: 'District' },
  platformFieldAdminName: { bn: 'প্রথম প্রশাসকের নাম', en: 'First administrator’s name' },
  platformFieldAdminEmail: { bn: 'প্রথম প্রশাসকের ইমেইল', en: 'First administrator’s email' },
  platformCreate: { bn: 'ওয়ার্কস্পেস তৈরি করুন', en: 'Create the workspace' },
  platformCancel: { bn: 'বাতিল করুন', en: 'Cancel' },
  platformDuplicateCode: {
    bn: 'এই কোড আগে থেকেই আছে। অন্য কোড দিন।',
    en: 'That code is already in use. Choose another.',
  },
  platformInvalid: {
    bn: 'সব ঘর ঠিকভাবে পূরণ করুন।',
    en: 'Fill in every field correctly.',
  },
  platformCreatedTitle: { bn: 'ওয়ার্কস্পেস তৈরি হয়েছে', en: 'The workspace has been created' },
  platformCreatedLine: {
    bn: 'এই অস্থায়ী পাসওয়ার্ড শুধু একবার দেখানো হচ্ছে। {email} ঠিকানার প্রশাসককে নিজে পৌঁছে দিন। প্রথমবার ঢুকে তিনি এটি বদলাবেন।',
    en: 'This temporary password is shown once. Hand it to the administrator at {email} yourself. They change it at first sign-in.',
  },
  platformTempPassword: { bn: 'অস্থায়ী পাসওয়ার্ড', en: 'Temporary password' },
  platformCreatedDone: { bn: 'হাসপাতালটি দেখুন', en: 'Open the hospital' },

  govTitle: { bn: 'জাতীয় ড্যাশবোর্ড', en: 'National dashboard' },
  govAggregateOnly: {
    bn: 'এখানে শুধু জেলা ও দেশের সমষ্টিগত হিসাব — কোনো রোগী বা প্রতিষ্ঠানের নাম নেই।',
    en: 'District and national totals only — no patient and no facility is named here.',
  },
  govTabCapacity: { bn: 'ধারণক্ষমতা', en: 'Capacity' },
  govTabEr: { bn: 'জরুরি চাপ', en: 'Emergency load' },
  govTabSignals: { bn: 'রোগ-সংকেত', en: 'Disease signals' },
  govTabBenchmarks: { bn: 'তুলনা', en: 'Benchmarks' },
  govLoadFailed: { bn: 'জাতীয় ড্যাশবোর্ড আসেনি', en: 'The national dashboard did not load' },
  govOffline: {
    bn: 'সংযোগ নেই — জাতীয় ড্যাশবোর্ড খুলতে সংযোগ লাগবে।',
    en: 'Offline — the national dashboard needs a connection.',
  },
  govOfflineStale: {
    bn: 'সংযোগ নেই — শেষ পাওয়া হিসাব দেখানো হচ্ছে, কত পুরোনো তা সহ।',
    en: 'Offline — showing the last figures received, with their age.',
  },

  govNational: { bn: 'সারা দেশ', en: 'Nationwide' },
  govByDistrict: { bn: 'জেলা অনুযায়ী', en: 'By district' },
  govFacilities: { bn: '{count}টি প্রতিষ্ঠান', en: '{count} facilities' },
  govBedsFree: { bn: 'খালি বেড', en: 'Free beds' },
  govBedKind: { bn: 'বেডের ধরন', en: 'Bed type' },
  govIcuFree: { bn: 'খালি আইসিইউ', en: 'Free ICU' },
  govBurnUnits: { bn: 'বার্ন ইউনিট চালু', en: 'Burn units open' },
  govErActive: { bn: 'জরুরি বিভাগে এখন', en: 'In emergency now' },
  govFreeOfTotal: { bn: '{total}টির মধ্যে', en: 'of {total}' },
  govFreeOfTotalInline: { bn: '{total}টির মধ্যে {free}টি', en: '{free} of {total}' },
  govNoIcu: { bn: 'আইসিইউ নেই', en: 'No ICU' },
  govNoBeds: { bn: 'ভর্তির বেড নেই', en: 'No inpatient beds' },
  govUnrecorded: { bn: 'হিসাব রাখা হয় না', en: 'Not recorded' },
  govUnrecordedVentilators: { bn: 'ভেন্টিলেটর', en: 'Ventilators' },
  govUnrecordedBlood: { bn: 'রক্তের মজুত', en: 'Blood stock' },
  govUnrecordedWhy: {
    bn: 'এই সংস্করণে কোনো প্রতিষ্ঠান এগুলোর হিসাব দেয় না, তাই শূন্য না লিখে ফাঁকা রাখা হয়েছে।',
    en: 'No facility reports these in this version, so they are left blank rather than shown as zero.',
  },

  govErCaption: {
    bn: 'গত {hours} ঘণ্টায় জরুরি বিভাগে আসা রোগী, ঘণ্টা অনুযায়ী',
    en: 'Emergency arrivals in the last {hours} hours, hour by hour',
  },
  govErLegend: {
    bn: 'ঘর যত গাঢ়, সেই ঘণ্টায় তত বেশি রোগী এসেছেন।',
    en: 'The darker the cell, the more people arrived that hour.',
  },
  govErCell: {
    bn: '{district}, {hour}: {cases} জন, এর মধ্যে {red} জন সংকটাপন্ন',
    en: '{district}, {hour}: {cases} arrived, {red} critical',
  },
  govErOnTheWay: { bn: 'পথে আছেন', en: 'On the way' },
  govErRed: { bn: 'সংকটাপন্ন', en: 'Critical' },
  govErNone: {
    bn: 'কোনো জেলার জরুরি বিভাগ এখনো কোনো রোগী লেখেনি।',
    en: 'No district emergency department has recorded anybody yet.',
  },
  govDistrict: { bn: 'জেলা', en: 'District' },

  govSignalsRule: {
    bn: 'এই সপ্তাহে অন্তত {min}টি রোগী এবং স্বাভাবিক সপ্তাহের অন্তত {ratio} গুণ হলে সতর্কতা।',
    en: 'Flagged at {min} or more cases this week and at least {ratio}× the usual week.',
  },
  govSignalsSource: {
    bn: 'ডাক্তার ভিজিটে যে সংকেত দেন, তা থেকে গোনা — সংকেত না দিলে গোনা হয় না।',
    en: 'Counted from the tag a doctor puts on a visit — an untagged visit is not counted.',
  },
  govSignal: { bn: 'রোগ', en: 'Signal' },
  govSignalThisWeek: { bn: 'এই সপ্তাহে', en: 'This week' },
  govSignalUsual: { bn: 'স্বাভাবিক সপ্তাহে', en: 'Usual week' },
  govSignalStatus: { bn: 'অবস্থা', en: 'Status' },
  govSignalSpike: { bn: 'হঠাৎ বৃদ্ধি', en: 'Spike' },
  govSignalNormal: { bn: 'স্বাভাবিক', en: 'Normal' },
  govSignalThin: { bn: 'যথেষ্ট তথ্য নেই', en: 'Too little history' },
  govSignalsNone: {
    bn: 'কোনো জেলা এখনো ভিজিটের তথ্য পাঠায়নি।',
    en: 'No district is reporting visits yet.',
  },

  govBenchCaption: {
    bn: 'গত {days} দিন — প্রতিষ্ঠানের নাম ছাড়া, প্রতিটি মাপ আলাদাভাবে সাজানো।',
    en: 'The last {days} days — no facility named, each measure ranked on its own.',
  },
  govBenchMedian: { bn: 'মাঝামাঝি: {value}', en: 'Median: {value}' },
  govBenchTooFew: {
    bn: '{count}টি প্রতিষ্ঠানের তথ্য তুলনার জন্য যথেষ্ট নয়',
    en: '{count} facilities had too little data to compare',
  },
  govBenchNone: { bn: 'তুলনা করার মতো তথ্য নেই', en: 'Nothing to compare yet' },
  govBenchLower: { bn: 'কম হলে ভালো', en: 'Lower is better' },
  govBenchHigher: { bn: 'বেশি হলে ভালো', en: 'Higher is better' },
  govBenchSample: { bn: '{count}টি থেকে', en: 'from {count}' },
  govMeasureWait: {
    bn: 'চেক-ইন থেকে ডাক পর্যন্ত গড় অপেক্ষা',
    en: 'Average wait, check-in to call',
  },
  govMeasureTurnaround: { bn: 'ল্যাব রিপোর্ট পেতে সময় (মাঝামাঝি)', en: 'Lab turnaround (median)' },
  govMeasureScoreWait: { bn: 'রোগীর মতামত: অপেক্ষা', en: 'Patient rating: waiting' },
  govMeasureScoreDoctor: { bn: 'রোগীর মতামত: ডাক্তার', en: 'Patient rating: doctor' },
  govMeasureScoreCleanliness: {
    bn: 'রোগীর মতামত: পরিচ্ছন্নতা',
    en: 'Patient rating: cleanliness',
  },
  govMeasureScoreBilling: {
    bn: 'রোগীর মতামত: বিলের স্বচ্ছতা',
    en: 'Patient rating: billing honesty',
  },
  govOutOfFive: { bn: '৫-এর মধ্যে', en: 'out of 5' },

  // --- Hospital settings (S-B-11, pilot step 22, FR-SUP-01, FR-ADM-11) ------
  settingsTitle: { bn: 'হাসপাতালের সেটিংস', en: 'Hospital settings' },
  settingsOpen: { bn: 'সেটিংস খুলুন', en: 'Open settings' },
  settingsBackToDashboard: { bn: 'ড্যাশবোর্ডে ফিরুন', en: 'Back to the dashboard' },
  settingsTabProfile: { bn: 'প্রতিষ্ঠান', en: 'Facility' },
  settingsTabDepartments: { bn: 'বিভাগ', en: 'Departments' },
  settingsTabDoctors: { bn: 'ডাক্তার ও চেম্বার', en: 'Doctors and chambers' },
  settingsTabBeds: { bn: 'ওয়ার্ড ও বেড', en: 'Wards and beds' },
  settingsTabCapabilities: { bn: 'জরুরি সেবা', en: 'Emergency services' },
  settingsTabStaff: { bn: 'কর্মী', en: 'Staff' },
  settingsLoadFailed: { bn: 'সেটিংস আনা যায়নি।', en: 'Could not load the settings.' },
  settingsOffline: {
    bn: 'ইন্টারনেট সংযোগ নেই। সংযোগ ফিরলে সেটিংস দেখা যাবে।',
    en: 'No connection. The settings will appear when it returns.',
  },
  settingsOfflineStale: {
    bn: 'ইন্টারনেট সংযোগ নেই। শেষবার যা পাওয়া গেছে তা দেখানো হচ্ছে; সংযোগ না ফেরা পর্যন্ত কিছু সংরক্ষণ করা যাবে না।',
    en: 'No connection. Showing what was last loaded; nothing can be saved until it returns.',
  },
  settingsSaveOffline: {
    bn: 'সংরক্ষণ করতে ইন্টারনেট সংযোগ লাগবে',
    en: 'Saving needs a connection',
  },
  settingsNeedFields: { bn: 'প্রয়োজনীয় ঘরগুলো পূরণ করুন', en: 'Fill in the required fields' },
  settingsSaved: { bn: 'সংরক্ষণ করা হয়েছে', en: 'Saved' },
  settingsSaveFailed: {
    bn: 'সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।',
    en: 'Could not save. Try again.',
  },
  settingsInvalid: {
    bn: 'কিছু ঘর ঠিকমতো পূরণ হয়নি।',
    en: 'Some fields are not filled in correctly.',
  },
  settingsDuplicateCode: { bn: 'এই কোড আগেই ব্যবহার হয়েছে।', en: 'That code is already in use.' },
  settingsDuplicateBmdc: {
    bn: 'এই ডাক্তার এই বিভাগে আগেই আছেন।',
    en: 'That doctor is already in this department.',
  },
  settingsDuplicateSchedule: {
    bn: 'এই সময়ে এই ডাক্তারের আরেকটি চেম্বার আছে।',
    en: 'This doctor already has a chamber at that time.',
  },
  settingsDuplicateLabel: {
    bn: 'এই বেড নম্বরগুলো আগেই আছে: {labels}',
    en: 'These bed labels already exist: {labels}',
  },
  settingsDuplicateEmail: {
    bn: 'এই ইমেইলে আগেই একটি অ্যাকাউন্ট আছে।',
    en: 'An account with that email already exists.',
  },
  settingsDuplicateStaffCode: {
    bn: 'এই কর্মী কোড আগেই ব্যবহার হয়েছে।',
    en: 'That staff code is already in use.',
  },
  settingsNotAllowedOwnAccess: {
    bn: 'নিজের অ্যাকাউন্ট বা প্রশাসকের দায়িত্ব নিজে বন্ধ করা যায় না।',
    en: 'You cannot deactivate yourself or remove your own administrator role.',
  },
  settingsNotAllowedOwnPassword: {
    bn: 'নিজের পাসওয়ার্ড এখান থেকে নয়, পাসওয়ার্ড বদলের পাতা থেকে বদলান।',
    en: 'Change your own password from the password screen, not here.',
  },
  settingsNotAllowedOwnTwoFactor: {
    bn: 'নিজের দুই ধাপের যাচাই নিজে রিসেট করা যায় না। অন্য একজন প্রশাসককে বলুন।',
    en: 'You cannot reset your own two-step verification. Ask another administrator.',
  },
  settingsNotAllowedVerified: {
    bn: 'বিএমডিসি যাচাই হওয়া ডাক্তারের নাম বদলানো যায় না।',
    en: 'A doctor whose BMDC number is verified cannot be renamed.',
  },
  settingsNotAllowedShared: {
    bn: 'এই ডাক্তার অন্য প্রতিষ্ঠানেও আছেন, তাই নাম এখান থেকে বদলানো যায় না।',
    en: 'This doctor also sits at another facility, so their name cannot be changed here.',
  },
  settingsNotAllowedNothing: {
    bn: 'লাইভ করার আগে অন্তত একটি বিভাগ ও একজন সক্রিয় ডাক্তার যোগ করুন।',
    en: 'Add at least one department and one active doctor before going live.',
  },
  settingsLiveNow: {
    bn: 'রোগীরা এই প্রতিষ্ঠান দেখতে পাচ্ছেন',
    en: 'Patients can see this facility',
  },
  settingsNotLive: {
    bn: 'এখনো লাইভ নয় — রোগীরা এই প্রতিষ্ঠান দেখতে পাচ্ছেন না',
    en: 'Not live yet — patients cannot see this facility',
  },
  // The workspace's state and its checklist (FR-ONB-02 to FR-ONB-04). Going
  // live is asked for here and approved by the platform (S-B-12).
  settingsStateSetup: {
    bn: 'এখনো রোগীদের সামনে নেই। নিচের ধাপগুলো শেষ হলে পর্যালোচনার অনুরোধ করুন।',
    en: 'Not in front of patients yet. When the steps below are done, ask for review.',
  },
  settingsStateReview: {
    bn: 'পর্যালোচনার অনুরোধ পাঠানো হয়েছে। প্ল্যাটফর্ম অনুমোদন দিলে হাসপাতাল রোগীদের সামনে আসবে।',
    en: 'Review has been requested. The hospital goes in front of patients when the platform approves it.',
  },
  settingsStateSuspended: {
    bn: 'এই হাসপাতাল এখন স্থগিত আছে। রোগীরা এটি দেখতে পাচ্ছেন না।',
    en: 'This hospital is suspended. Patients cannot see it.',
  },
  settingsStateClosed: {
    bn: 'এই ওয়ার্কস্পেস বন্ধ করা হয়েছে।',
    en: 'This workspace has been closed.',
  },
  settingsReviewNote: { bn: 'প্ল্যাটফর্মের বার্তা: {note}', en: 'From the platform: {note}' },
  settingsRequestReview: { bn: 'পর্যালোচনার অনুরোধ করুন', en: 'Request review' },
  settingsReviewRequested: { bn: 'অনুরোধ পাঠানো হয়েছে', en: 'Review requested' },
  settingsChecklistTitle: {
    bn: 'রোগীদের সামনে আসার আগে যা লাগবে',
    en: 'What is needed before going in front of patients',
  },
  settingsCheckDone: { bn: 'আছে', en: 'Done' },
  settingsCheckMissing: { bn: 'বাকি', en: 'Missing' },
  settingsCheckOptional: { bn: 'ঐচ্ছিক', en: 'Optional' },
  settingsCheckByPlatform: { bn: 'প্ল্যাটফর্ম যাচাই করবে', en: 'The platform verifies these' },
  settingsCountVerified: { bn: 'যাচাই হওয়া ডাক্তার: {count}', en: 'Verified doctors: {count}' },
  settingsMissingLine: { bn: 'অনুরোধের আগে যোগ করুন: {items}', en: 'Add before asking: {items}' },
  settingsItemDepartments: { bn: 'বিভাগ', en: 'a department' },
  settingsItemDoctors: { bn: 'ডাক্তার', en: 'a doctor' },
  settingsItemSchedules: { bn: 'সাপ্তাহিক চেম্বার', en: 'a weekly chamber' },
  settingsItemStaff: { bn: 'কর্মী', en: 'a staff member' },
  settingsWays: {
    bn: 'পূরণ করার তিন উপায়: এই পাতায় হাতে লিখে, আমাদের ছকের CSV দিয়ে, অথবা আপনাদের নিজস্ব সিস্টেমের এক্সপোর্ট ফাইল দিয়ে।',
    en: 'Three ways to fill these in: by hand on this page, with our template CSV, or with your own system’s export file.',
  },

  // --- S-B-14, mapping a hospital's own export (FR-IMP-13 to FR-IMP-18) -----
  importOwnFile: {
    bn: 'আপনাদের নিজস্ব সিস্টেমের এক্সপোর্ট ফাইলও দিতে পারেন। কলামের নাম আলাদা হলে মিলিয়ে নেওয়ার সুযোগ পাবেন।',
    en: 'You can also give your own system’s export. If its column names differ, you will be asked to match them.',
  },
  importFileNoHeader: {
    bn: 'ফাইলের প্রথম সারিতে কলামের নাম থাকতে হবে। এই ফাইলের প্রথম সারিতে তথ্য আছে বলে মনে হচ্ছে। উপরে নামের একটি সারি যোগ করে আবার দিন।',
    en: 'The file’s first row must hold column names. This file’s first row looks like data. Add a row of names at the top and try again.',
  },
  importMappingInvalid: {
    bn: 'মিলটি সম্পূর্ণ নয়। আবশ্যক সব তথ্যের কলাম বেছে নিন।',
    en: 'The matching is not complete. Choose a column for everything required.',
  },
  importMapTitle: { bn: 'আপনার ফাইলের কলাম মিলিয়ে নিন', en: 'Match your file’s columns' },
  importMapIntro: {
    bn: 'এই ফাইলের কলামের নাম আমাদের ছকের মতো নয়, তাই কোন কলামে কী আছে মিলিয়ে নিতে হবে। {rows}টি সারি পাওয়া গেছে। আপনি নিশ্চিত করার আগে কিছুই সংরক্ষণ হবে না।',
    en: 'This file’s column names are not our template’s, so each has to be matched. {rows} rows were found. Nothing is saved before you confirm.',
  },
  importMapSaved: {
    bn: 'এই ছকের ফাইল আপনি আগে একবার মিলিয়েছিলেন। সেই মিলই দেখানো হলো। দরকার হলে বদলে নিন।',
    en: 'You matched a file with these headings before. That matching is shown. Change it if you need to.',
  },
  importMapRowType: { bn: 'এই ফাইলে কীসের তালিকা আছে?', en: 'What is this file a list of?' },
  importMapRowTypeHint: {
    bn: 'একটি ফাইলে এক ধরনের তথ্যই থাকবে: শুধু ডাক্তার, বা শুধু বেড।',
    en: 'One file holds one kind of thing: only doctors, or only beds.',
  },
  importMapFieldHead: { bn: 'আমাদের যা দরকার', en: 'What we need' },
  importMapColumnHead: { bn: 'আপনার ফাইলের কলাম', en: 'Your file’s column' },
  importMapWhyHead: { bn: 'কেন এই কলাম', en: 'Why this column' },
  importMapRequired: { bn: 'আবশ্যক', en: 'Required' },
  importMapNone: { bn: 'এই তথ্য নেওয়া হবে না', en: 'Do not import this' },
  importMapHolds: {
    bn: 'এই কলামে আছে: {kind}। {filled}% সারিতে পূরণ করা।',
    en: 'This column holds {kind}. Filled in {filled}% of rows.',
  },
  importMapSourceRule: { bn: 'নিয়ম থেকে প্রস্তাব', en: 'Proposed by a rule' },
  importMapSourceSaved: { bn: 'আগের নিশ্চিত করা মিল', en: 'Your last confirmed matching' },
  importMapSourceModel: { bn: 'এআইয়ের প্রস্তাব', en: 'Suggested by AI' },
  importMapSourceManual: { bn: 'আপনি বেছে নিয়েছেন', en: 'Chosen by you' },
  importMapSourceNothing: { bn: 'কোনো কলাম মেলেনি', en: 'No column matched' },
  importMapSureHigh: { bn: 'নিশ্চয়তা বেশি', en: 'High confidence' },
  importMapSureMedium: { bn: 'নিশ্চয়তা মাঝারি', en: 'Medium confidence' },
  importMapSureLow: { bn: 'নিশ্চয়তা কম, দেখে নিন', en: 'Low confidence, please check' },
  importMapReasonSame: {
    bn: 'কলামের নাম আমাদের ছকের নামই।',
    en: 'The column has our template’s own name.',
  },
  importMapReasonKnown: {
    bn: 'কলামের নাম এই তথ্যের একটি পরিচিত নাম।',
    en: 'The column’s name is a known name for this.',
  },
  importMapReasonSimilar: {
    bn: 'কলামের নামের ভেতরে এই তথ্যের পরিচিত নাম আছে।',
    en: 'The column’s name contains a known name for this.',
  },
  importMapReasonShape: {
    bn: 'নাম মেলেনি, তবে শুধু এই কলামের মানগুলোই এই ধরনের।',
    en: 'The name did not match, but only this column holds values of this kind.',
  },
  importMapNotImported: {
    bn: 'এই কলামগুলো আমদানি হবে না: {columns}',
    en: 'These columns will not be imported: {columns}',
  },
  importMapAllUsed: {
    bn: 'ফাইলের সব কলাম ব্যবহার হচ্ছে।',
    en: 'Every column of the file is used.',
  },
  importMapMissing: {
    bn: 'নিশ্চিত করার আগে এগুলোর কলাম বেছে নিন: {fields}',
    en: 'Choose a column for these before confirming: {fields}',
  },
  importMapOneOf: {
    bn: 'এগুলোর যেকোনো একটির কলাম বেছে নিন: {fields}',
    en: 'Choose a column for at least one of these: {fields}',
  },
  importMapModelUsed: {
    bn: 'যেসব কলাম নিয়মে মেলেনি, সেগুলোর জন্য এআই প্রস্তাব দিয়েছে। এগুলো শুধু প্রস্তাব; দেখে তবেই নিশ্চিত করুন। ফাইলের কোনো সারি এআইকে পাঠানো হয়নি, শুধু কলামের নাম ও ধরন।',
    en: 'AI suggested columns for what the rules could not match. These are suggestions only; check them before you confirm. No row of the file was sent to the AI, only column names and kinds.',
  },
  importMapModelUnavailable: {
    bn: 'এআইয়ের প্রস্তাব এখন পাওয়া যায়নি। নিয়ম ও আপনার নিজের বাছাই দিয়ে কাজ চলবে।',
    en: 'AI suggestions are not available right now. The rules and your own choices are enough to go on.',
  },
  importMapConfirm: { bn: 'মিল নিশ্চিত করে যাচাই করুন', en: 'Confirm the matching and check' },
  importMapCancel: { bn: 'বাতিল করুন', en: 'Cancel' },
  settingsHospitalCode: { bn: 'হাসপাতাল কোড: {code}', en: 'Hospital code: {code}' },
  settingsCountDepartments: { bn: 'বিভাগ: {count}', en: 'Departments: {count}' },
  settingsCountDoctors: { bn: 'সক্রিয় ডাক্তার: {count}', en: 'Active doctors: {count}' },
  settingsCountSchedules: { bn: 'সাপ্তাহিক চেম্বার: {count}', en: 'Weekly chambers: {count}' },
  settingsCountBeds: { bn: 'বেড: {count}', en: 'Beds: {count}' },
  settingsCountStaff: { bn: 'কর্মী: {count}', en: 'Staff: {count}' },
  settingsProfileHeading: { bn: 'প্রতিষ্ঠানের তথ্য', en: 'Facility details' },
  settingsNameBn: { bn: 'নাম (বাংলায়)', en: 'Name (Bangla)' },
  settingsNameEn: { bn: 'নাম (ইংরেজিতে)', en: 'Name (English)' },
  settingsPhone: { bn: 'ফোন', en: 'Phone' },
  settingsEmergencyPhone: { bn: 'জরুরি ফোন', en: 'Emergency phone' },
  settingsPhoneHelper: { bn: '+৮৮০ দিয়ে শুরু করুন', en: 'Start with +880' },
  settingsAddressBn: { bn: 'ঠিকানা (বাংলায়)', en: 'Address (Bangla)' },
  settingsAddressEn: { bn: 'ঠিকানা (ইংরেজিতে)', en: 'Address (English)' },
  settingsThana: { bn: 'থানা', en: 'Thana' },
  settingsLat: { bn: 'অক্ষাংশ', en: 'Latitude' },
  settingsLng: { bn: 'দ্রাঘিমাংশ', en: 'Longitude' },
  settingsCoordsHelper: {
    bn: 'জরুরি অবস্থায় যাতায়াতের সময় হিসাবের জন্য। দুটোই দিন, অথবা কোনোটিই নয়।',
    en: 'Used for emergency travel times. Give both or neither.',
  },
  settingsSaveProfile: { bn: 'তথ্য সংরক্ষণ করুন', en: 'Save details' },
  settingsRulesHeading: { bn: 'সিরিয়ালের নিয়ম', en: 'Queue rules' },
  settingsGracePatients: {
    bn: 'অনুপস্থিত ধরার আগে কতজন রোগী',
    en: 'Patients to wait before a no-show',
  },
  settingsGraceMinutes: {
    bn: 'অনুপস্থিত ধরার আগে কত মিনিট',
    en: 'Minutes to wait before a no-show',
  },
  settingsReinsertAfter: {
    bn: 'দেরিতে আসা রোগী কতজন পরে বসবেন',
    en: 'A late patient is seated after this many',
  },
  settingsStaleMinutes: {
    bn: 'কত মিনিট পর তথ্য পুরোনো ধরা হবে',
    en: 'Minutes before a figure counts as stale',
  },
  settingsRulesHelper: {
    bn: 'অনুপস্থিত ধরা হয় দুটোর মধ্যে যেটি বেশি সময় নেয়, সেটি পার হলে।',
    en: 'A no-show is marked once whichever of the two takes longer has passed.',
  },
  settingsSmsBudget: { bn: 'মাসে সর্বোচ্চ এসএমএস', en: 'SMS a month, at most' },
  settingsSaveRules: { bn: 'নিয়ম সংরক্ষণ করুন', en: 'Save rules' },
  settingsDepartmentsEmpty: {
    bn: 'এখনো কোনো বিভাগ নেই। প্রথম বিভাগটি যোগ করুন।',
    en: 'No departments yet. Add the first one.',
  },
  settingsDepartmentCode: { bn: 'কোড', en: 'Code' },
  settingsDepartmentCodeHelper: {
    bn: 'ছোট ইংরেজি কোড, যেমন CARD',
    en: 'A short English code, such as CARD',
  },
  settingsAddDepartment: { bn: 'বিভাগ যোগ করুন', en: 'Add department' },
  settingsDoctorsEmpty: {
    bn: 'এখনো কোনো ডাক্তার নেই। আগে একটি বিভাগ, তারপর ডাক্তার যোগ করুন।',
    en: 'No doctors yet. Add a department first, then a doctor.',
  },
  settingsBmdc: { bn: 'বিএমডিসি নম্বর', en: 'BMDC number' },
  settingsDegrees: { bn: 'ডিগ্রি', en: 'Degrees' },
  settingsDepartment: { bn: 'বিভাগ', en: 'Department' },
  settingsFee: { bn: 'ফি (টাকা)', en: 'Fee (taka)' },
  settingsRoom: { bn: 'কক্ষ', en: 'Room' },
  settingsAddDoctor: { bn: 'ডাক্তার যোগ করুন', en: 'Add doctor' },
  settingsDoctorLinked: {
    bn: 'এই বিএমডিসি নম্বরের ডাক্তার আগেই ছিলেন; তাঁকে এই বিভাগে যুক্ত করা হয়েছে।',
    en: 'A doctor with that BMDC number already existed and has been added to this department.',
  },
  settingsVerified: { bn: 'বিএমডিসি যাচাই হয়েছে', en: 'BMDC verified' },
  settingsUnverified: {
    bn: 'যাচাই বাকি — রোগীরা এখনো দেখবেন না',
    en: 'Awaiting verification — hidden from patients',
  },
  settingsInactive: { bn: 'নিষ্ক্রিয়', en: 'Inactive' },
  settingsDeactivateDoctor: { bn: 'নিষ্ক্রিয় করুন', en: 'Deactivate' },
  settingsActivateDoctor: { bn: 'সক্রিয় করুন', en: 'Activate' },
  settingsSaveFee: { bn: 'ফি ও কক্ষ সংরক্ষণ করুন', en: 'Save fee and room' },
  settingsFeeHelper: {
    bn: 'নতুন ফি সামনের চেম্বারগুলোতে লাগবে; আগে করা বুকিংয়ের ফি বদলাবে না।',
    en: 'A new fee applies to coming chambers; bookings already made keep their fee.',
  },
  settingsSchedules: { bn: 'সাপ্তাহিক চেম্বার', en: 'Weekly chambers' },
  settingsNoSchedules: { bn: 'কোনো সাপ্তাহিক চেম্বার নেই', en: 'No weekly chambers' },
  settingsScheduleLine: { bn: '{day}, {start} থেকে {end}', en: '{day}, {start}–{end}' },
  settingsCapacityLine: { bn: 'সর্বোচ্চ {count}টি সিরিয়াল', en: 'Up to {count} serials' },
  settingsCapacity: { bn: 'সর্বোচ্চ সিরিয়াল', en: 'Serial limit' },
  settingsCapacityHelper: { bn: 'খালি রাখলে কোনো সীমা নেই', en: 'Leave empty for no limit' },
  settingsStart: { bn: 'শুরু', en: 'Starts' },
  settingsEnd: { bn: 'শেষ', en: 'Ends' },
  settingsTimeHelper: { bn: '২৪ ঘণ্টার হিসাবে, যেমন ১৭:০০', en: '24-hour clock, such as 17:00' },
  settingsAddSchedule: { bn: 'চেম্বার যোগ করুন', en: 'Add chamber' },
  settingsScheduleAdded: {
    bn: 'চেম্বার যোগ হয়েছে; সামনের আট দিনের {count}টি চেম্বার তৈরি হয়েছে।',
    en: 'Chamber added; {count} chambers created across the coming eight days.',
  },
  settingsRemoveSchedule: { bn: 'চেম্বার বাদ দিন', en: 'Remove chamber' },
  settingsScheduleRemoved: { bn: 'চেম্বার বাদ দেওয়া হয়েছে।', en: 'Chamber removed.' },
  settingsScheduleKept: {
    bn: 'চেম্বার বাদ দেওয়া হয়েছে; বুকিং থাকা {count}টি চেম্বার রাখা হয়েছে — কাউন্টার থেকে চালান বা বাতিল করুন।',
    en: 'Chamber removed; {count} chambers with bookings were kept — run or cancel them from the counter.',
  },
  settingsWardsEmpty: {
    bn: 'এখনো কোনো ওয়ার্ড নেই। একটি ওয়ার্ড যোগ করে তাতে বেড যোগ করুন।',
    en: 'No wards yet. Add a ward, then its beds.',
  },
  settingsFloor: { bn: 'তলা', en: 'Floor' },
  settingsBedKind: { bn: 'বেডের ধরন', en: 'Kind of bed' },
  settingsAddWard: { bn: 'ওয়ার্ড যোগ করুন', en: 'Add ward' },
  settingsBedLabels: { bn: 'বেড নম্বর', en: 'Bed labels' },
  settingsBedLabelsHelper: {
    bn: 'যেমন ৩০১-৩২০, অথবা কমা দিয়ে আলাদা করে',
    en: 'Such as 301-320, or separated by commas',
  },
  settingsBedLabelsInvalid: { bn: 'বেড নম্বর পড়া যায়নি।', en: 'Could not read the bed labels.' },
  settingsNightly: { bn: 'প্রতি রাতের ভাড়া (টাকা)', en: 'Nightly charge (taka)' },
  settingsAddBeds: { bn: 'বেড যোগ করুন', en: 'Add beds' },
  settingsBedsAdded: {
    bn: '{count}টি বেড যোগ হয়েছে। ওয়ার্ড বোর্ড থেকে চালু না করা পর্যন্ত এগুলো বন্ধ থাকবে।',
    en: '{count} beds added. They stay out of service until the ward brings them into service from the board.',
  },
  settingsWardLine: { bn: '{floor} তলা · {count}টি বেড', en: 'Floor {floor} · {count} beds' },
  bedUnconfirmed: {
    bn: 'সেটিংস থেকে যোগ করা — ওয়ার্ড এখনো নিশ্চিত করেনি',
    en: 'Added in settings — not yet confirmed by the ward',
  },
  settingsCapabilitiesHelper: {
    bn: 'আপনার প্রতিষ্ঠান কোন জরুরি সেবা দেয়, তা এখানে ঠিক করুন। কোনটি এই মুহূর্তে চালু, তা জরুরি বিভাগের কনসোল থেকে জানানো হয়।',
    en: 'Choose which emergency services this facility offers. Whether each is available right now is confirmed from the emergency console.',
  },
  settingsSaveCapabilities: { bn: 'জরুরি সেবা সংরক্ষণ করুন', en: 'Save emergency services' },
  settingsCapabilityAvailable: { bn: 'এখন চালু', en: 'Available now' },
  settingsCapabilityUnavailable: { bn: 'এখন বন্ধ', en: 'Not available now' },
  settingsStaffName: { bn: 'পুরো নাম', en: 'Full name' },
  settingsStaffEmail: { bn: 'ইমেইল', en: 'Email' },
  settingsStaffCode: { bn: 'কর্মী কোড (ঐচ্ছিক)', en: 'Staff code (optional)' },
  settingsStaffRoles: { bn: 'দায়িত্ব', en: 'Roles' },
  settingsNeedRole: { bn: 'অন্তত একটি দায়িত্ব বেছে নিন', en: 'Choose at least one role' },
  settingsAddStaff: { bn: 'কর্মী যোগ করুন', en: 'Add staff member' },
  settingsTempPasswordFor: {
    bn: '{name}-এর অস্থায়ী পাসওয়ার্ড',
    en: 'Temporary password for {name}',
  },
  settingsTempPasswordNote: {
    bn: 'এটি একবারই দেখানো হবে। নিজে হাতে দিন; প্রথমবার লগ ইন করলে নিজের পাসওয়ার্ড দিতে হবে।',
    en: 'Shown once. Hand it over in person; they set their own at first sign-in.',
  },
  settingsTempPasswordDone: { bn: 'দেওয়া হয়েছে, লুকান', en: 'Handed over, hide it' },
  settingsResetPassword: { bn: 'পাসওয়ার্ড রিসেট করুন', en: 'Reset password' },
  settingsDeactivateStaff: { bn: 'অ্যাকাউন্ট বন্ধ করুন', en: 'Deactivate account' },
  settingsActivateStaff: { bn: 'অ্যাকাউন্ট চালু করুন', en: 'Reactivate account' },
  settingsStaffInactive: { bn: 'বন্ধ', en: 'Deactivated' },
  settingsStaffMustChange: { bn: 'প্রথম লগ ইন বাকি', en: 'First sign-in pending' },
  settingsStaffYou: { bn: 'আপনি', en: 'You' },
  // Pilot step 28 (FR-SEC-10): the second factor, and the reset for a lost phone.
  settingsStaffTwoFactorOn: { bn: 'দুই ধাপ চালু', en: 'Two-step on' },
  settingsStaffTwoFactorMissing: { bn: 'দুই ধাপ বাকি', en: 'Two-step not set up' },
  settingsResetTwoFactor: { bn: 'দুই ধাপের যাচাই রিসেট করুন', en: 'Reset two-step' },
  settingsSaveRoles: { bn: 'দায়িত্ব সংরক্ষণ করুন', en: 'Save roles' },

  // --- Counter registration and walk-ins (S-B-03, MOD-B02-WALKIN, pilot step 23) --
  counterPhone: { bn: 'রোগীর মোবাইল নম্বর', en: "Patient's mobile number" },
  counterFind: { bn: 'খুঁজুন', en: 'Find' },
  counterPhoneInvalid: {
    bn: 'এটি বাংলাদেশের মোবাইল নম্বর নয়। যেমন ০১৭১২৩৪৫৬৭৮।',
    en: 'That is not a Bangladeshi mobile number, such as 01712345678.',
  },
  counterFound: { bn: 'এই নম্বরে যাঁরা আছেন', en: 'Registered under this number' },
  counterNoneFound: {
    bn: 'এই নম্বরে কেউ নেই — নিচে নতুন রোগী হিসেবে রেজিস্টার করুন।',
    en: 'Nobody under this number — register a new patient below.',
  },
  counterChoose: { bn: 'বেছে নিন', en: 'Choose' },
  counterChooseNamed: { bn: '{name} — বেছে নিন', en: 'Choose {name}' },
  counterNewPatient: { bn: 'নতুন রোগী', en: 'New patient' },
  counterName: { bn: 'রোগীর নাম', en: "Patient's name" },
  counterAge: { bn: 'বয়স', en: 'Age' },
  counterSex: { bn: 'লিঙ্গ', en: 'Sex' },
  counterRegister: { bn: 'রেজিস্টার করুন', en: 'Register' },
  counterAgeYears: { bn: '{age} বছর', en: '{age} years' },
  counterAccount: { bn: 'অ্যাপে অ্যাকাউন্ট আছে', en: 'Has an app account' },
  counterChangePatient: { bn: 'অন্য রোগী বেছে নিন', en: 'Choose someone else' },
  counterNeedFields: { bn: 'নাম, বয়স ও লিঙ্গ দিন', en: 'Enter the name, age and sex' },
  counterFailed: { bn: 'করা যায়নি। আবার চেষ্টা করুন।', en: 'That did not work. Try again.' },
  counterRefused: {
    bn: 'এই চেম্বারে এখন ওয়াক-ইন যোগ করা যাচ্ছে না।',
    en: 'This chamber cannot take a walk-in right now.',
  },
  walkInDescription: {
    bn: 'মোবাইল নম্বর দিয়ে খুঁজুন; না পেলে নতুন রোগী হিসেবে রেজিস্টার করুন।',
    en: 'Find them by mobile number; register a new patient if there is nobody.',
  },
  walkInWhere: { bn: 'লাইনে কোথায় বসবেন', en: 'Where in the line' },
  walkInPositionEnd: { bn: 'শেষে যোগ', en: 'At the end' },
  walkInPositionAt: { bn: 'নির্দিষ্ট অবস্থানে', en: 'At a set place' },
  walkInPlace: { bn: 'লাইনে কত নম্বরে', en: 'Place in the line' },
  walkInReason: { bn: 'কারণ', en: 'Reason' },
  walkInReasonHelper: {
    bn: 'লাইনের মাঝে বসাতে কারণ লিখতে হবে; এটি রেকর্ডে থাকবে',
    en: 'Seating someone mid-line needs a reason; it is kept on record',
  },
  walkInNeedReason: { bn: 'স্থান ও কারণ দিন', en: 'Enter the place and the reason' },
  walkInConfirm: { bn: 'সিরিয়াল দিন', en: 'Give a serial' },
  walkInAdded: {
    bn: '{name}-কে সিরিয়াল {serial} দেওয়া হয়েছে',
    en: '{name} was given serial {serial}',
  },
  walkInOffline: {
    bn: 'সিরিয়াল দিতে ইন্টারনেট সংযোগ লাগবে',
    en: 'Giving a serial needs a connection',
  },
  registrationTitle: { bn: 'রোগী রেজিস্ট্রেশন', en: 'Patient registration' },
  registrationIntro: {
    bn: 'মোবাইল নম্বর দিয়ে শুরু করুন। আগে এসে থাকলে তাঁর তথ্য এখানেই পাবেন।',
    en: 'Start with the mobile number. If they have been before, their details are here.',
  },
  registrationChambers: { bn: 'আজকের চেম্বারে যোগ করুন', en: "Add to one of today's chambers" },
  registrationNoChambers: {
    bn: 'আজ এই প্রতিষ্ঠানে কোনো চেম্বার নেই।',
    en: 'There are no chambers at this facility today.',
  },
  registrationChambersFailed: {
    bn: 'আজকের চেম্বারগুলো আনা যায়নি।',
    en: "Could not load today's chambers.",
  },
  registrationAddHere: { bn: 'এই চেম্বারে যোগ করুন', en: 'Add to this chamber' },
  registrationWaiting: { bn: '{count} জন অপেক্ষায়', en: '{count} waiting' },
  registrationChooseFirst: { bn: 'আগে রোগী বেছে নিন', en: 'Choose the patient first' },

  // --- Importing a hospital's own data (S-B-14, pilot step 24, FR-IMP) ---------
  importTitle: { bn: 'তথ্য আমদানি', en: 'Import data' },
  importOpen: { bn: 'পুরোনো তথ্য আমদানি করুন', en: 'Import existing data' },
  importIntro: {
    bn: 'আপনার হাসপাতালের নিজের সিস্টেমের তথ্য, একটি একটি সেট করে। অনুমোদনের আগে কিছুই সংরক্ষণ হয় না।',
    en: "Your hospital's own records, one set at a time. Nothing is saved until you approve it.",
  },
  importBack: { bn: 'সেটিংসে ফিরুন', en: 'Back to settings' },
  importChooseSet: { bn: 'কোন সেট আমদানি করবেন', en: 'Which set to import' },
  importSetStructure: { bn: 'ক কাঠামো', en: 'A Structure' },
  importSetPatients: { bn: 'খ রোগীর তালিকা', en: 'B Patient register' },
  importSetAppointments: { bn: 'গ আগামী অ্যাপয়েন্টমেন্ট', en: 'C Upcoming appointments' },
  importSetRecords: { bn: 'ঘ পুরোনো রিপোর্ট ও ভিজিট', en: 'D Past reports and visits' },
  importRecordsLater: {
    bn: 'পাইলট চালু হওয়ার পর, আইনি পরামর্শের পরে',
    en: "After the pilot starts, once the hospital's legal adviser agrees",
  },
  importSetStructureHelp: {
    bn: 'বিভাগ, ডাক্তার, সাপ্তাহিক চেম্বার, ওয়ার্ড ও বেড, এবং কর্মী — প্রতিটি সারির type কলামে লেখা থাকে সেটি কী।',
    en: 'Departments, doctors, weekly chambers, wards and beds, and staff — each row says which in its type column.',
  },
  importSetPatientsHelp: {
    bn: 'হাসপাতালের রোগী নম্বর, নাম, জন্মতারিখ বা বয়স, লিঙ্গ, মোবাইল ও রক্তের গ্রুপ। জাতীয় পরিচয়পত্র বা ঠিকানা নেওয়া হয় না।',
    en: "The hospital's patient number, name, date of birth or age, sex, mobile and blood group. No national ID or address is taken.",
  },
  importSetAppointmentsHelp: {
    bn: 'রোগী ও ডাক্তার আগে আমদানি হয়ে থাকতে হবে। তারিখটিতে ওই ডাক্তারের চেম্বার থাকতে হবে।',
    en: 'Its patients and doctors must be imported first, and the doctor must have a chamber on the date.',
  },
  importTemplate: { bn: 'টেমপ্লেট নামান', en: 'Download the template' },
  importTemplateFailed: { bn: 'টেমপ্লেট নামানো যায়নি।', en: 'Could not download the template.' },
  importFile: { bn: 'CSV ফাইল', en: 'CSV file' },
  importChooseFileFirst: { bn: 'আগে একটি CSV ফাইল বেছে নিন', en: 'Choose a CSV file first' },
  importCheck: { bn: 'যাচাই করুন', en: 'Check' },
  importPreviewOf: { bn: 'যাচাইয়ের ফল: {file}', en: 'Check result: {file}' },
  importCountAdd: { bn: 'যোগ', en: 'Add' },
  importCountUpdate: { bn: 'হালনাগাদ', en: 'Update' },
  importCountSkip: { bn: 'বাদ', en: 'Skip' },
  importCountError: { bn: 'ভুল', en: 'Errors' },
  importCountsLine: {
    bn: 'যোগ {add}, হালনাগাদ {update}, বাদ {skip}, ভুল {error}',
    en: 'add {add}, update {update}, skip {skip}, errors {error}',
  },
  importErrorsHeading: { bn: 'যে সারিগুলো ঠিক করতে হবে', en: 'Rows to correct' },
  importRow: { bn: 'সারি', en: 'Row' },
  importColumn: { bn: 'কলাম', en: 'Column' },
  importReason: { bn: 'কারণ', en: 'Reason' },
  importCommit: { bn: 'অনুমোদন করে সংরক্ষণ করুন', en: 'Approve and save' },
  importCommitHasErrors: {
    bn: 'ভুল থাকা অবস্থায় সংরক্ষণ করা যায় না — ফাইল ঠিক করে আবার যাচাই করুন',
    en: 'It cannot be saved with errors — correct the file and check it again',
  },
  importWarnHeading: { bn: 'অনুমোদনের আগে দেখে নিন', en: 'Look at these before approving' },
  importWarnNote: {
    bn: 'এগুলো ভুল নয়, তাই আমদানি আটকাবে না। ঠিক মনে না হলে ফাইল ঠিক করে আবার যাচাই করুন।',
    en: 'These are not errors and do not stop the import. If one looks wrong, correct the file and check it again.',
  },
  importWarnSamePerson: {
    bn: '{count}টি জায়গায় একই রোগী একাধিকবার আছে বলে মনে হচ্ছে। এদের এক করা হবে না: প্রতিটি সারি আলাদা রোগী হিসেবে আমদানি হবে।',
    en: 'In {count} places the same patient appears to be listed more than once. They will not be merged: each row is imported as a separate patient.',
  },
  importWarnSamePersonRows: { bn: 'সারি {rows} — {because}', en: 'Rows {rows}: {because}' },
  importWarnBecausePhone: { bn: 'একই নাম ও মোবাইল নম্বর', en: 'same name and mobile number' },
  importWarnBecauseBirth: { bn: 'একই নাম ও জন্ম তারিখ', en: 'same name and date of birth' },
  importWarnSamePersonMore: {
    bn: 'আরও {count}টি এখানে দেখানো হয়নি।',
    en: '{count} more are not listed here.',
  },
  importWarnMixedDate: {
    bn: '“{column}” কলামে তারিখ একাধিকভাবে লেখা: {formats}। দিন/মাস/বছর লেখা তারিখে দিন আগে ধরা হবে — ০৫/১০/২০২৬ মানে ৫ অক্টোবর ২০২৬।',
    en: 'The “{column}” column writes dates in more than one way: {formats}. A day/month/year date is read day first: 05/10/2026 is 5 October 2026.',
  },
  importWarnMixedPhone: {
    bn: '“{column}” কলামে নম্বর একাধিকভাবে লেখা: {formats}। সব নম্বর +৮৮০১… আকারে রাখা হবে।',
    en: 'The “{column}” column writes numbers in more than one way: {formats}. Every number is stored as +8801….',
  },
  importWarnFormatCount: { bn: '{format} — {count}টি সারি', en: '{format}: {count} rows' },
  importFormatIso: { bn: 'বছর-মাস-দিন', en: 'year-month-day' },
  importFormatDayFirst: { bn: 'দিন/মাস/বছর', en: 'day/month/year' },
  importFormatLocal: { bn: '০১ দিয়ে শুরু', en: 'starting with 01' },
  importFormatCountry: { bn: '৮৮০ দিয়ে শুরু', en: 'starting with 880' },
  importCommitTitle: { bn: 'আমদানি অনুমোদন করবেন?', en: 'Approve this import?' },
  importCommitBody: {
    bn: 'সব সারি একসঙ্গে সংরক্ষণ হবে। পরে দরকার হলে পুরো আমদানি ফিরিয়ে নেওয়া যাবে, যদি এর ওপর এরপর কোনো কাজ না হয়ে থাকে।',
    en: 'Every row is saved together. The whole import can be taken back later, as long as nothing has been built on it.',
  },
  importDiscard: { bn: 'বাতিল করুন', en: 'Discard' },
  importCommitted: { bn: 'আমদানি সংরক্ষণ করা হয়েছে', en: 'Import saved' },
  importDiscarded: { bn: 'আমদানি বাতিল করা হয়েছে', en: 'Import discarded' },
  importUndo: { bn: 'ফিরিয়ে নিন', en: 'Take back' },
  importUndoTitle: { bn: 'এই আমদানি ফিরিয়ে নেবেন?', en: 'Take back this import?' },
  importUndoBody: {
    bn: 'এই আমদানিতে যা যোগ হয়েছিল তা সরানো হবে, আর যা বদলানো হয়েছিল তা আগের মতো হবে।',
    en: 'What it added is removed, and what it changed is put back.',
  },
  importUndone: { bn: 'আমদানি ফিরিয়ে নেওয়া হয়েছে', en: 'Import taken back' },
  importUndoBlocked: {
    bn: 'ফিরিয়ে নেওয়া যায়নি: এই সারিগুলোর ওপর এরপর কাজ হয়েছে — {rows}',
    en: 'Could not take it back: something has been built on these rows since — {rows}',
  },
  importCommitConflict: {
    bn: 'সংরক্ষণ করা যায়নি: সারি {row}-এর তথ্য এর মধ্যে বদলে গেছে। আবার যাচাই করুন।',
    en: 'Could not save: the data behind row {row} changed meanwhile. Check the file again.',
  },
  importWrongState: {
    bn: 'এই আমদানি এখন এই অবস্থায় নেই। তালিকাটি নতুন করে দেখুন।',
    en: 'This import is no longer in that state. Look at the list again.',
  },
  importHistory: { bn: 'আগের আমদানি', en: 'Earlier imports' },
  importHistoryEmpty: {
    bn: 'এখনো কোনো আমদানি হয়নি। একটি সেট বেছে টেমপ্লেট নামিয়ে শুরু করুন।',
    en: 'Nothing imported yet. Choose a set and download its template to begin.',
  },
  importBy: { bn: '{name}-এর আমদানি, {when}', en: 'Imported by {name}, {when}' },
  importStateChecked: { bn: 'যাচাই হয়েছে, অনুমোদন বাকি', en: 'Checked, awaiting approval' },
  importStateCommitted: { bn: 'সংরক্ষিত', en: 'Saved' },
  importStateUndone: { bn: 'ফিরিয়ে নেওয়া', en: 'Taken back' },
  importStateDiscarded: { bn: 'বাতিল', en: 'Discarded' },
  importOffline: { bn: 'আমদানি করতে ইন্টারনেট সংযোগ লাগবে', en: 'Importing needs a connection' },
  importOfflineKept: {
    bn: 'ইন্টারনেট সংযোগ নেই। বেছে নেওয়া ফাইলটি থাকবে; সংযোগ ফিরলে যাচাই করুন।',
    en: 'No connection. The chosen file stays chosen; check it when the connection returns.',
  },
  importLoadFailed: {
    bn: 'আগের আমদানির তালিকা আনা যায়নি।',
    en: 'Could not load the earlier imports.',
  },
  importFileUnreadable: {
    bn: 'ফাইলটি পড়া যায়নি। স্প্রেডশিট থেকে CSV (UTF-8) হিসেবে আবার সংরক্ষণ করুন।',
    en: 'The file could not be read. Save it again from the spreadsheet as CSV (UTF-8).',
  },
  importFileMissingColumns: {
    bn: 'এই সেটের টেমপ্লেটের কলাম নেই: {columns}',
    en: "This set's template columns are missing: {columns}",
  },
  importFileTooManyRows: {
    bn: 'একবারে সর্বোচ্চ বিশ হাজার সারি। ফাইলটি ভাগ করে আমদানি করুন।',
    en: 'At most twenty thousand rows at a time. Split the file and import each part.',
  },
  importFileTooLarge: {
    bn: 'ফাইলটি পাঁচ মেগাবাইটের বেশি।',
    en: 'The file is over five megabytes.',
  },
  importErrRequired: { bn: 'ঘরটি খালি', en: 'Empty' },
  importErrInvalid: { bn: 'লেখাটি ঠিক নেই', en: 'Not written correctly' },
  importErrUnknownType: {
    bn: 'type হতে হবে department, doctor, schedule, ward, bed বা staff',
    en: 'type must be department, doctor, schedule, ward, bed or staff',
  },
  importErrUnknownValue: { bn: 'এই মান চেনা নেই', en: 'Not a value this column takes' },
  importErrMobile: { bn: 'বাংলাদেশের মোবাইল নম্বর নয়', en: 'Not a Bangladeshi mobile number' },
  importErrDate: {
    bn: 'তারিখ পড়া যায়নি (দিন/মাস/বছর)',
    en: 'Could not read the date (day/month/year)',
  },
  importErrTime: {
    bn: 'সময় পড়া যায়নি (যেমন ১৭:০০)',
    en: 'Could not read the time (such as 17:00)',
  },
  importErrRange: { bn: 'সীমার বাইরে', en: 'Out of range' },
  importErrEndBeforeStart: { bn: 'শেষের সময় শুরুর আগে', en: 'Ends before it starts' },
  importErrDuplicate: {
    bn: 'একই নম্বর ফাইলে দুবার আছে',
    en: 'The same identifier appears twice in the file',
  },
  importErrUnknownRef: {
    bn: 'এই নম্বরের কিছু ফাইলে বা আগের আমদানিতে নেই',
    en: 'Nothing with this identifier in the file or an earlier import',
  },
  importErrNoChamber: {
    bn: 'ওই তারিখে এই ডাক্তারের কোনো চেম্বার নেই',
    en: 'This doctor has no chamber on that date',
  },
  importErrSerialTaken: {
    bn: 'এই সিরিয়াল আগেই দেওয়া হয়েছে',
    en: 'That serial is already taken',
  },
  importErrConflict: {
    bn: 'এই হাসপাতালে আগেই অন্য কিছুর এই নাম বা নম্বর',
    en: 'Something else here already has this label or number',
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
  // The product's name (owner, 2026-10-06). A name is not translated, and
  // the owner gave it in one spelling: it is written the same in both
  // languages until he gives a Bangla one.
  appName: { bn: 'MedLiveBD', en: 'MedLiveBD' },
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
  /** `SEG-A00-LANG`: the group the two language buttons sit in. */
  language: { bn: 'ভাষা', en: 'Language' },

  // --- Bottom navigation (NAV-A, APP_FLOW.md S-A-02) ------------------------
  navHome: { bn: 'হোম', en: 'Home' },
  navSerials: { bn: 'সিরিয়াল', en: 'Serials' },
  navRecords: { bn: 'রেকর্ড', en: 'Records' },
  navProfile: { bn: 'প্রোফাইল', en: 'Profile' },

  // --- Home (S-A-02) --------------------------------------------------------
  seeADoctor: { bn: 'ডাক্তার দেখান', en: 'See a doctor' },
  seeADoctorSub: { bn: 'কোন সমস্যার জন্য দেখাবেন?', en: 'What do you need to be seen for?' },
  quickBed: { bn: 'বেড', en: 'Beds' },
  quickReport: { bn: 'রিপোর্ট', en: 'Reports' },
  // Not "today's": a chamber that runs past midnight is still theirs (`FR-PAT-39`).
  activeSerialTitle: { bn: 'আপনার সিরিয়াল চলছে', en: 'Your serial is live' },
  serialStatusUnknown: {
    bn: 'এখনকার অবস্থা জানা যাচ্ছে না',
    en: 'The current status could not be checked',
  },
  serialStatusUnknownSince: {
    bn: 'এখনকার অবস্থা জানা যাচ্ছে না · শেষ জানা {age}',
    en: 'The current status could not be checked · last known {age}',
  },
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

  // --- Search (S-A-07s, FR-PAT-16–18) ---------------------------------------
  searchPrompt: { bn: 'আপনার কী দরকার?', en: 'What do you need?' },
  searchIntro: {
    bn: 'কোন হাসপাতালে এখন কী আছে, এক জায়গায় দেখুন।',
    en: 'See which hospital has what you need, right now, in one place.',
  },
  /** The same lines when the app is open for one hospital (`FR-PAT-19`). */
  scopedIntro: {
    bn: '{hospital}-এ এখন কী আছে, এক জায়গায় দেখুন।',
    en: 'See what {hospital} has right now, in one place.',
  },
  scopedSearch: { bn: 'ডাক্তার, বিভাগ, আইসিইউ খুঁজুন', en: 'Search doctors, specialties, ICU' },
  searchLabel: { bn: 'নাম বা প্রয়োজন লিখুন', en: 'Type a name or what you need' },
  searchHelper: {
    bn: 'ডাক্তার, হাসপাতাল, বিভাগ, আইসিইউ, বার্ন ইউনিট',
    en: 'Doctor, hospital, specialty, ICU, burn unit',
  },
  /** The field on Home that opens the search screen (`BTN-A02-SEARCH`). */
  homeSearch: {
    bn: 'ডাক্তার, হাসপাতাল, আইসিইউ খুঁজুন',
    en: 'Search doctors, hospitals, ICU',
  },
  homeSearchLine: {
    bn: 'কোন হাসপাতালে এখন জায়গা আছে, সরাসরি দেখুন।',
    en: 'See which hospitals have room, live.',
  },
  searchGroupBeds: { bn: 'বেড ও আইসিইউ', en: 'Beds and ICU' },
  searchGroupCare: { bn: 'বিশেষ সেবা', en: 'Specialised care' },
  searchClearNeed: { bn: 'বদলান', en: 'Change' },
  searchAllHospitals: { bn: 'যেসব হাসপাতাল যুক্ত আছে', en: 'Participating hospitals' },
  searchHospitals: { bn: 'হাসপাতাল', en: 'Hospitals' },
  searchHospitalsWith: { bn: '{need} আছে যেসব হাসপাতালে', en: 'Hospitals with {need}' },
  searchDoctors: { bn: 'ডাক্তার', en: 'Doctors' },
  searchBedFree: { bn: '{kind}: খালি {free}, মোট {total}', en: '{kind}: {free} free of {total}' },
  searchBedUnconfirmed: {
    bn: '{kind}: সংখ্যা এখনো নিশ্চিত করা হয়নি',
    en: '{kind}: the count has not been confirmed',
  },
  searchHasCapability: { bn: '{capability} আছে', en: 'Has {capability}' },
  searchNoOpenSerials: { bn: 'আজ সিরিয়াল খালি নেই', en: 'No serials open today' },
  searchSeeDoctors: { bn: 'ডাক্তার দেখুন', en: 'See doctors' },
  searchSeeBeds: { bn: 'বেডের অনুরোধ করুন', en: 'Request a bed' },
  searchCall: { bn: 'কল করুন', en: 'Call' },
  searchFee: { bn: 'ফি {fee}', en: 'Fee {fee}' },
  searchNoneForText: {
    bn: '“{text}” নামে কোনো ডাক্তার বা হাসপাতাল পাওয়া যায়নি।',
    en: 'No doctor or hospital was found for “{text}”.',
  },
  searchNoneForNeed: {
    bn: 'যুক্ত কোনো হাসপাতাল এই মুহূর্তে {need} জানায়নি।',
    en: 'No participating hospital reports {need} right now.',
  },
  searchFailed: {
    bn: 'খোঁজা যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।',
    en: 'The search could not be completed. Check your connection and try again.',
  },
  searchRetry: { bn: 'আবার খুঁজুন', en: 'Search again' },
  searchOffline: {
    bn: 'ইন্টারনেট নেই। খুঁজতে সংযোগ লাগবে।',
    en: 'You are offline. Searching needs a connection.',
  },
  /** The quick needs under the field on Home. */
  homeNeeds: { bn: 'সবচেয়ে বেশি খোঁজা হয়', en: 'Most searched' },
  browseBySpecialty: { bn: 'বিভাগ ধরে ডাক্তার দেখান', en: 'See a doctor by specialty' },

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
    bn: 'ব্যবস্থাপত্র, পুরোনো কাগজ যোগ করা আর পিডিএফ ডাউনলোড — এগুলো এখনো তৈরি হয়নি।',
    en: 'Prescriptions, adding old paper records and PDF download are not built yet.',
  },

  // --- TAB-A12-REP: test reports (FR-LAB-03, FR-PAT-61) --------------------
  reportsTab: { bn: 'রিপোর্ট', en: 'Reports' },
  timelineTab: { bn: 'টাইমলাইন', en: 'Timeline' },
  reportsNone: {
    bn: 'এই ফোনের সিরিয়ালগুলোয় কোনো টেস্ট লেখা হয়নি।',
    en: 'No tests were ordered on the serials this phone holds.',
  },
  reportReady: { bn: 'রিপোর্ট এসেছে', en: 'Report ready' },
  reportOpen: { bn: 'রিপোর্ট দেখুন', en: 'Open the report' },
  reportWaiting: { bn: 'রিপোর্টের অপেক্ষায়', en: 'Waiting for the report' },
  reportOrderedOn: { bn: '{date}-এ লেখা', en: 'Ordered {date}' },
  reportReadyOn: { bn: '{date}-এ এসেছে', en: 'Ready {date}' },
  reportStateOrdered: { bn: 'নমুনা দেওয়া বাকি', en: 'Sample not taken yet' },
  reportStateSampleCollected: { bn: 'নমুনা নেওয়া হয়েছে', en: 'Sample collected' },
  reportStateProcessing: { bn: 'পরীক্ষা চলছে', en: 'Being tested' },
  reportStateCancelled: { bn: 'বাতিল হয়েছে', en: 'Cancelled' },
  reportOpenFailed: {
    bn: 'রিপোর্টটি খোলা যায়নি। একটু পরে আবার চেষ্টা করুন।',
    en: 'The report would not open. Try again in a moment.',
  },

  // --- Medicine availability (FR-PHR-02) -----------------------------------
  medicinesTitle: { bn: 'ওষুধ খুঁজুন', en: 'Find a medicine' },
  medicinesIntro: {
    bn: 'ওষুধের নাম লিখুন — কোন ফার্মেসিতে আছে তা দেখা যাবে।',
    en: 'Type a medicine name to see which pharmacies have it.',
  },
  medicinesSearch: { bn: 'ওষুধের নাম', en: 'Medicine name' },
  medicinesSearchHint: { bn: 'অন্তত দুটি অক্ষর লিখুন', en: 'Type at least two letters' },
  medicinesSearching: { bn: 'খোঁজা হচ্ছে…', en: 'Searching…' },
  medicinesNoMatch: {
    bn: 'এই নামের কোনো ওষুধ তালিকায় নেই।',
    en: 'No medicine by that name is listed.',
  },
  medicinesFailed: { bn: 'খোঁজা যায়নি। আবার চেষ্টা করুন।', en: 'The search failed. Try again.' },
  medicinesOffline: {
    bn: 'ইন্টারনেট সংযোগ নেই। ওষুধ খুঁজতে সংযোগ লাগবে।',
    en: 'No internet connection. Finding a medicine needs one.',
  },
  // The three answers (`lab/stock.ts`). "Not known" is never folded into "no".
  medicineHere: { bn: 'আছে', en: 'In stock' },
  medicineNotHere: { bn: 'নেই', en: 'Out of stock' },
  medicineUnknown: { bn: 'জানা নেই', en: 'Not known' },
  medicineUnknownHint: {
    bn: 'এই ফার্মেসি সম্প্রতি জানায়নি — ফোন করে জেনে নিন।',
    en: 'This pharmacy has not said recently — call and ask.',
  },
  // `GR-05`: counts, never a verdict about the whole city.
  medicineSummary: {
    bn: '{inStock}টিতে আছে · {outOfStock}টিতে নেই · {unknown}টি জানায়নি',
    en: '{inStock} have it · {outOfStock} do not · {unknown} have not said',
  },
  medicineNoPharmacies: {
    bn: 'কোনো ফার্মেসি এই ওষুধের খবর দেয়নি।',
    en: 'No pharmacy has reported on this medicine.',
  },
  // `FR-PAY-03`: the refund rule is stated before a cancellation is confirmed.
  refundFull: {
    bn: 'বাতিল করলে পুরো {amount} ফেরত পাবেন।',
    en: 'Cancel now and you get the full {amount} back.',
  },
  refundPartial: {
    bn: 'বাতিল করলে {amount} ফেরত পাবেন ({paid} টাকার মধ্যে)।',
    en: 'Cancel now and you get {amount} back, out of {paid}.',
  },
  refundNone: {
    bn: 'এই সময়ে বাতিল করলে টাকা ফেরত পাবেন না।',
    en: 'Cancelling now does not return any money.',
  },
  refundNothingPaid: {
    bn: 'আপনি এখনো টাকা দেননি, তাই ফেরতের কিছু নেই।',
    en: 'You have not paid yet, so there is nothing to refund.',
  },
  // `FR-PAY-07`, said in the patient's own words rather than as a policy.
  refundGuaranteed: {
    bn: 'ডাক্তার না এলে পুরো টাকা নিজে থেকেই ফেরত যায় — চাইতে হয় না।',
    en: 'If the doctor does not come, the full amount is returned on its own.',
  },

  medicineCallFirst: {
    bn: 'রওনা দেওয়ার আগে ফোন করে নিশ্চিত হয়ে নিন।',
    en: 'Call to confirm before setting out.',
  },

  // --- Tabs not built in this version --------------------------------------
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

  // --- Standby (FR-PAT-25, FR-PAT-26, FR-PAT-27, BTN-A06D-STANDBY, S-A-08s) -
  standbyJoin: { bn: 'স্ট্যান্ডবাই তালিকায় নাম দিন', en: 'Join the standby list' },
  standbyJoinTitle: { bn: 'স্ট্যান্ডবাই তালিকায় নাম দিন', en: 'Join the standby list' },
  standbyJoinWhy: {
    bn: 'এই চেম্বার পূর্ণ। কেউ বাতিল করলে বা না এলে সিরিয়ালটি তালিকার ক্রমে দেওয়া হয়।',
    en: 'This chamber is full. When somebody cancels or does not come, the serial goes down the list in order.',
  },
  standbyHowTitle: { bn: 'খালি হলে কী হবে?', en: 'When a serial frees up' },
  standbyPrepayOption: {
    bn: 'এখনই পরিশোধ করুন — খালি হলেই সিরিয়াল আপনার',
    en: 'Pay now — the serial is yours as soon as one frees',
  },
  standbyPrepayNote: {
    bn: 'কাউকে জিজ্ঞেস না করেই আপনাকে বসানো হবে। সিরিয়াল না পেলে পুরো টাকা ফেরত।',
    en: 'You are seated without being asked. If no serial comes, all of it comes back.',
  },
  standbyAskOption: {
    bn: 'পরে পরিশোধ — খালি হলে জানাব',
    en: 'Pay later — tell me when one frees',
  },
  standbyAskNote: {
    bn: 'খালি হলে ফোনে জানাব; ১০ মিনিটের মধ্যে হ্যাঁ বা না বলবেন।',
    en: 'We tell you on your phone; you say yes or no within 10 minutes.',
  },
  standbyConfirm: { bn: 'তালিকায় নাম দিন', en: 'Join the list' },
  standbyJoinFailed: {
    bn: 'তালিকায় নাম দেওয়া যায়নি। আবার চেষ্টা করুন।',
    en: 'Could not join the list. Please try again.',
  },
  standbyNotFull: {
    bn: 'এই চেম্বারে এখন সিরিয়াল খালি আছে — সরাসরি সিরিয়াল নিন।',
    en: 'This chamber has a serial free now — book it directly.',
  },
  standbyAlreadyBooked: {
    bn: 'এই রোগীর এই চেম্বারে আগেই সিরিয়াল আছে।',
    en: 'This patient already has a serial in this chamber.',
  },
  standbyStatusTitle: { bn: 'স্ট্যান্ডবাই তালিকা', en: 'Standby list' },
  standbyPlace: { bn: 'তালিকায় আপনার আগে {count} জন', en: '{count} ahead of you on the list' },
  standbyFirst: { bn: 'খালি হলে প্রথমেই আপনি', en: 'You are first when a serial frees' },
  standbyPrepaidBadge: {
    bn: 'আগেই পরিশোধ করেছেন — খালি হলেই সিরিয়াল আপনার',
    en: 'Paid already — the serial is yours as soon as one frees',
  },
  standbyAskBadge: {
    bn: 'খালি হলে এখানে জানাব — ১০ মিনিটের মধ্যে হ্যাঁ বলবেন',
    en: 'We will ask here — say yes within 10 minutes',
  },
  standbyOfferTitle: { bn: 'একটি সিরিয়াল খালি হয়েছে', en: 'A serial has freed up' },
  standbyOfferLeft: {
    bn: 'হ্যাঁ বলার সময় আর {minutes} মিনিট',
    en: '{minutes} min left to say yes',
  },
  standbyOfferAccept: { bn: 'হ্যাঁ, সিরিয়াল নেব', en: 'Yes, I’ll take it' },
  standbyOfferDecline: { bn: 'না, পরের জনকে দিন', en: 'No, give it to the next person' },
  standbyAcceptFailed: {
    bn: 'নেওয়া গেল না — সময় পেরিয়ে গেছে বা অন্য কেউ নিয়েছেন।',
    en: 'Could not take it — the time ran out or somebody else took it.',
  },
  standbySeatedTitle: { bn: 'সিরিয়াল {serial} আপনার', en: 'Serial {serial} is yours' },
  standbySeatedLink: { bn: 'লাইভ সিরিয়াল দেখুন', en: 'Follow the live serial' },
  standbySeatedSms: {
    bn: 'লাইভ দেখার লিংক আপনার ফোনে SMS-এ পাঠানো হয়েছে।',
    en: 'The link to follow it was sent to your phone by SMS.',
  },
  standbyLeave: { bn: 'তালিকা থেকে নাম তুলে নিন', en: 'Leave the list' },
  standbyLeaveConfirm: { bn: 'নাম তুলে নিন', en: 'Leave' },
  standbyLeaveStay: { bn: 'থাক', en: 'Stay' },
  standbyLeaveRefund: {
    bn: 'আগেই পরিশোধ করা পুরো টাকা ফেরত দেওয়া হবে।',
    en: 'What you paid comes back in full.',
  },
  standbyLeft: {
    bn: 'আপনি তালিকা থেকে নাম তুলে নিয়েছেন।',
    en: 'You have left the list.',
  },
  standbyLinkBad: {
    bn: 'এই লিংকটি আর খোলে না। হাসপাতালের কাউন্টারে যোগাযোগ করুন।',
    en: 'This link no longer opens. Please contact the hospital counter.',
  },
  standbyLoadFailed: {
    bn: 'তালিকার অবস্থা আনা যায়নি।',
    en: 'Could not load your place on the list.',
  },
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

  // FR-PAT-38: the counter's word, beside the live estimate and never instead
  // of it. `{time}` is when it was said.
  quoteTitle: { bn: 'কাউন্টার জানিয়েছে', en: 'The counter said' },
  quoteSaid: {
    bn: 'প্রায় {minutes} মিনিট — {time}-এ বলা',
    en: 'About {minutes} min — said at {time}',
  },
  quoteLeft: {
    bn: 'সেই হিসাবে আর প্রায় {minutes} মিনিট',
    en: 'By that, about {minutes} min to go',
  },
  quotePassed: {
    bn: 'কাউন্টারের বলা সময় পেরিয়ে গেছে। ওপরের হিসাবটি এখনকার।',
    en: 'The time the counter gave has passed. The estimate above is the current one.',
  },
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
  bookingLimitReached: {
    bn: 'এই নম্বর থেকে আজ আর সিরিয়াল নেওয়া যাবে না। কাল আবার চেষ্টা করুন, অথবা হাসপাতালের কাউন্টারে যোগাযোগ করুন।',
    en: 'No more serials can be taken from this number today. Try again tomorrow, or ask at the hospital counter.',
  },
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
  hoursShort: { bn: 'ঘণ্টা', en: 'h' },

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
  // --- Signing in and claiming (S-A-03, S-A-04, S-A-20, pilot step 25) -------------
  accountIntro: {
    bn: 'মোবাইল নম্বর দিয়ে লগ ইন করলে এই নম্বরে আগে নেওয়া সিরিয়াল আর রেকর্ড এক জায়গায় দেখতে পাবেন। বুকিংয়ের জন্য লগ ইন লাগে না।',
    en: 'Sign in with your mobile number to see the serials and records this number already holds, in one place. Booking never needs it.',
  },
  accountSendCode: { bn: 'কোড পাঠান', en: 'Send code' },
  accountCode: { bn: '৬ অঙ্কের কোড', en: '6-digit code' },
  accountCodeSent: {
    bn: '{phone} নম্বরে একটি কোড পাঠানো হয়েছে।',
    en: 'A code was sent to {phone}.',
  },
  accountDemoCode: {
    bn: 'ডেমো: এসএমএস ছাড়াই দেখানো হচ্ছে — কোড {code}',
    en: 'Demo: shown here without an SMS — code {code}',
  },
  accountResendIn: {
    bn: '{seconds} সেকেন্ড পর আবার পাঠানো যাবে',
    en: 'Can send again in {seconds} seconds',
  },
  accountResend: { bn: 'আবার পাঠান', en: 'Send again' },
  accountChangeNumber: { bn: 'নম্বর বদলান', en: 'Change number' },
  accountOffline: { bn: 'ইন্টারনেট সংযোগ লাগবে', en: 'This needs a connection' },
  accountPhoneInvalid: {
    bn: 'এটি বাংলাদেশের মোবাইল নম্বর নয়। যেমন ০১৭১২৩৪৫৬৭৮।',
    en: 'That is not a Bangladeshi mobile number, such as 01712345678.',
  },
  accountTooMany: {
    bn: 'এই নম্বরে অনেকবার কোড পাঠানো হয়েছে। এক ঘণ্টা পর আবার চেষ্টা করুন।',
    en: 'Too many codes sent to this number. Try again in an hour.',
  },
  accountLocked: {
    bn: 'অনেকবার ভুল কোড দেওয়া হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।',
    en: 'Too many wrong codes. Try again in 15 minutes.',
  },
  accountCodeWrong: {
    bn: 'কোড মেলেনি। আবার লিখুন।',
    en: 'That code is not right. Enter it again.',
  },
  accountCodeExpired: {
    bn: 'কোডের মেয়াদ শেষ। আবার পাঠান।',
    en: 'The code has expired. Send a new one.',
  },
  accountSignedOut: { bn: 'আবার লগ ইন করুন।', en: 'Please sign in again.' },
  accountFailed: { bn: 'করা যায়নি। আবার চেষ্টা করুন।', en: 'That did not work. Try again.' },
  accountSignedInAs: { bn: 'লগ ইন করা নম্বর', en: 'Signed in as' },
  accountSignOut: { bn: 'লগ আউট', en: 'Sign out' },
  accountNoProfiles: {
    bn: 'এই অ্যাকাউন্টে এখনো কোনো রোগীর তথ্য নেই। এই নম্বরে সিরিয়াল নিলে এখানে দেখা যাবে।',
    en: 'No patients in this account yet. A serial booked with this number will appear here.',
  },
  accountNoDiagnosis: { bn: 'রোগনির্ণয় লেখা হয়নি', en: 'No diagnosis written' },
  claimTitle: { bn: 'আপনার আগের সিরিয়াল ও রেকর্ড', en: 'Your earlier serials and records' },
  claimIntro: {
    bn: 'এই নম্বরে আগে যাঁদের নামে সিরিয়াল নেওয়া হয়েছে বা কোনো হাসপাতাল তথ্য রেখেছে, তাঁরা নিচে আছেন। একবারে আপনার অ্যাকাউন্টে যোগ করুন।',
    en: 'These are the people this number booked for, or that a hospital holds with it. Add them all to your account at once.',
  },
  claimCounts: {
    bn: '{bookings}টি সিরিয়াল · {visits}টি রেকর্ড',
    en: '{bookings} serials · {visits} records',
  },
  claimHeldBy: { bn: '{hospital}-এর খাতায়', en: "In {hospital}'s register" },
  claimConfirm: { bn: 'যোগ করুন', en: 'Add them' },
  claimLater: { bn: 'এখন না', en: 'Not now' },
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

/**
 * The patient catalogue's `format`: a message with its `{placeholders}` filled
 * (pilot step 25, `S-A-04`'s "a code was sent to {phone}"). Same rules as the
 * console's — an unfilled placeholder stays visible rather than blank.
 */
export function formatPatient(
  key: PatientKey,
  locale: Locale,
  values: Readonly<Record<string, string>>,
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, value),
    tp(key, locale),
  );
}
