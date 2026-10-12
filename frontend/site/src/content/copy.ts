/**
 * Local presentation copy: GR-06; truthful S-C-01/02/04/05, FR-SEC-08.
 *
 * Every claim here describes something the platform does today. No customers,
 * partners, figures, testimonials or certifications; illustrations name
 * demonstration data as such (FR-DEM-07), and hospitals in diagrams are
 * "Hospital A/B/C", never a real or seeded name that could read as a partner.
 */
export const contactEmail = 'support@medlivebd.com';
export const demoHref = `mailto:${contactEmail}?subject=${encodeURIComponent('MedLiveBD — Hospital demonstration request')}`;
export type Locale = 'bn' | 'en';

/** One workspace the showcase shows, with the real screen captured for it. */
export interface Feature {
  readonly key: 'patient' | 'reception' | 'doctor' | 'ward' | 'lab' | 'admin';
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly detail: string;
  /** Read aloud for the screenshot; says it is demonstration data. */
  readonly alt: string;
}

interface TitledText {
  readonly title: string;
  readonly body: string;
}

const en = {
  title: 'MedLiveBD — Live hospital operations for Bangladesh',
  description:
    'MedLiveBD connects reception, doctors, wards, emergency, lab and pharmacy in one live system, and shows every waiting patient their real place in the queue. Built for hospitals in Bangladesh, in Bangla and English.',
  skip: 'Skip to content',
  menu: 'Menu',
  close: 'Close menu',
  nav: [
    { id: 'how', label: 'How it works' },
    { id: 'product', label: 'Product' },
    { id: 'hospitals', label: 'For hospitals' },
    { id: 'trust', label: 'Trust' },
    { id: 'faq', label: 'FAQ' },
  ],
  languageName: 'English',
  otherLanguage: 'বাংলা',
  otherLanguageLabel: 'বাংলায় পড়ুন',
  demo: 'Request a demonstration',
  demoShort: 'Request a demo',
  explore: 'See how it works',

  eyebrow: 'Live hospital operations · Bangladesh',
  /** The main line (owner, 12 October 2026); the accented part carries the brand gradient. */
  hero: [
    { text: 'A Connected Healthcare Ecosystem for a ', accent: false },
    { text: 'Healthier Bangladesh', accent: true },
  ],
  lead: 'MedLiveBD connects reception, doctors, wards, emergency, lab and pharmacy in one live system — and shows every waiting patient their real place in the queue. Built for hospitals in Bangladesh, in Bangla and English.',
  heroPoints: ['Bangla and English', 'A private workspace per hospital', 'Keeps working offline'],

  live: {
    description:
      'An illustration of the live serial. When reception presses Call next on the console, the patient’s phone shows the new serial being served and how many people are still ahead.',
    caption: 'Illustration of the live serial · demonstration data',
    pause: 'Pause the illustration',
    play: 'Play the illustration',
    tryIt: 'Try it: finish and call the next serial',
    hospital: 'Shapla General Hospital (Demo)',
    console: 'Reception',
    today: 'Today’s chambers',
    online: 'Online',
    nowServing: 'Now serving',
    waiting: 'Waiting',
    callNext: 'Call next',
    started: 'Started',
    notArrived: 'Not arrived',
    next: 'Next in line',
    viaApp: 'App',
    viaCounter: 'Counter',
    room: 'Room 304',
    doctors: [
      { name: 'Dr Ayesha Siddika (Demo)', dept: 'Cardiology' },
      { name: 'Dr Pradip Kumar Roy (Demo)', dept: 'Neurology' },
      { name: 'Dr Farhana Islam (Demo)', dept: 'Medicine' },
    ],
    patients: [
      'Rahima Parvin (Demo)',
      'Halima Sultana (Demo)',
      'Bikash Das (Demo)',
      'Kulsum Sultana (Demo)',
      'Imran Chowdhury (Demo)',
      'Nusrat Jahan (Demo)',
      'Mahmuda Nahar (Demo)',
    ],
    phoneTitle: 'My live serial',
    yourSerial: 'Your serial',
    ahead: 'Ahead of you',
    updated: 'Updated just now',
    yourTurn: 'Your turn — please go to Room 304',
    steps: ['Booked', 'Waiting', 'Your turn', 'Seen'],
    event: 'Serial called',
    justNow: 'just now',
  },

  modulesLabel: 'One platform for the whole hospital',
  modules: [
    'Patient app',
    'Reception',
    'Registration',
    'Doctor',
    'Wards & beds',
    'Emergency',
    'Laboratory',
    'Pharmacy',
    'Administration',
    'Hospital onboarding',
    'Checked data import',
    'Aggregate reporting',
  ],

  problemLabel: 'Why live matters',
  problemTitle: 'A hospital day moves by the minute.\nPaper and static lists don’t.',
  problemBody:
    'When information arrives late, everyone fills the gap on their own: patients crowd the waiting room, reception answers the same call all day, and a bed listed as free turns out to be taken.',
  problemBefore: 'Without live information',
  problemAfter: 'With MedLiveBD',
  problems: [
    {
      before: 'A patient waits for hours without knowing their place.',
      after: 'Their phone shows the serial being served and how many are ahead.',
    },
    {
      before: 'Reception answers “how long now?” by phone, all day.',
      after: 'The live serial answers it. Reception keeps working.',
    },
    {
      before: 'A listing says a bed is free — as of when?',
      after: 'Every published figure carries its age. Old information says it is old.',
    },
    {
      before: 'Each desk keeps its own register.',
      after: 'One record moves from counter to doctor to lab.',
    },
    {
      before: 'The internet drops, and the desk stops.',
      after: 'The reception console keeps working and catches up on reconnect.',
    },
  ],

  howLabel: 'How it works',
  howTitle: 'One tap.\nEvery screen that needs to know.',
  howBody:
    'At the centre of MedLiveBD is a live queue that keeps one true order of events. Each desk acts on it; every screen is drawn from it.',
  howSteps: [
    {
      title: 'Reception calls next',
      body: 'One tap on the reception console records a single event: the chamber has moved on.',
    },
    {
      title: 'The queue keeps one true order',
      body: 'Arrivals, walk-ins, late, no-show, pauses — each is recorded once, in order, and never rewritten.',
    },
    {
      title: 'Everyone waiting sees it',
      body: 'Within seconds, each waiting patient’s phone shows the serial being served, how many are ahead and an estimated time with its margin.',
    },
    {
      title: 'When something is wrong, it says so',
      body: 'If the connection drops, the console keeps working and reconciles on return. A figure that has grown old shows its age.',
    },
  ] satisfies readonly TitledText[],
  howNodes: {
    reception: 'Reception',
    core: 'Live queue',
    phones: 'Patients’ phones',
    doctor: 'Doctor’s screen',
    admin: 'Administration',
    log: ['Serial 7 called', 'Walk-in added', 'Serial 6 seen'],
    offline: 'Offline · 3 actions kept',
    synced: 'Back online · in order',
    age: 'Updated 9 min ago · may be out of date',
  },
  howPause: 'Pause the steps',
  howPlay: 'Play the steps',

  productLabel: 'The product',
  productTitle: 'A workspace for every role.',
  productBody:
    'A Bangla-first patient app and role-specific hospital consoles on one live queue. These are the real screens, running on demonstration data.',
  featureLabel: 'Choose a workspace',
  features: [
    {
      key: 'reception',
      label: 'Reception',
      title: 'Every chamber on one desk.',
      body: 'Reception runs several doctors’ queues at once: arrivals, walk-ins, call next, late and no-show, pauses and delays.',
      points: ['Several chambers side by side', 'Walk-ins inserted into a running chamber'],
      detail: 'Keeps working through a dropped connection and reconciles when it returns.',
      alt: 'The reception console with several chambers, demonstration data',
    },
    {
      key: 'doctor',
      label: 'Doctor',
      title: 'The consultation, in one place.',
      body: 'The doctor sees the queue, the patient’s permitted history, and writes notes, medicines, tests and follow-up — then signs and calls the next.',
      points: ['Queue and record on one screen', 'Sign & Next in a single step'],
      detail:
        'A record is signed against the patient it was written for, whatever the queue does meanwhile.',
      alt: 'The doctor’s consultation workspace, demonstration data',
    },
    {
      key: 'patient',
      label: 'Patient app',
      title: 'A serial the patient can trust.',
      body: 'Patients find participating hospitals and doctors, book a serial, and follow the chamber live — in Bangla or English, without installing anything.',
      points: ['Booking without an account', 'Records shared only by the patient’s consent'],
      detail: 'Every live figure carries its age. A lost connection is shown, never hidden.',
      alt: 'The patient app’s live serial screen, demonstration data',
    },
    {
      key: 'ward',
      label: 'Beds & emergency',
      title: 'Capacity teams can coordinate.',
      body: 'Wards keep bed states current; the emergency department handles incoming alerts, triage and referrals between hospitals.',
      points: ['Bed board by ward', 'What the app shows, side by side'],
      detail: 'Published capacity comes from recorded updates, with its age beside it.',
      alt: 'The ward bed board, demonstration data',
    },
    {
      key: 'lab',
      label: 'Lab & pharmacy',
      title: 'From order to report.',
      body: 'The lab follows doctor-ordered tests through sample, processing and report delivery to the patient. Pharmacies confirm which medicines are available.',
      points: ['Orders arrive from the doctor', 'Reports delivered to the patient'],
      detail: 'Medicine availability not reconfirmed within 12 hours is shown as unknown.',
      alt: 'The laboratory console, demonstration data',
    },
    {
      key: 'admin',
      label: 'Administration',
      title: 'The working day, in view.',
      body: 'Administrators see today’s chambers and recorded counts, run reports, and manage departments, doctors, staff, desks and settings.',
      points: ['Today’s chambers at a glance', 'Departments, staff and desks'],
      detail: 'Figures reflect what was recorded — not an estimate presented as fact.',
      alt: 'The hospital administration dashboard, demonstration data',
    },
  ] satisfies readonly Feature[],
  illustrative: 'Real MedLiveBD screens · demonstration data, no patient information',

  capLabel: 'For hospital teams',
  capTitle: 'Built around how a hospital actually runs.',
  capBody:
    'Each desk gets a workspace shaped to its job, and they all share one live picture of the day.',
  cap: {
    reception: {
      title: 'Reception, without the crowd at the counter',
      body: 'Run several chambers from one desk. Call next, mark late or no-show, add a walk-in.',
    },
    beds: {
      title: 'Bed awareness, ward by ward',
      body: 'Free, occupied, reserved, being cleaned — kept current by the ward, published with its age.',
      states: ['Free', 'Occupied', 'Reserved', 'Cleaning'],
      fresh: 'Updated 4 min ago',
    },
    emergency: {
      title: 'Emergency coordination',
      body: 'Incoming alerts, triage and referrals between hospitals, in one place.',
      alert: 'On the way · Burn case',
      triage: ['Red', 'Yellow', 'Green'],
      accept: 'Get ready',
    },
    lab: {
      title: 'Lab, from order to report',
      body: 'Doctor-ordered tests followed through to the patient.',
      stages: ['Ordered', 'Sample', 'Processing', 'Report'],
    },
    doctor: {
      title: 'A clear consultation',
      body: 'Queue, history and record together. Sign, then call the next.',
      rows: ['Diagnosis', 'Medicines', 'Tests'],
      sign: 'Sign & Next',
    },
    offline: {
      title: 'Works when the internet doesn’t',
      body: 'Actions are kept on the device and sent in order when the connection returns.',
      offline: 'Offline',
      kept: 'actions kept',
      online: 'Synced',
    },
    brand: {
      title: 'Your hospital’s name and colours',
      body: 'One platform, presented as your own portal — name, logo, colours and the modules you choose.',
      hospital: 'Hospital A',
      powered: 'Powered by MedLiveBD',
    },
  },

  patientLabel: 'For patients',
  patientTitle: 'Waiting, without the guesswork.',
  patientBody:
    'Patients see what the hospital publishes — live, in their own language, on the phone they already have.',
  patientPoints: [
    {
      title: 'Find the right doctor',
      body: 'Search by specialty, doctor or hospital, and see who is sitting today.',
    },
    {
      title: 'Book without an account',
      body: 'A serial in a few taps, with a link to follow it live.',
    },
    {
      title: 'Follow the serial live',
      body: 'The serial being served, how many are ahead, and a message when the turn is near.',
    },
    {
      title: 'Records in one place',
      body: 'Visits and reports together, shared with another hospital only by the patient’s consent.',
    },
    {
      title: 'Help in an emergency',
      body: 'Call 999 first, then see which hospitals can take the case now.',
    },
  ] satisfies readonly TitledText[],
  patientAlt: 'The MedLiveBD patient app showing a live serial, demonstration data',
  patientLanguages: 'বাংলা · English',

  networkLabel: 'The network',
  networkTitle: 'One network of hospitals.\nEach one private.',
  networkBody:
    'Patients search across participating hospitals — a doctor, a specialty, an ICU bed, an open serial — and see live figures first, each with its age. Hospitals share only public operational figures. Patient records never cross without the patient’s consent.',
  networkSearch: 'Search: ICU bed near me',
  networkHospitals: [
    { name: 'Hospital A', figure: 'ICU · 1 of 6 free', age: '5 min ago', live: true },
    { name: 'Hospital B', figure: 'Cardiology · serials open', age: '2 min ago', live: true },
    { name: 'Hospital C', figure: 'Burn unit · not confirmed', age: '3 h ago', live: false },
  ],
  networkShared: 'Shared with the network',
  networkSharedItems: [
    'Beds and services',
    'Who is sitting',
    'Open serials',
    'How old each figure is',
  ],
  networkPrivate: 'Stays inside the hospital',
  networkPrivateItems: ['Patients and records', 'Staff and desks', 'Internal reports'],
  networkWall: 'Patient records stay inside each hospital',
  networkIllustrative: 'Illustration · hospitals and figures are examples',

  trustLabel: 'Trust & safety',
  trustTitle: 'Built to be trusted\nwith a hospital.',
  trustBody:
    'Healthcare software earns trust in the details. These are rules the platform enforces, not promises on a page.',
  trust: [
    {
      title: 'Honest figures',
      body: 'Every live number carries its age. When data is old or missing, the screen says so instead of guessing.',
    },
    {
      title: 'Private per hospital',
      body: 'Each hospital works in its own isolated workspace. Another hospital never sees its patients or internal data.',
    },
    {
      title: 'Consent for records',
      body: 'A patient’s record opens at another hospital only with their consent, and every view is logged.',
    },
    {
      title: 'Access by role',
      body: 'Staff sign in to their own role’s consoles. Administrators use a second factor.',
    },
    {
      title: 'Designed for Bangladesh',
      body: 'Built to be hosted in Bangladesh. No patient record is sent to an AI model.',
    },
    {
      title: 'People decide care',
      body: 'No AI makes clinical decisions. The only AI suggests how to map an import file; a person confirms.',
    },
  ] satisfies readonly TitledText[],

  startLabel: 'Getting started',
  startTitle: 'From first conversation\nto first patient.',
  startBody:
    'Start from how your teams already work. We set up the workspace with you and rehearse the day before anyone relies on it.',
  steps: [
    {
      title: 'Configure',
      body: 'Departments, doctors, chambers, staff roles and desks — from the screen.',
    },
    {
      title: 'Import',
      body: 'Your existing lists, checked and previewed before anything is written. Undoable.',
    },
    {
      title: 'Rehearse',
      body: 'Walk through the whole day on demonstration data before going live.',
    },
    { title: 'Go live', body: 'A checklist and a review before the first real patient is served.' },
  ] satisfies readonly TitledText[],

  faqLabel: 'Questions',
  faqTitle: 'What hospitals ask first.',
  faq: [
    {
      q: 'Do patients need to install an app?',
      a: 'No. The patient app opens in the phone’s browser, in Bangla or English. It can be added to the home screen, but nothing has to come from an app store.',
    },
    {
      q: 'What happens when the internet drops at reception?',
      a: 'The reception console keeps taking actions and keeps them on the device. When the connection returns they are sent in order and reconciled. Patients’ screens say when information may be out of date.',
    },
    {
      q: 'Can it carry our hospital’s name and colours?',
      a: 'Yes. A hospital can run MedLiveBD as its own branded portal — name, logo, colours and the modules it has chosen — in the network, on its own, or both. It is the same platform underneath, not a separate copy.',
    },
    {
      q: 'Can we bring our existing lists?',
      a: 'Yes, through a checked import. Files are checked and previewed before anything is written, a re-import does not create duplicates, and an import can be undone.',
    },
    {
      q: 'Where is the data kept?',
      a: 'MedLiveBD is designed to be hosted in Bangladesh. Each hospital’s data stays in its own private workspace. Demonstrations use synthetic data only.',
    },
    {
      q: 'Does it connect to our existing hospital system?',
      a: 'Not directly in this version. Connections to a hospital’s own systems, and to payment and SMS providers, are arranged with each hospital.',
    },
  ],

  contactLabel: 'Request a demonstration',
  contactTitle: 'See your hospital’s day,\nlive.',
  contactBody:
    'Tell us about your hospital and the desks you would like to see. We will walk you through reception, doctor, ward and patient flows on demonstration data.',
  emailLabel: 'Email the MedLiveBD team',
  copy: 'Copy address',
  copied: 'Copied',
  contactNote:
    'Demonstrations use synthetic data. Hospital deployment, provider connections and commercial terms are discussed directly.',

  footer: 'Live hospital operations for Bangladesh.',
  aboutFoot: 'Care today. Healthy tomorrow.',
  footerProduct: 'Product',
  footerCompany: 'Company',
  footerContact: 'Contact',
  footerLanguage: 'Language',
  footerLinks: {
    product: [
      { id: 'how', label: 'How it works' },
      { id: 'product', label: 'Workspaces' },
      { id: 'patients', label: 'For patients' },
      { id: 'network', label: 'The network' },
    ],
    company: [
      { id: 'trust', label: 'Trust & safety' },
      { id: 'start', label: 'Getting started' },
      { id: 'faq', label: 'Questions' },
    ],
  },
  privacy: 'Privacy notice',
  backTop: 'Back to top',
  copyright: 'MedLiveBD',
  privacyTitle: 'Privacy notice',
  privacyUpdated: 'Last updated 11 October 2026',
  privacyBack: 'Back to MedLiveBD',
  privacySections: [
    {
      heading: 'This website',
      body: 'This is the company website of MedLiveBD. It has no accounts, forms, cookies, analytics or advertising trackers, and it does not ask for your personal information.',
    },
    {
      heading: 'If you email us',
      body: 'Links on this site open your own email program. If you write to support@medlivebd.com, we use your name, address and message only to reply and to arrange what you asked about. We do not sell or share it for marketing.',
    },
    {
      heading: 'Hosting',
      body: 'Like any website, the service that delivers these pages processes technical information such as your IP address and browser type, so the pages can be delivered and protected from abuse.',
    },
    {
      heading: 'Demonstrations',
      body: 'MedLiveBD demonstrations and the screens shown on this site use synthetic data. No real patient information is shown.',
    },
    {
      heading: 'The MedLiveBD platform',
      body: 'This notice covers this website only. Patient and hospital information handled by the MedLiveBD platform is governed by the terms agreed with each hospital and the notices shown in the platform itself.',
    },
    {
      heading: 'Questions',
      body: 'Write to support@medlivebd.com about anything in this notice, including a request to delete correspondence you sent us.',
    },
  ],
};

export type Copy = typeof en;

const bn: Copy = {
  title: 'MedLiveBD — বাংলাদেশের হাসপাতালের লাইভ কার্যক্রম',
  description:
    'রিসেপশন, চিকিৎসক, ওয়ার্ড, জরুরি বিভাগ, ল্যাব ও ফার্মেসিকে একটি লাইভ ব্যবস্থায় যুক্ত করে MedLiveBD, আর অপেক্ষমাণ প্রত্যেক রোগী দেখেন সিরিয়ালে তাঁর আসল অবস্থান। বাংলাদেশের হাসপাতালের জন্য, বাংলা ও ইংরেজিতে।',
  skip: 'মূল বিষয়বস্তুতে যান',
  menu: 'মেনু',
  close: 'মেনু বন্ধ করুন',
  nav: [
    { id: 'how', label: 'কীভাবে কাজ করে' },
    { id: 'product', label: 'প্রোডাক্ট' },
    { id: 'hospitals', label: 'হাসপাতালের জন্য' },
    { id: 'trust', label: 'নিরাপত্তা' },
    { id: 'faq', label: 'প্রশ্নোত্তর' },
  ],
  languageName: 'বাংলা',
  otherLanguage: 'EN',
  otherLanguageLabel: 'Read in English',
  demo: 'ডেমোর জন্য যোগাযোগ',
  demoShort: 'ডেমো দেখুন',
  explore: 'কীভাবে কাজ করে দেখুন',

  eyebrow: 'হাসপাতালের লাইভ কার্যক্রম · বাংলাদেশ',
  hero: [
    { text: 'সুস্থ বাংলাদেশের', accent: true },
    { text: ' জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম', accent: false },
  ],
  lead: 'রিসেপশন, চিকিৎসক, ওয়ার্ড, জরুরি বিভাগ, ল্যাব ও ফার্মেসি — সব এক লাইভ ব্যবস্থায়। আর অপেক্ষমাণ প্রত্যেক রোগী ফোনেই দেখেন সিরিয়ালে তাঁর আসল অবস্থান। বাংলাদেশের হাসপাতালের জন্য, বাংলা ও ইংরেজিতে।',
  heroPoints: ['বাংলা ও ইংরেজি', 'প্রতিটি হাসপাতালের নিজস্ব কর্মক্ষেত্র', 'ইন্টারনেট গেলেও চলে'],

  live: {
    description:
      'লাইভ সিরিয়ালের একটি দৃষ্টান্ত। রিসেপশন কনসোলে “পরের জন” চাপলে রোগীর ফোনে নতুন চলমান সিরিয়াল আর আগে কতজন আছেন তা দেখা যায়।',
    caption: 'লাইভ সিরিয়ালের দৃষ্টান্ত · ডেমো তথ্য',
    pause: 'দৃষ্টান্ত থামান',
    play: 'দৃষ্টান্ত চালান',
    tryIt: 'চেষ্টা করুন: পরের সিরিয়াল ডাকুন',
    hospital: 'শাপলা জেনারেল হাসপাতাল (ডেমো)',
    console: 'রিসেপশন',
    today: 'আজকের চেম্বার',
    online: 'সংযুক্ত',
    nowServing: 'এখন চলছে',
    waiting: 'অপেক্ষায়',
    callNext: 'পরের জন',
    started: 'শুরু হয়েছে',
    notArrived: 'আসেননি',
    next: 'পরবর্তী',
    viaApp: 'অ্যাপ',
    viaCounter: 'কাউন্টার',
    room: 'কক্ষ ৩০৪',
    doctors: [
      { name: 'ডা. আয়েশা সিদ্দিকা (ডেমো)', dept: 'কার্ডিওলজি' },
      { name: 'ডা. প্রদীপ কুমার রায় (ডেমো)', dept: 'নিউরোলজি' },
      { name: 'ডা. ফারহানা ইসলাম (ডেমো)', dept: 'মেডিসিন' },
    ],
    patients: [
      'রহিমা পারভীন (ডেমো)',
      'হালিমা সুলতানা (ডেমো)',
      'বিকাশ দাস (ডেমো)',
      'কুলসুম সুলতানা (ডেমো)',
      'ইমরান চৌধুরী (ডেমো)',
      'নুসরাত জাহান (ডেমো)',
      'মাহমুদা নাহার (ডেমো)',
    ],
    phoneTitle: 'আমার লাইভ সিরিয়াল',
    yourSerial: 'আপনার সিরিয়াল',
    ahead: 'আপনার আগে',
    updated: 'এইমাত্র হালনাগাদ',
    yourTurn: 'আপনার পালা — কক্ষ ৩০৪-এ যান',
    steps: ['নেওয়া', 'অপেক্ষায়', 'আপনার পালা', 'দেখা শেষ'],
    event: 'সিরিয়াল ডাকা হলো',
    justNow: 'এইমাত্র',
  },

  modulesLabel: 'পুরো হাসপাতালের জন্য একটি প্ল্যাটফর্ম',
  modules: [
    'রোগীর অ্যাপ',
    'রিসেপশন',
    'রেজিস্ট্রেশন',
    'চিকিৎসক',
    'ওয়ার্ড ও শয্যা',
    'জরুরি বিভাগ',
    'ল্যাবরেটরি',
    'ফার্মেসি',
    'প্রশাসন',
    'হাসপাতাল চালু',
    'যাচাই করে তথ্য আনা',
    'সমষ্টিগত রিপোর্ট',
  ],

  problemLabel: 'লাইভ কেন জরুরি',
  problemTitle: 'হাসপাতালের দিন চলে মিনিটে মিনিটে।\nকাগজের তালিকা তাল রাখে না।',
  problemBody:
    'তথ্য দেরিতে এলে সবাই নিজের মতো ফাঁক পূরণ করেন: রোগীরা ভিড় করেন অপেক্ষাকক্ষে, রিসেপশন সারাদিন একই ফোন ধরে, আর “খালি” শয্যা গিয়ে দেখা যায় ভর্তি।',
  problemBefore: 'লাইভ তথ্য ছাড়া',
  problemAfter: 'MedLiveBD-এর সঙ্গে',
  problems: [
    {
      before: 'রোগী ঘণ্টার পর ঘণ্টা অপেক্ষা করেন, জানেন না কত দেরি।',
      after: 'ফোনেই দেখেন এখন কত নম্বর চলছে, আগে কতজন।',
    },
    {
      before: '“আর কতক্ষণ?” — সারাদিন ফোনে একই প্রশ্ন।',
      after: 'উত্তর দেয় লাইভ সিরিয়াল। রিসেপশন নিজের কাজ করে।',
    },
    {
      before: 'তালিকায় শয্যা খালি — কিন্তু কখনকার তথ্য?',
      after: 'প্রতিটি সংখ্যার পাশে তার বয়স। পুরোনো তথ্য নিজেই জানায়।',
    },
    {
      before: 'প্রতিটি ডেস্কের আলাদা খাতা।',
      after: 'একটি রেকর্ড কাউন্টার থেকে চিকিৎসক হয়ে ল্যাবে যায়।',
    },
    {
      before: 'ইন্টারনেট গেলে ডেস্কও থেমে যায়।',
      after: 'রিসেপশন কনসোল চলতে থাকে, সংযোগ ফিরলে মিলিয়ে নেয়।',
    },
  ],

  howLabel: 'কীভাবে কাজ করে',
  howTitle: 'একটি ট্যাপ।\nযার জানা দরকার, সবার স্ক্রিনে।',
  howBody:
    'MedLiveBD-এর কেন্দ্রে একটি লাইভ সিরিয়াল, যা ঘটনার একটিই সঠিক ক্রম রাখে। প্রতিটি ডেস্ক তাতে কাজ করে, প্রতিটি স্ক্রিন সেখান থেকেই তৈরি।',
  howSteps: [
    {
      title: 'রিসেপশন পরের জনকে ডাকে',
      body: 'রিসেপশন কনসোলে একটি ট্যাপে একটি ঘটনা লেখা হয়: চেম্বার এগিয়েছে।',
    },
    {
      title: 'সিরিয়াল রাখে একটিই সঠিক ক্রম',
      body: 'আগমন, ওয়াক-ইন, দেরি, অনুপস্থিতি, বিরতি — প্রতিটি একবার, ক্রমে লেখা হয়, পরে বদলানো হয় না।',
    },
    {
      title: 'অপেক্ষমাণ সবাই দেখেন',
      body: 'কয়েক সেকেন্ডেই প্রত্যেক রোগীর ফোনে চলমান সিরিয়াল, আগে কতজন, আর আনুমানিক সময় — তার সম্ভাব্য হেরফেরসহ।',
    },
    {
      title: 'সমস্যা হলে তা জানায়',
      body: 'সংযোগ গেলেও কনসোল চলে, ফিরলে মিলিয়ে নেয়। পুরোনো হয়ে যাওয়া সংখ্যা তার বয়স দেখায়।',
    },
  ],
  howNodes: {
    reception: 'রিসেপশন',
    core: 'লাইভ সিরিয়াল',
    phones: 'রোগীদের ফোন',
    doctor: 'চিকিৎসকের স্ক্রিন',
    admin: 'প্রশাসন',
    log: ['সিরিয়াল ৭ ডাকা হলো', 'ওয়াক-ইন যোগ', 'সিরিয়াল ৬ দেখা শেষ'],
    offline: 'সংযোগ নেই · ৩টি কাজ রাখা',
    synced: 'আবার সংযুক্ত · ক্রম ঠিক',
    age: '৯ মিনিট আগে হালনাগাদ · পুরোনো হতে পারে',
  },
  howPause: 'ধাপগুলো থামান',
  howPlay: 'ধাপগুলো চালান',

  productLabel: 'প্রোডাক্ট',
  productTitle: 'প্রতিটি ভূমিকার জন্য\nনিজস্ব কর্মক্ষেত্র।',
  productBody:
    'বাংলা-প্রথম রোগীর অ্যাপ আর ভূমিকাভিত্তিক হাসপাতাল কনসোল, একই লাইভ সিরিয়ালের ওপর। এগুলো আসল স্ক্রিন, ডেমো তথ্যে চলছে।',
  featureLabel: 'একটি কর্মক্ষেত্র বেছে নিন',
  features: [
    {
      key: 'reception',
      label: 'রিসেপশন',
      title: 'সব চেম্বার এক ডেস্কে।',
      body: 'একসঙ্গে কয়েকজন চিকিৎসকের সিরিয়াল: আগমন, ওয়াক-ইন, পরের জন, দেরি, অনুপস্থিতি, বিরতি।',
      points: ['কয়েকটি চেম্বার পাশাপাশি', 'চলমান চেম্বারে ওয়াক-ইন যোগ'],
      detail: 'ইন্টারনেট গেলেও কাজ চলে; ফিরে এলে মিলিয়ে নেয়।',
      alt: 'কয়েকটি চেম্বারসহ রিসেপশন কনসোল, ডেমো তথ্য',
    },
    {
      key: 'doctor',
      label: 'চিকিৎসক',
      title: 'পরামর্শ, এক জায়গায়।',
      body: 'সিরিয়াল, রোগীর অনুমোদিত ইতিহাস, নোট, ওষুধ, পরীক্ষা ও ফলো-আপ — তারপর স্বাক্ষর দিয়ে পরের জন।',
      points: ['সিরিয়াল ও রেকর্ড এক স্ক্রিনে', 'এক ধাপে স্বাক্ষর ও পরবর্তী'],
      detail: 'রেকর্ড স্বাক্ষর হয় সেই রোগীরই নামে, যাঁর জন্য লেখা।',
      alt: 'চিকিৎসকের পরামর্শ কর্মক্ষেত্র, ডেমো তথ্য',
    },
    {
      key: 'patient',
      label: 'রোগীর অ্যাপ',
      title: 'ভরসা করার মতো সিরিয়াল।',
      body: 'রোগী হাসপাতাল ও চিকিৎসক খুঁজে সিরিয়াল নেন, চেম্বারের সিরিয়াল সরাসরি দেখেন — কিছু ইনস্টল না করেই।',
      points: ['অ্যাকাউন্ট ছাড়াই সিরিয়াল', 'রেকর্ড শেয়ার শুধু রোগীর সম্মতিতে'],
      detail: 'প্রতিটি লাইভ তথ্যের পাশে তার বয়স। সংযোগ গেলে তা জানানো হয়।',
      alt: 'রোগীর অ্যাপের লাইভ সিরিয়াল, ডেমো তথ্য',
    },
    {
      key: 'ward',
      label: 'শয্যা ও জরুরি',
      title: 'শয্যা জানা, সমন্বয় সহজ।',
      body: 'ওয়ার্ড শয্যার অবস্থা হালনাগাদ রাখে; জরুরি বিভাগ আগমনবার্তা, ট্রায়াজ ও হাসপাতালের মধ্যে রেফারাল সামলায়।',
      points: ['ওয়ার্ডভিত্তিক শয্যা বোর্ড', 'অ্যাপে কী দেখানো হচ্ছে, পাশেই'],
      detail: 'প্রকাশিত সংখ্যার পাশে তার বয়স দেখানো হয়।',
      alt: 'ওয়ার্ডের শয্যা বোর্ড, ডেমো তথ্য',
    },
    {
      key: 'lab',
      label: 'ল্যাব ও ফার্মেসি',
      title: 'নির্দেশ থেকে রিপোর্ট।',
      body: 'নমুনা, প্রক্রিয়াকরণ থেকে রোগীর কাছে রিপোর্ট পৌঁছানো পর্যন্ত ল্যাব অনুসরণ করে। ফার্মেসি ওষুধের প্রাপ্যতা নিশ্চিত করে।',
      points: ['চিকিৎসকের কাছ থেকে নির্দেশ', 'রোগীর কাছে রিপোর্ট'],
      detail: '১২ ঘণ্টায় নিশ্চিত না হলে ওষুধের তথ্য “জানা নেই” দেখায়।',
      alt: 'ল্যাবরেটরি কনসোল, ডেমো তথ্য',
    },
    {
      key: 'admin',
      label: 'প্রশাসন',
      title: 'দিনের কাজ, এক নজরে।',
      body: 'আজকের চেম্বার ও নথিভুক্ত সংখ্যা, রিপোর্ট, আর বিভাগ, চিকিৎসক, কর্মী, ডেস্ক ও সেটিংস।',
      points: ['আজকের চেম্বার এক নজরে', 'বিভাগ, কর্মী ও ডেস্ক'],
      detail: 'সংখ্যা আসে নথিভুক্ত কাজ থেকে, অনুমান থেকে নয়।',
      alt: 'হাসপাতাল প্রশাসনের ড্যাশবোর্ড, ডেমো তথ্য',
    },
  ],
  illustrative: 'MedLiveBD-এর আসল স্ক্রিন · ডেমো তথ্য, কোনো রোগীর তথ্য নয়',

  capLabel: 'হাসপাতালের দলের জন্য',
  capTitle: 'হাসপাতাল যেভাবে চলে,\nসেভাবেই তৈরি।',
  capBody: 'প্রতিটি ডেস্ক পায় নিজের কাজের মতো কর্মক্ষেত্র, আর সবাই দেখে দিনের একই লাইভ ছবি।',
  cap: {
    reception: {
      title: 'রিসেপশন, কাউন্টারে ভিড় ছাড়াই',
      body: 'এক ডেস্ক থেকে কয়েকটি চেম্বার। পরের জন, দেরি, অনুপস্থিতি, ওয়াক-ইন।',
    },
    beds: {
      title: 'ওয়ার্ড ধরে শয্যার খবর',
      body: 'খালি, ভর্তি, সংরক্ষিত, পরিষ্কার হচ্ছে — ওয়ার্ড হালনাগাদ রাখে, বয়সসহ প্রকাশ হয়।',
      states: ['খালি', 'ভর্তি', 'সংরক্ষিত', 'পরিষ্কার'],
      fresh: '৪ মিনিট আগে হালনাগাদ',
    },
    emergency: {
      title: 'জরুরি সমন্বয়',
      body: 'আগমনবার্তা, ট্রায়াজ আর হাসপাতালের মধ্যে রেফারাল, এক জায়গায়।',
      alert: 'পথে আছে · দগ্ধ রোগী',
      triage: ['লাল', 'হলুদ', 'সবুজ'],
      accept: 'প্রস্তুত হোন',
    },
    lab: {
      title: 'ল্যাব, নির্দেশ থেকে রিপোর্ট',
      body: 'চিকিৎসকের দেওয়া পরীক্ষা রোগী পর্যন্ত অনুসরণ।',
      stages: ['নির্দেশ', 'নমুনা', 'প্রক্রিয়া', 'রিপোর্ট'],
    },
    doctor: {
      title: 'স্পষ্ট পরামর্শ',
      body: 'সিরিয়াল, ইতিহাস ও রেকর্ড একসঙ্গে। স্বাক্ষর, তারপর পরের জন।',
      rows: ['রোগ নির্ণয়', 'ওষুধ', 'পরীক্ষা'],
      sign: 'রেকর্ড দিন ও পরবর্তী',
    },
    offline: {
      title: 'ইন্টারনেট না থাকলেও চলে',
      body: 'কাজগুলো ডিভাইসে রাখা থাকে, সংযোগ ফিরলে ক্রম ধরে পাঠানো হয়।',
      offline: 'সংযোগ নেই',
      kept: 'টি কাজ রাখা',
      online: 'মিলে গেছে',
    },
    brand: {
      title: 'আপনার হাসপাতালের নাম ও রং',
      body: 'একই প্ল্যাটফর্ম, আপনার নিজস্ব পোর্টাল হিসেবে — নাম, লোগো, রং আর আপনার বেছে নেওয়া মডিউল।',
      hospital: 'হাসপাতাল ক',
      powered: 'Powered by MedLiveBD',
    },
  },

  patientLabel: 'রোগীর জন্য',
  patientTitle: 'অপেক্ষা, অনুমান ছাড়াই।',
  patientBody: 'হাসপাতাল যা প্রকাশ করে, রোগী তা দেখেন — লাইভ, নিজের ভাষায়, নিজের ফোনেই।',
  patientPoints: [
    {
      title: 'সঠিক চিকিৎসক খুঁজুন',
      body: 'বিশেষজ্ঞতা, চিকিৎসক বা হাসপাতাল ধরে খুঁজুন; আজ কে বসছেন দেখুন।',
    },
    { title: 'অ্যাকাউন্ট ছাড়াই সিরিয়াল', body: 'কয়েক ট্যাপে সিরিয়াল, সঙ্গে লাইভ দেখার লিংক।' },
    { title: 'লাইভ সিরিয়াল', body: 'এখন কত নম্বর, আগে কতজন, আর পালা কাছে এলে বার্তা।' },
    {
      title: 'রেকর্ড এক জায়গায়',
      body: 'ভিজিট ও রিপোর্ট একসঙ্গে; অন্য হাসপাতাল দেখে শুধু রোগীর সম্মতিতে।',
    },
    { title: 'জরুরি সহায়তা', body: 'আগে ৯৯৯-এ কল, তারপর কোন হাসপাতাল এখন নিতে পারবে।' },
  ],
  patientAlt: 'MedLiveBD রোগীর অ্যাপে লাইভ সিরিয়াল, ডেমো তথ্য',
  patientLanguages: 'বাংলা · English',

  networkLabel: 'নেটওয়ার্ক',
  networkTitle: 'হাসপাতালের একটি নেটওয়ার্ক।\nপ্রতিটির তথ্য নিজস্ব।',
  networkBody:
    'রোগী অংশগ্রহণকারী সব হাসপাতালে খোঁজেন — চিকিৎসক, বিশেষজ্ঞতা, আইসিইউ শয্যা, খোলা সিরিয়াল — আর আগে দেখেন লাইভ সংখ্যা, প্রতিটির বয়সসহ। হাসপাতাল শেয়ার করে শুধু প্রকাশযোগ্য কার্যক্রমের তথ্য। রোগীর সম্মতি ছাড়া রেকর্ড কোথাও যায় না।',
  networkSearch: 'খুঁজুন: কাছের আইসিইউ শয্যা',
  networkHospitals: [
    { name: 'হাসপাতাল ক', figure: 'আইসিইউ · ৬টির ১টি খালি', age: '৫ মিনিট আগে', live: true },
    { name: 'হাসপাতাল খ', figure: 'কার্ডিওলজি · সিরিয়াল খোলা', age: '২ মিনিট আগে', live: true },
    { name: 'হাসপাতাল গ', figure: 'বার্ন ইউনিট · নিশ্চিত নয়', age: '৩ ঘণ্টা আগে', live: false },
  ],
  networkShared: 'নেটওয়ার্কে যায়',
  networkSharedItems: ['শয্যা ও সেবা', 'কে বসছেন', 'খোলা সিরিয়াল', 'প্রতিটি তথ্যের বয়স'],
  networkPrivate: 'হাসপাতালের ভেতরেই থাকে',
  networkPrivateItems: ['রোগী ও রেকর্ড', 'কর্মী ও ডেস্ক', 'অভ্যন্তরীণ রিপোর্ট'],
  networkWall: 'রোগীর রেকর্ড থাকে প্রতিটি হাসপাতালের ভেতরেই',
  networkIllustrative: 'দৃষ্টান্ত · হাসপাতাল ও সংখ্যাগুলো উদাহরণ',

  trustLabel: 'নিরাপত্তা ও আস্থা',
  trustTitle: 'হাসপাতালের ভরসার\nযোগ্য করে তৈরি।',
  trustBody:
    'স্বাস্থ্যসেবার সফটওয়্যারে আস্থা আসে খুঁটিনাটি থেকে। এগুলো প্ল্যাটফর্মের মানা নিয়ম, কাগজের প্রতিশ্রুতি নয়।',
  trust: [
    {
      title: 'সৎ সংখ্যা',
      body: 'প্রতিটি লাইভ সংখ্যার পাশে তার বয়স। তথ্য পুরোনো বা না থাকলে স্ক্রিন তা-ই বলে, অনুমান করে না।',
    },
    {
      title: 'হাসপাতালভিত্তিক গোপনীয়তা',
      body: 'প্রতিটি হাসপাতাল কাজ করে নিজের আলাদা কর্মক্ষেত্রে। অন্য হাসপাতাল তার রোগী বা ভেতরের তথ্য দেখে না।',
    },
    {
      title: 'রেকর্ডে সম্মতি',
      body: 'রোগীর রেকর্ড অন্য হাসপাতালে খোলে শুধু তাঁর সম্মতিতে, আর প্রতিবার দেখা নথিভুক্ত হয়।',
    },
    {
      title: 'ভূমিকা অনুযায়ী প্রবেশ',
      body: 'কর্মীরা নিজের ভূমিকার কনসোলেই ঢোকেন। প্রশাসকেরা দ্বিতীয় ধাপের যাচাই ব্যবহার করেন।',
    },
    {
      title: 'বাংলাদেশের জন্য নকশা',
      body: 'বাংলাদেশে হোস্ট করার জন্য তৈরি। কোনো রোগীর রেকর্ড AI মডেলে পাঠানো হয় না।',
    },
    {
      title: 'চিকিৎসার সিদ্ধান্ত মানুষের',
      body: 'কোনো AI চিকিৎসার সিদ্ধান্ত নেয় না। একমাত্র AI ইমপোর্ট ফাইলের কলাম মেলানোর প্রস্তাব দেয়; নিশ্চিত করেন একজন মানুষ।',
    },
  ],

  startLabel: 'শুরু করা',
  startTitle: 'প্রথম আলাপ থেকে\nপ্রথম রোগী পর্যন্ত।',
  startBody:
    'আপনার দল যেভাবে কাজ করে, সেখান থেকেই শুরু। কর্মক্ষেত্র একসঙ্গে সাজাই, আর চালুর আগে পুরো দিনের মহড়া দিই।',
  steps: [
    { title: 'সাজানো', body: 'বিভাগ, চিকিৎসক, চেম্বার, কর্মীর ভূমিকা ও ডেস্ক — স্ক্রিন থেকেই।' },
    {
      title: 'তথ্য আনা',
      body: 'আপনার তালিকা, লেখার আগে যাচাই ও প্রিভিউ। চাইলে ফিরিয়ে নেওয়া যায়।',
    },
    { title: 'মহড়া', body: 'চালুর আগে ডেমো তথ্যে পুরো দিন।' },
    { title: 'চালু', body: 'প্রথম রোগীর আগে একটি চেকলিস্ট ও পর্যালোচনা।' },
  ],

  faqLabel: 'প্রশ্নোত্তর',
  faqTitle: 'হাসপাতাল প্রথমে যা জানতে চায়।',
  faq: [
    {
      q: 'রোগীদের কি অ্যাপ ইনস্টল করতে হবে?',
      a: 'না। রোগীর অ্যাপ ফোনের ব্রাউজারেই খোলে, বাংলা বা ইংরেজিতে। চাইলে হোম স্ক্রিনে রাখা যায়, তবে অ্যাপ স্টোর থেকে কিছু নামাতে হয় না।',
    },
    {
      q: 'রিসেপশনে ইন্টারনেট গেলে কী হয়?',
      a: 'রিসেপশন কনসোল কাজ নিতে থাকে এবং সেগুলো ডিভাইসে রাখে। সংযোগ ফিরলে ক্রম ধরে পাঠিয়ে মিলিয়ে নেয়। তথ্য পুরোনো হতে পারলে রোগীর স্ক্রিনে তা জানানো হয়।',
    },
    {
      q: 'আমাদের হাসপাতালের নাম ও রং থাকবে?',
      a: 'হ্যাঁ। হাসপাতাল নিজের নাম, লোগো, রং আর বেছে নেওয়া মডিউল নিয়ে MedLiveBD-কে নিজস্ব পোর্টাল হিসেবে চালাতে পারে — নেটওয়ার্কে, আলাদাভাবে, বা দুটোই। ভেতরে একই প্ল্যাটফর্ম, আলাদা কপি নয়।',
    },
    {
      q: 'আমাদের পুরোনো তালিকা আনা যাবে?',
      a: 'হ্যাঁ, যাচাই করে ইমপোর্টের মাধ্যমে। কিছু লেখার আগে ফাইল যাচাই ও প্রিভিউ হয়, আবার আনলে ডুপ্লিকেট হয় না, আর ইমপোর্ট ফিরিয়ে নেওয়া যায়।',
    },
    {
      q: 'তথ্য কোথায় রাখা হয়?',
      a: 'MedLiveBD বাংলাদেশে হোস্ট করার জন্য নকশা করা। প্রতিটি হাসপাতালের তথ্য তার নিজস্ব গোপন কর্মক্ষেত্রে থাকে। ডেমোতে শুধু কৃত্রিম তথ্য ব্যবহার হয়।',
    },
    {
      q: 'আমাদের বর্তমান হাসপাতাল সিস্টেমের সঙ্গে যুক্ত হবে?',
      a: 'এই সংস্করণে সরাসরি নয়। হাসপাতালের নিজস্ব সিস্টেম, পেমেন্ট ও এসএমএস সেবাদাতার সঙ্গে সংযোগ প্রতিটি হাসপাতালের সঙ্গে ঠিক করা হয়।',
    },
  ],

  contactLabel: 'ডেমোর জন্য যোগাযোগ',
  contactTitle: 'আপনার হাসপাতালের দিন,\nলাইভ দেখুন।',
  contactBody:
    'আপনার হাসপাতাল আর যে ডেস্কগুলো দেখতে চান, জানান। ডেমো তথ্যে আমরা রিসেপশন, চিকিৎসক, ওয়ার্ড ও রোগীর পুরো প্রবাহ দেখাব।',
  emailLabel: 'MedLiveBD দলকে ইমেইল করুন',
  copy: 'ঠিকানা কপি করুন',
  copied: 'কপি হয়েছে',
  contactNote:
    'ডেমোতে কৃত্রিম তথ্য ব্যবহার করা হয়। হাসপাতালের ব্যবহার, সেবাদাতা সংযোগ ও বাণিজ্যিক শর্ত সরাসরি আলোচনা করা হয়।',

  footer: 'বাংলাদেশের হাসপাতালের লাইভ কার্যক্রম।',
  aboutFoot: 'আজকের যত্ন। আগামী দিনের সুস্থতা।',
  footerProduct: 'প্রোডাক্ট',
  footerCompany: 'প্রতিষ্ঠান',
  footerContact: 'যোগাযোগ',
  footerLanguage: 'ভাষা',
  footerLinks: {
    product: [
      { id: 'how', label: 'কীভাবে কাজ করে' },
      { id: 'product', label: 'কর্মক্ষেত্র' },
      { id: 'patients', label: 'রোগীর জন্য' },
      { id: 'network', label: 'নেটওয়ার্ক' },
    ],
    company: [
      { id: 'trust', label: 'নিরাপত্তা ও আস্থা' },
      { id: 'start', label: 'শুরু করা' },
      { id: 'faq', label: 'প্রশ্নোত্তর' },
    ],
  },
  privacy: 'গোপনীয়তা নীতি',
  backTop: 'ওপরে ফিরে যান',
  copyright: 'MedLiveBD',
  privacyTitle: 'গোপনীয়তা নীতি',
  privacyUpdated: 'সর্বশেষ হালনাগাদ ১১ অক্টোবর ২০২৬',
  privacyBack: 'MedLiveBD-তে ফিরে যান',
  privacySections: [
    {
      heading: 'এই ওয়েবসাইট',
      body: 'এটি MedLiveBD-এর প্রতিষ্ঠানিক ওয়েবসাইট। এখানে কোনো অ্যাকাউন্ট, ফর্ম, কুকি, অ্যানালিটিক্স বা বিজ্ঞাপনের ট্র্যাকার নেই, এবং আপনার ব্যক্তিগত তথ্য চাওয়া হয় না।',
    },
    {
      heading: 'আপনি ইমেইল করলে',
      body: 'এই সাইটের লিংক আপনার নিজের ইমেইল প্রোগ্রাম খোলে। support@medlivebd.com-এ লিখলে আপনার নাম, ঠিকানা ও বার্তা শুধু উত্তর দিতে ও আপনার অনুরোধ অনুযায়ী ব্যবস্থা করতে ব্যবহার করি। বিপণনের জন্য বিক্রি বা শেয়ার করি না।',
    },
    {
      heading: 'হোস্টিং',
      body: 'যেকোনো ওয়েবসাইটের মতো, যে সেবা এই পাতাগুলো পৌঁছে দেয় তা আপনার IP ঠিকানা ও ব্রাউজারের ধরনের মতো কারিগরি তথ্য প্রক্রিয়া করে, যাতে পাতা পৌঁছানো যায় ও অপব্যবহার থেকে রক্ষা করা যায়।',
    },
    {
      heading: 'ডেমো',
      body: 'MedLiveBD-এর ডেমো ও এই সাইটে দেখানো স্ক্রিনে কৃত্রিম তথ্য ব্যবহার করা হয়। কোনো প্রকৃত রোগীর তথ্য দেখানো হয় না।',
    },
    {
      heading: 'MedLiveBD প্ল্যাটফর্ম',
      body: 'এই নীতি শুধু এই ওয়েবসাইটের জন্য। MedLiveBD প্ল্যাটফর্মে রোগী ও হাসপাতালের তথ্য প্রতিটি হাসপাতালের সঙ্গে সম্মত শর্ত ও প্ল্যাটফর্মে দেখানো নোটিশ অনুযায়ী পরিচালিত হয়।',
    },
    {
      heading: 'প্রশ্ন',
      body: 'এই নীতি নিয়ে যেকোনো প্রশ্ন, বা আপনার পাঠানো চিঠিপত্র মুছে ফেলার অনুরোধ, support@medlivebd.com-এ লিখুন।',
    },
  ],
};

export const copy = { en, bn } as const;
