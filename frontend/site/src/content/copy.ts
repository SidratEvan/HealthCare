/**
 * Company-site copy: GR-06; truthful S-C-01/02/04/05, FR-SEC-08.
 *
 * The public site sells the experience, not the implementation (owner,
 * 12 October 2026): who MedLiveBD is, why connected care matters, what
 * hospitals and patients gain. Detailed workflows belong in a private
 * demonstration. No customers, partners, figures, testimonials or
 * certifications; product glimpses and the map are labelled as illustrations;
 * the patient app is described as not yet open to the public.
 */
export const contactEmail = 'support@medlivebd.com';
export const demoHref = `mailto:${contactEmail}?subject=${encodeURIComponent('MedLiveBD — Hospital demonstration request')}`;
export type Locale = 'bn' | 'en';

interface TitledText {
  readonly title: string;
  readonly body: string;
}

const en = {
  title: 'MedLiveBD — A Connected Healthcare Ecosystem for a Healthier Bangladesh',
  description:
    'MedLiveBD brings hospitals and the people they care for onto one connected platform, so hospital teams work in step and patients always know where they stand. Designed in Bangladesh, in Bangla and English.',
  skip: 'Skip to content',
  menu: 'Menu',
  close: 'Close menu',
  nav: [
    { id: 'vision', label: 'Vision' },
    { id: 'hospitals', label: 'For hospitals' },
    { id: 'patients', label: 'For patients' },
    { id: 'bangladesh', label: 'Bangladesh' },
    { id: 'founders', label: 'Founders' },
  ],
  otherLanguageLabel: 'বাংলায় পড়ুন',
  demo: 'Request a Demo',
  demoPrivate: 'Request a private demo',
  pause: 'Pause the illustration',
  play: 'Play the illustration',

  eyebrow: 'Healthcare technology · Made for Bangladesh',
  /** The main line (owner, 12 October 2026); the accented part carries the brand gradient. */
  hero: [
    { text: 'A Connected Healthcare Ecosystem for a ', accent: false },
    { text: 'Healthier Bangladesh', accent: true },
  ],
  lead: 'MedLiveBD brings hospitals and the people they care for onto one connected platform — so hospital teams work in step, and patients always know where they stand.',
  discover: 'Discover MedLiveBD',
  heroPoints: ['Designed in Bangladesh', 'Bangla and English', 'Private by design'],
  heroVisual: {
    alt: 'The Padma Bridge stretching across the Padma River in the morning light',
    hospital: 'Hospital',
    hospitalState: 'Today, in step',
    inSession: 'In session',
    patient: 'Patient',
    yourSerial: 'Your serial',
    ahead: 'ahead of you',
    updated: 'Updated just now',
    caption: 'Padma Bridge · product glimpses are illustrations on demonstration data',
  },

  visionLabel: 'Our vision',
  vision:
    'Bangladesh has skilled doctors, dedicated hospitals and patients who reach for their phones first. What has been missing is the connection between them. MedLiveBD exists to build it.',
  visionAlt: 'Dhaka seen from above at sunset, rooftops stretching towards the horizon',
  visionPlace: 'Dhaka',
  pillars: [
    {
      title: 'Connected teams',
      body: 'Every desk in a hospital working from the same picture of the day.',
    },
    {
      title: 'Visible care',
      body: 'Waiting, beds and progress shown as they are — with how current they are.',
    },
    {
      title: 'Care within reach',
      body: 'Clear information for patients, in Bangla and English, on the phone they already carry.',
    },
  ] satisfies readonly TitledText[],

  experiencesLabel: 'One ecosystem',
  experiencesTitle:
    'One connected healthcare ecosystem.\nTwo experiences designed for different needs.',
  experiences: {
    hospitals: {
      chip: 'For hospitals',
      title: 'A hospital that works in step.',
      points: ['Coordinated teams', 'Live operational visibility', 'A modern patient experience'],
      cta: 'Explore for hospitals',
      alt: 'A gloved hand holding a pipette over sample tubes on a laboratory bench in Bangladesh',
    },
    patients: {
      chip: 'For patients',
      title: 'Care that is easier to find and follow.',
      points: ['Find the right care', 'Simpler serials', 'Know your place in the queue'],
      cta: 'Explore for patients',
      alt: 'A farmer planting rice seedlings in a green paddy field in Chattogram',
    },
    connector: 'One platform',
  },

  hospitalsLabel: 'For hospitals',
  hospitalsTitle: 'Run a more connected hospital.',
  hospitalsBody:
    'MedLiveBD gives every team — from the front desk to the ward — one shared, live view of the day. It is designed so that staff spend less time chasing information, and patients spend less time wondering.',
  hospitalsAlt: 'Nurses in white caps attending a training session at a hospital in Bangladesh',
  hospitalBenefits: [
    {
      title: 'Teams in step',
      body: 'Reception, doctors, wards, emergency and laboratory work from one picture of the day.',
    },
    {
      title: 'Clear visibility',
      body: 'See how the day is unfolding as it happens, not after it ends.',
    },
    { title: 'Simple for staff', body: 'Calm, bilingual screens designed around each role.' },
    {
      title: 'Better for patients',
      body: 'Patients wait with information instead of uncertainty.',
    },
    {
      title: 'Fits how you work',
      body: 'Begins alongside your current processes, with your existing lists brought in carefully.',
    },
    {
      title: 'Your name, your colours',
      body: 'Presented to your patients under your hospital’s own brand.',
    },
  ] satisfies readonly TitledText[],
  hospitalsNote: 'Private demonstrations use synthetic data — never real patient information.',
  glimpse: {
    today: 'Today',
    live: 'Live',
    beds: 'Beds',
    fresh: 'Updated 2 min ago',
    illustrative: 'Illustration',
  },

  patientsLabel: 'For patients',
  patientsTitle: 'Healthcare that is easier to find, and easier to follow.',
  patientsBody:
    'A calmer, clearer journey — from finding the right doctor to knowing when it is your turn.',
  patientsAlt: 'Tea gardens on the green hills near Srimangal, Sylhet, in soft evening light',
  patientBenefits: [
    {
      title: 'Find the right care',
      body: 'Search doctors, specialties and hospitals, and see who is available.',
    },
    {
      title: 'Simpler serials',
      body: 'Take a serial in a few steps, without paperwork or repeated calls.',
    },
    {
      title: 'Know where you stand',
      body: 'Follow the queue as it moves, and arrive when it matters.',
    },
    { title: 'Information you can trust', body: 'Every live update shows how recent it is.' },
    { title: 'In your language', body: 'Bangla and English, on the phone you already have.' },
  ] satisfies readonly TitledText[],
  comingSoon: 'Coming soon',
  patientsStatus:
    'The MedLiveBD patient app opens hospital by hospital, as each one goes live in Bangladesh. It is not yet open to the public.',
  patientsHospitalAsk: 'Want it for your patients?',
  phone: {
    title: 'My serial',
    hospital: 'Your hospital',
    yourSerial: 'Your serial',
    nowServing: 'Now serving',
    ahead: 'Ahead of you',
    updated: 'Updated just now',
    steps: ['Booked', 'Waiting', 'Your turn'],
  },

  mapLabel: 'Connected Bangladesh',
  mapTitle: 'A vision that reaches\nevery division.',
  mapBody:
    'We are building MedLiveBD so that any hospital, in any part of the country, can join one connected ecosystem — and any patient can find care with confidence, from Rangpur to Chattogram.',
  mapConcept: 'Concept illustration',
  mapLegend:
    'The eight divisions of Bangladesh and our vision of connected care. It does not show current hospitals, customers or coverage.',
  mapCredit:
    'Boundaries: geoBoundaries (CC0). District lines: Bangladesh Bureau of Statistics and OCHA ROAP (CC BY 3.0 IGO).',
  mapAria:
    'Map of Bangladesh with its eight divisions. Lines from Dhaka to each division headquarters illustrate the vision of connected care; it is a concept, not current coverage.',
  mapDivisions: 'divisions',

  trustLabel: 'Trust & responsibility',
  trustTitle: 'Responsible by design.',
  trust: [
    {
      title: 'Private by hospital',
      body: 'Each hospital’s information stays in its own workspace.',
    },
    {
      title: 'Consent first',
      body: 'A patient’s records reach another hospital only with their consent.',
    },
    {
      title: 'Honest information',
      body: 'Live figures show how recent they are. Missing data is never guessed.',
    },
    { title: 'People decide care', body: 'MedLiveBD does not make clinical decisions.' },
  ] satisfies readonly TitledText[],

  contactLabel: 'Let’s talk',
  contactTitle: 'Let’s build connected care, together.',
  contactBody:
    'If you lead a hospital or clinic in Bangladesh, we would be glad to show you MedLiveBD in a private demonstration.',
  contactAlt: 'Boats crossing the Buriganga River in Dhaka at sunset, in silhouette',
  emailLabel: 'Email the MedLiveBD team',
  copy: 'Copy address',
  copied: 'Copied',
  contactNote:
    'Demonstrations use synthetic data. Hospital deployment, provider connections and commercial terms are discussed directly.',

  footer: 'A connected healthcare ecosystem for a healthier Bangladesh.',
  aboutFoot: 'Care today. Healthy tomorrow.',
  footerExplore: 'Explore',
  footerCompany: 'Company',
  footerContact: 'Contact',
  footerLanguage: 'Language',
  footerLinks: [
    { id: 'vision', label: 'Our vision' },
    { id: 'hospitals', label: 'For hospitals' },
    { id: 'patients', label: 'For patients' },
    { id: 'bangladesh', label: 'Connected Bangladesh' },
  ],
  footerFounders: 'Founders',
  trustLink: 'Trust & responsibility',
  credits: 'Image credits',
  privacy: 'Privacy notice',
  backTop: 'Back to top',
  copyright: 'MedLiveBD',
  photoCredit: 'Photo',

  creditsTitle: 'Image and map credits',
  creditsIntro:
    'Original AI-generated campaign scenes and openly licensed geographic data. All assets are served locally from this website.',
  creditsPhotos: 'Photographs',
  creditsMap: 'Map data',
  creditsBy: 'by',
  creditsSource: 'Source',
  creditsLicence: 'Licence',
  creditsBack: 'Back to MedLiveBD',

  privacyTitle: 'Privacy notice',
  privacyUpdated: 'Last updated 12 October 2026',
  privacyBack: 'Back to MedLiveBD',
  privacySections: [
    {
      heading: 'This website',
      body: 'This is the company website of MedLiveBD. It has no accounts, forms, cookies, analytics or advertising trackers, and it does not ask for your personal information. Its photographs, fonts and map are served from this site itself.',
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
      body: 'MedLiveBD demonstrations use synthetic data. The healthcare and city scenes on this website are AI-generated illustrations. They do not depict actual MedLiveBD staff, patients or customers. No real patient information is shown.',
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
  title: 'MedLiveBD — সুস্থ বাংলাদেশের জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম',
  description:
    'MedLiveBD হাসপাতাল আর তার সেবা নেওয়া মানুষদের এক সংযুক্ত প্ল্যাটফর্মে আনে — যাতে হাসপাতালের দল একসঙ্গে কাজ করে, আর রোগী সবসময় জানেন তিনি কোথায় আছেন। বাংলাদেশে নকশা করা, বাংলা ও ইংরেজিতে।',
  skip: 'মূল বিষয়বস্তুতে যান',
  menu: 'মেনু',
  close: 'মেনু বন্ধ করুন',
  nav: [
    { id: 'vision', label: 'লক্ষ্য' },
    { id: 'hospitals', label: 'হাসপাতালের জন্য' },
    { id: 'patients', label: 'রোগীর জন্য' },
    { id: 'bangladesh', label: 'বাংলাদেশ' },
    { id: 'founders', label: 'প্রতিষ্ঠাতা' },
  ],
  otherLanguageLabel: 'Read in English',
  demo: 'ডেমো দেখুন',
  demoPrivate: 'ব্যক্তিগত ডেমোর অনুরোধ',
  pause: 'দৃষ্টান্ত থামান',
  play: 'দৃষ্টান্ত চালান',

  eyebrow: 'স্বাস্থ্যসেবা প্রযুক্তি · বাংলাদেশের জন্য',
  hero: [
    { text: 'সুস্থ বাংলাদেশের', accent: true },
    { text: ' জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম', accent: false },
  ],
  lead: 'MedLiveBD হাসপাতাল আর তার সেবা নেওয়া মানুষদের এক সংযুক্ত প্ল্যাটফর্মে আনে — যাতে হাসপাতালের দল একসঙ্গে কাজ করে, আর রোগী সবসময় জানেন তিনি কোথায় আছেন।',
  discover: 'MedLiveBD সম্পর্কে জানুন',
  heroPoints: ['বাংলাদেশে নকশা করা', 'বাংলা ও ইংরেজি', 'গোপনীয়তা নকশাতেই'],
  heroVisual: {
    alt: 'সকালের আলোয় পদ্মা নদীর ওপর বিস্তৃত পদ্মা সেতু',
    hospital: 'হাসপাতাল',
    hospitalState: 'আজ, একসঙ্গে',
    inSession: 'চলছে',
    patient: 'রোগী',
    yourSerial: 'আপনার সিরিয়াল',
    ahead: 'জন আগে',
    updated: 'এইমাত্র হালনাগাদ',
    caption: 'পদ্মা সেতু · প্রোডাক্টের ঝলকগুলো ডেমো তথ্যে আঁকা দৃষ্টান্ত',
  },

  visionLabel: 'আমাদের লক্ষ্য',
  vision:
    'বাংলাদেশে আছেন দক্ষ চিকিৎসক, নিবেদিত হাসপাতাল, আর এমন রোগী যাঁরা আগে হাতে নেন ফোন। যা ছিল না, তা হলো এঁদের মাঝের সংযোগ। MedLiveBD সেই সংযোগ গড়ে তুলছে।',
  visionAlt: 'সূর্যাস্তে ওপর থেকে দেখা ঢাকা, দিগন্ত পর্যন্ত ছাদের সারি',
  visionPlace: 'ঢাকা',
  pillars: [
    { title: 'সংযুক্ত দল', body: 'হাসপাতালের প্রতিটি ডেস্ক কাজ করে দিনের একই ছবি দেখে।' },
    {
      title: 'দৃশ্যমান সেবা',
      body: 'অপেক্ষা, শয্যা আর অগ্রগতি যেমন আছে তেমনই — কতটা হালনাগাদ, তা-সহ।',
    },
    {
      title: 'হাতের নাগালে সেবা',
      body: 'রোগীর জন্য স্পষ্ট তথ্য, বাংলা ও ইংরেজিতে, নিজের ফোনেই।',
    },
  ],

  experiencesLabel: 'এক ইকোসিস্টেম',
  experiencesTitle: 'একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম।\nভিন্ন প্রয়োজনে দুটি অভিজ্ঞতা।',
  experiences: {
    hospitals: {
      chip: 'হাসপাতালের জন্য',
      title: 'যে হাসপাতাল একসঙ্গে চলে।',
      points: ['সমন্বিত দল', 'কার্যক্রমের লাইভ চিত্র', 'রোগীর জন্য আধুনিক অভিজ্ঞতা'],
      cta: 'হাসপাতালের জন্য দেখুন',
      alt: 'বাংলাদেশের একটি ল্যাবরেটরিতে নমুনা টিউবের ওপর পিপেট হাতে দস্তানা পরা হাত',
    },
    patients: {
      chip: 'রোগীর জন্য',
      title: 'সেবা খোঁজা ও অনুসরণ করা সহজ।',
      points: ['সঠিক সেবা খুঁজুন', 'সহজ সিরিয়াল', 'সিরিয়ালে নিজের অবস্থান জানুন'],
      cta: 'রোগীর জন্য দেখুন',
      alt: 'চট্টগ্রামের সবুজ ধানক্ষেতে চারা রোপণ করছেন একজন কৃষক',
    },
    connector: 'এক প্ল্যাটফর্ম',
  },

  hospitalsLabel: 'হাসপাতালের জন্য',
  hospitalsTitle: 'আরও সংযুক্ত হাসপাতাল চালান।',
  hospitalsBody:
    'রিসেপশন থেকে ওয়ার্ড — প্রতিটি দল পায় দিনের একই লাইভ চিত্র। নকশাটাই এমন, যাতে কর্মীদের তথ্যের পেছনে কম ছুটতে হয়, আর রোগীদের কম অনিশ্চয়তায় থাকতে হয়।',
  hospitalsAlt: 'বাংলাদেশের একটি হাসপাতালে প্রশিক্ষণে অংশ নিচ্ছেন সাদা টুপি পরা নার্সরা',
  hospitalBenefits: [
    {
      title: 'দল একসঙ্গে',
      body: 'রিসেপশন, চিকিৎসক, ওয়ার্ড, জরুরি বিভাগ ও ল্যাব দেখে দিনের একই ছবি।',
    },
    { title: 'স্পষ্ট চিত্র', body: 'দিন কেমন চলছে, দেখুন তখনই — দিন শেষে নয়।' },
    { title: 'কর্মীদের জন্য সহজ', body: 'প্রতিটি ভূমিকার জন্য শান্ত, দ্বিভাষিক স্ক্রিন।' },
    { title: 'রোগীর জন্য ভালো', body: 'রোগী অপেক্ষা করেন তথ্য নিয়ে, অনিশ্চয়তা নিয়ে নয়।' },
    {
      title: 'আপনার কাজের ধরনে',
      body: 'শুরু হয় আপনার বর্তমান প্রক্রিয়ার পাশাপাশি; আপনার তালিকা আনা হয় যত্নের সঙ্গে।',
    },
    {
      title: 'আপনার নাম, আপনার রং',
      body: 'রোগীর কাছে উপস্থাপিত হয় আপনার হাসপাতালের নিজস্ব পরিচয়ে।',
    },
  ],
  hospitalsNote: 'ব্যক্তিগত ডেমোতে শুধু কৃত্রিম তথ্য — কখনো প্রকৃত রোগীর তথ্য নয়।',
  glimpse: {
    today: 'আজ',
    live: 'লাইভ',
    beds: 'শয্যা',
    fresh: '২ মিনিট আগে হালনাগাদ',
    illustrative: 'দৃষ্টান্ত',
  },

  patientsLabel: 'রোগীর জন্য',
  patientsTitle: 'স্বাস্থ্যসেবা — খুঁজে পাওয়া সহজ, অনুসরণ করাও সহজ।',
  patientsBody:
    'সঠিক চিকিৎসক খোঁজা থেকে নিজের পালা জানা পর্যন্ত — আরও শান্ত, আরও স্পষ্ট এক যাত্রা।',
  patientsAlt: 'সন্ধ্যার নরম আলোয় শ্রীমঙ্গল, সিলেটের সবুজ টিলায় চা-বাগান',
  patientBenefits: [
    { title: 'সঠিক সেবা খুঁজুন', body: 'চিকিৎসক, বিশেষজ্ঞতা ও হাসপাতাল খুঁজুন; কে আছেন দেখুন।' },
    { title: 'সহজ সিরিয়াল', body: 'কাগজপত্র বা বারবার ফোন ছাড়াই কয়েক ধাপে সিরিয়াল।' },
    { title: 'নিজের অবস্থান জানুন', body: 'সিরিয়াল এগোলে দেখুন, সময়মতো পৌঁছান।' },
    { title: 'ভরসার তথ্য', body: 'প্রতিটি লাইভ তথ্য জানায় তা কতটা সাম্প্রতিক।' },
    { title: 'নিজের ভাষায়', body: 'বাংলা ও ইংরেজি, নিজের ফোনেই।' },
  ],
  comingSoon: 'শিগগিরই আসছে',
  patientsStatus:
    'MedLiveBD রোগীর অ্যাপ চালু হবে হাসপাতাল ধরে ধরে, বাংলাদেশে প্রতিটি হাসপাতাল চালু হলে। এটি এখনো সবার জন্য উন্মুক্ত নয়।',
  patientsHospitalAsk: 'আপনার রোগীদের জন্য চান?',
  phone: {
    title: 'আমার সিরিয়াল',
    hospital: 'আপনার হাসপাতাল',
    yourSerial: 'আপনার সিরিয়াল',
    nowServing: 'এখন চলছে',
    ahead: 'আপনার আগে',
    updated: 'এইমাত্র হালনাগাদ',
    steps: ['নেওয়া', 'অপেক্ষায়', 'আপনার পালা'],
  },

  mapLabel: 'সংযুক্ত বাংলাদেশ',
  mapTitle: 'যে লক্ষ্য পৌঁছায়\nপ্রতিটি বিভাগে।',
  mapBody:
    'আমরা MedLiveBD গড়ছি যাতে দেশের যেকোনো প্রান্তের যেকোনো হাসপাতাল এক সংযুক্ত ইকোসিস্টেমে যুক্ত হতে পারে — আর রংপুর থেকে চট্টগ্রাম, যেকোনো রোগী আস্থার সঙ্গে সেবা খুঁজে পান।',
  mapConcept: 'ধারণাগত দৃষ্টান্ত',
  mapLegend:
    'বাংলাদেশের আটটি বিভাগ ও সংযুক্ত সেবার আমাদের লক্ষ্য। এটি বর্তমান হাসপাতাল, গ্রাহক বা বিস্তার দেখায় না।',
  mapCredit:
    'সীমানা: geoBoundaries (CC0)। জেলার রেখা: বাংলাদেশ পরিসংখ্যান ব্যুরো ও OCHA ROAP (CC BY 3.0 IGO)।',
  mapAria:
    'আটটি বিভাগসহ বাংলাদেশের মানচিত্র। ঢাকা থেকে প্রতিটি বিভাগীয় সদরে রেখাগুলো সংযুক্ত সেবার লক্ষ্য বোঝায়; এটি ধারণা, বর্তমান বিস্তার নয়।',
  mapDivisions: 'বিভাগ',

  trustLabel: 'আস্থা ও দায়িত্ব',
  trustTitle: 'দায়িত্ব, নকশাতেই।',
  trust: [
    {
      title: 'হাসপাতালভিত্তিক গোপনীয়তা',
      body: 'প্রতিটি হাসপাতালের তথ্য থাকে তার নিজস্ব কর্মক্ষেত্রে।',
    },
    { title: 'আগে সম্মতি', body: 'রোগীর রেকর্ড অন্য হাসপাতালে যায় শুধু তাঁর সম্মতিতে।' },
    {
      title: 'সৎ তথ্য',
      body: 'লাইভ সংখ্যা জানায় তা কতটা সাম্প্রতিক। না-থাকা তথ্য কখনো অনুমান করা হয় না।',
    },
    { title: 'সিদ্ধান্ত মানুষের', body: 'MedLiveBD কোনো চিকিৎসা-সিদ্ধান্ত নেয় না।' },
  ],

  contactLabel: 'কথা বলুন',
  contactTitle: 'চলুন, একসঙ্গে গড়ি সংযুক্ত সেবা।',
  contactBody:
    'আপনি যদি বাংলাদেশের কোনো হাসপাতাল বা ক্লিনিকের দায়িত্বে থাকেন, ব্যক্তিগত ডেমোতে MedLiveBD দেখাতে পেরে আমরা আনন্দিত হব।',
  contactAlt: 'সূর্যাস্তে ঢাকার বুড়িগঙ্গা নদী পার হচ্ছে নৌকা, ছায়ামূর্তিতে',
  emailLabel: 'MedLiveBD দলকে ইমেইল করুন',
  copy: 'ঠিকানা কপি করুন',
  copied: 'কপি হয়েছে',
  contactNote:
    'ডেমোতে কৃত্রিম তথ্য ব্যবহার করা হয়। হাসপাতালের ব্যবহার, সেবাদাতা সংযোগ ও বাণিজ্যিক শর্ত সরাসরি আলোচনা করা হয়।',

  footer: 'সুস্থ বাংলাদেশের জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম।',
  aboutFoot: 'আজকের যত্ন। আগামী দিনের সুস্থতা।',
  footerExplore: 'দেখুন',
  footerCompany: 'প্রতিষ্ঠান',
  footerContact: 'যোগাযোগ',
  footerLanguage: 'ভাষা',
  footerLinks: [
    { id: 'vision', label: 'আমাদের লক্ষ্য' },
    { id: 'hospitals', label: 'হাসপাতালের জন্য' },
    { id: 'patients', label: 'রোগীর জন্য' },
    { id: 'bangladesh', label: 'সংযুক্ত বাংলাদেশ' },
  ],
  footerFounders: 'প্রতিষ্ঠাতা',
  trustLink: 'আস্থা ও দায়িত্ব',
  credits: 'ছবির কৃতজ্ঞতা',
  privacy: 'গোপনীয়তা নীতি',
  backTop: 'ওপরে ফিরে যান',
  copyright: 'MedLiveBD',
  photoCredit: 'ছবি',

  creditsTitle: 'ছবি ও মানচিত্রের কৃতজ্ঞতা',
  creditsIntro:
    'এই সাইটের জন্য এআই দিয়ে তৈরি দৃশ্য ও উন্মুক্ত লাইসেন্সের ভৌগোলিক তথ্য। সব ফাইল এই ওয়েবসাইট থেকেই সরবরাহ করা হয়।',
  creditsPhotos: 'ছবি',
  creditsMap: 'মানচিত্রের তথ্য',
  creditsBy: '—',
  creditsSource: 'উৎস',
  creditsLicence: 'লাইসেন্স',
  creditsBack: 'MedLiveBD-তে ফিরে যান',

  privacyTitle: 'গোপনীয়তা নীতি',
  privacyUpdated: 'সর্বশেষ হালনাগাদ ১২ অক্টোবর ২০২৬',
  privacyBack: 'MedLiveBD-তে ফিরে যান',
  privacySections: [
    {
      heading: 'এই ওয়েবসাইট',
      body: 'এটি MedLiveBD-এর প্রতিষ্ঠানিক ওয়েবসাইট। এখানে কোনো অ্যাকাউন্ট, ফর্ম, কুকি, অ্যানালিটিক্স বা বিজ্ঞাপনের ট্র্যাকার নেই, এবং আপনার ব্যক্তিগত তথ্য চাওয়া হয় না। এর ছবি, ফন্ট ও মানচিত্র এই সাইট থেকেই আসে।',
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
      body: 'MedLiveBD-এর ডেমোতে কৃত্রিম তথ্য ব্যবহার করা হয়। এই সাইটের স্বাস্থ্যসেবা ও শহরের দৃশ্যগুলো এআই দিয়ে তৈরি দৃষ্টান্ত। এগুলো MedLiveBD-এর প্রকৃত কর্মী, রোগী বা গ্রাহককে দেখায় না। কোনো প্রকৃত রোগীর তথ্য দেখানো হয় না।',
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
