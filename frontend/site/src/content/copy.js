/**
 * Company-site copy: GR-06; truthful S-C-01/02/04/05, FR-SEC-08.
 *
 * The site sells the idea, not the implementation (owner, 12 October 2026):
 * what MedLiveBD is, who it serves, where each audience goes next. Detailed
 * workflows belong in a private demonstration. No customers, partners,
 * figures, testimonials or certifications; the map is a vision, never
 * coverage; the patient app is always named as a demonstration.
 */
export const contactEmail = 'support@medlivebd.com';
export const demoHref = `mailto:${contactEmail}?subject=${encodeURIComponent('MedLiveBD — Hospital demonstration request')}&body=${encodeURIComponent('Hospital or clinic:\nCity:\nYour name and role:\nPhone:\n\n')}`;
/**
 * The patient web app (demo, `DEMO_MODE=true`, docs/STATUS.md). Owner, 12 October
 * 2026: "For Patients" opens it directly, always marked as a demo. The same
 * address in both languages; the app chooses its own language.
 */
export const patientAppHref = 'https://healthcare-patient-zeta.vercel.app';
/**
 * "For Hospitals" is a page of this site. The staff console's demo is
 * password-less, so it is never linked publicly (FR-SEC-08).
 */
export const hospitalsHref = (locale) => `/${locale}/hospitals`;
export const aboutHref = (locale) => `/${locale}/about`;

const en = {
  title: 'MedLiveBD — A Connected Healthcare Ecosystem for a Healthier Bangladesh',
  description:
    'MedLiveBD connects hospitals, healthcare professionals and patients through technology designed for Bangladesh.',
  skip: 'Skip to content',
  menu: 'Menu',
  close: 'Close menu',
  mainNav: 'Main',
  nav: { hospitals: 'For Hospitals', patients: 'For Patients', about: 'About Us' },
  otherLanguageLabel: 'বাংলায় পড়ুন',
  language: 'Language',
  demo: 'Request a Demo',
  demoTag: 'Demo',
  newTab: '(opens in a new tab)',
  emailHint: 'Opens your email app',
  demoNotice:
    'The patient app is a demonstration with sample data. Please do not enter real personal information.',

  hero: {
    /** The main line (owner, 12 October 2026); the accented part carries the brand gradient. */
    title: [
      { text: 'A Connected Healthcare Ecosystem for a ', accent: false },
      { text: 'Healthier Bangladesh', accent: true },
    ],
    lead: 'Connecting hospitals, healthcare professionals and patients through technology designed for Bangladesh.',
    choose: 'Choose where to go',
    hospitals: 'For Hospitals',
    hospitalsSub: 'Explore Hospital Solutions',
    patients: 'For Patients',
    patientsSub: 'Open Patient App',
    alt: 'Illustrative scene: a Bangladeshi doctor and a colleague in hijab reviewing a tablet together in a hospital.',
  },

  idea: {
    label: 'One connected ecosystem',
    statement: 'Better connected hospitals. A clearer journey for patients.',
    body: 'When everyone inside a hospital works from the same live picture of the day, the people waiting for care can see it too. MedLiveBD connects both sides.',
    hospitals: 'Hospitals',
    hospitalsParts: 'Reception · Doctors · Beds · Emergency · Laboratory',
    patients: 'Patients',
    patientsParts: 'Find · Book · Follow',
  },

  forHospitals: {
    label: 'For Hospitals',
    title: 'Help your hospital work as one connected team.',
    body: 'Bring greater visibility and coordination to everyday hospital operations.',
    points: [
      [
        'Live queues and appointment coordination',
        'Serials called in order, with every waiting patient kept informed.',
      ],
      ['Beds and emergency visibility', 'Ward, ICU and emergency capacity in one current view.'],
      [
        'Connected hospital teams',
        'Reception, doctors, wards and the laboratory working from one picture.',
      ],
      [
        'Information that helps staff act with clarity',
        'Every figure shows how recent it is. Nothing is guessed.',
      ],
    ],
    explore: 'Explore Hospital Solutions',
    alt: 'Illustrative scene: three Bangladeshi doctors reviewing notes together at a hospital ward desk.',
  },

  forPatients: {
    label: 'For Patients',
    title: 'Finding care should feel simpler.',
    body: 'Discover healthcare services, book serials and stay informed about your place in line.',
    steps: [
      ['Find care', 'Doctors, specialties and hospitals in one search.'],
      ['Book a serial', 'From the phone you already carry.'],
      ['Follow live progress', 'See how many are ahead and when it is your turn.'],
    ],
    open: 'Open Patient App',
    alt: 'Illustrative scene: a young man showing his father a phone in a hospital waiting area.',
  },

  vision: {
    label: 'Our Bangladesh vision',
    title: 'Built for Bangladesh.',
    body: 'Designed around the realities of local healthcare, with a vision for a more connected future.',
    points: [
      'Bangla first, with English alongside',
      'Made for the phones people already use',
      'Each hospital’s information in its own private workspace',
    ],
    note: 'A vision of connected care across the eight divisions — not current hospital coverage.',
    alt: 'Outline of Bangladesh with its eight divisions. Lines from Dhaka to each division headquarters illustrate a vision, not active hospitals or coverage.',
    credit: 'Boundaries: geoBoundaries (CC0)',
  },

  closing: {
    title: 'Let’s build more connected care, together.',
    body: 'Discover how MedLiveBD can support your hospital’s next step.',
    alt: 'Illustrative scene: a Dhaka-inspired neighbourhood at blue hour, warm lights among the rooftops.',
  },

  hospitalsPage: {
    title: 'For Hospitals — MedLiveBD',
    description:
      'MedLiveBD helps hospitals in Bangladesh work as one connected team: live queues, beds and emergency visibility, and clear information for staff.',
    label: 'For Hospitals',
    heading: 'Help your hospital work as one connected team.',
    lead: 'MedLiveBD brings reception, doctors, wards, emergency and the laboratory onto one shared, live picture of the day — and keeps the patients who are waiting informed.',
    alt: 'Illustrative scene: Bangladeshi nursing, medical and administrative staff coordinating at a hospital workstation, with wards beyond.',
    capabilitiesTitle: 'What changes for your hospital',
    capabilities: [
      [
        'Live queues and serials',
        'Reception calls the next patient, and everyone waiting sees it on their phone.',
      ],
      [
        'Beds and emergency visibility',
        'Ward, ICU and emergency capacity, each figure with how recent it is.',
      ],
      [
        'One connected team',
        'Reception, doctors, wards, emergency and the laboratory work from the same picture.',
      ],
      ['Clear for every role', 'Calm screens in Bangla and English, designed around each job.'],
      [
        'Your hospital’s own presence',
        'Patients meet your hospital under its own name, logo and colours.',
      ],
      [
        'Starts where you are',
        'Begin alongside how you work today, with your existing lists brought in carefully.',
      ],
    ],
    trustTitle: 'Responsible by design',
    trust: [
      ['Private by hospital', 'Each hospital’s information stays in its own workspace.'],
      ['Consent first', 'A patient’s records reach another hospital only with their consent.'],
      [
        'Honest information',
        'Live figures show how recent they are. Missing data is never guessed.',
      ],
      ['People decide care', 'MedLiveBD supports coordination. It makes no clinical decisions.'],
    ],
    stepsTitle: 'How we begin',
    steps: [
      ['A conversation', 'Tell us about your hospital and what you would like to improve.'],
      [
        'A private demonstration',
        'See MedLiveBD on synthetic data, shaped around your departments.',
      ],
      ['A careful start', 'Set up with your team and begin alongside how you work today.'],
    ],
    ctaTitle: 'See MedLiveBD for your hospital.',
    ctaBody: 'Demonstrations use synthetic data — never real patient information.',
  },

  aboutPage: {
    title: 'About Us — MedLiveBD',
    label: 'About us',
  },

  footer: {
    line: 'A connected healthcare ecosystem for a healthier Bangladesh.',
    explore: 'Explore',
    company: 'Company',
    contact: 'Contact',
    privacy: 'Privacy notice',
    credits: 'Image credits',
    backTop: 'Back to top',
    synthetic:
      'Photographs are AI-generated illustrative scenes — not actual staff, patients or partner hospitals.',
  },

  creditsTitle: 'Image and map credits',
  creditsIntro:
    'Original AI-generated campaign scenes and openly licensed geographic data. All assets are served from this website.',
  assetsTitle: 'Original campaign imagery',
  assetsIntro:
    'These scenes were generated with OpenAI image generation for this website on 12 October 2026. The people and settings are synthetic illustrations, not photographs of MedLiveBD staff, customers or hospitals. They do not imply endorsement or actual coverage.',
  assetNames: [
    'Connected clinicians',
    'Hospital teamwork',
    'A clearer patient journey',
    'Dhaka-inspired evening',
    'Hospital operations',
  ],
  creditsMap: 'Map data',
  creditsSource: 'Source',
  back: 'Back to MedLiveBD',

  privacyTitle: 'Privacy notice',
  privacyUpdated: 'Last updated 12 October 2026',
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
      body: 'MedLiveBD demonstrations use synthetic data. The patient app linked from this site is a demonstration with sample data: please do not enter real personal information in it. The healthcare and city scenes on this website are AI-generated illustrations and do not depict actual MedLiveBD staff, patients or customers.',
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

const bn = {
  title: 'MedLiveBD — সুস্থ বাংলাদেশের জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম',
  description:
    'বাংলাদেশের জন্য তৈরি প্রযুক্তিতে MedLiveBD হাসপাতাল, স্বাস্থ্যসেবা পেশাজীবী ও রোগীদের যুক্ত করে।',
  skip: 'মূল বিষয়বস্তুতে যান',
  menu: 'মেনু',
  close: 'মেনু বন্ধ করুন',
  mainNav: 'প্রধান',
  nav: { hospitals: 'হাসপাতালের জন্য', patients: 'রোগীদের জন্য', about: 'আমাদের সম্পর্কে' },
  otherLanguageLabel: 'Read in English',
  language: 'ভাষা',
  demo: 'ডেমোর অনুরোধ',
  demoTag: 'ডেমো',
  newTab: '(নতুন ট্যাবে খুলবে)',
  emailHint: 'আপনার ইমেইল অ্যাপ খুলবে',
  demoNotice:
    'পেশেন্ট অ্যাপটি নমুনা তথ্যে চলা একটি ডেমো। অনুগ্রহ করে প্রকৃত ব্যক্তিগত তথ্য দেবেন না।',

  hero: {
    title: [
      { text: 'সুস্থ বাংলাদেশের', accent: true },
      { text: ' জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম', accent: false },
    ],
    lead: 'বাংলাদেশের জন্য তৈরি প্রযুক্তিতে হাসপাতাল, স্বাস্থ্যসেবা পেশাজীবী ও রোগীদের এক সূত্রে যুক্ত করছি।',
    choose: 'কোথায় যেতে চান',
    hospitals: 'হাসপাতালের জন্য',
    hospitalsSub: 'হাসপাতালের সমাধান দেখুন',
    patients: 'রোগীদের জন্য',
    patientsSub: 'পেশেন্ট অ্যাপে যান',
    alt: 'দৃষ্টান্তমূলক দৃশ্য: হাসপাতালে একজন বাংলাদেশি চিকিৎসক ও হিজাব পরা সহকর্মী একসঙ্গে ট্যাবলেট দেখছেন।',
  },

  idea: {
    label: 'একটি সংযুক্ত ইকোসিস্টেম',
    statement: 'আরও সংযুক্ত হাসপাতাল। রোগীর জন্য আরও স্পষ্ট পথ।',
    body: 'হাসপাতালের ভেতরের সবাই যখন দিনের একই লাইভ চিত্র দেখে কাজ করেন, সেবার অপেক্ষায় থাকা মানুষও তখন তা দেখতে পান। MedLiveBD দুই পক্ষকেই যুক্ত করে।',
    hospitals: 'হাসপাতাল',
    hospitalsParts: 'রিসেপশন · চিকিৎসক · শয্যা · জরুরি বিভাগ · ল্যাব',
    patients: 'রোগী',
    patientsParts: 'খুঁজুন · বুক করুন · অনুসরণ করুন',
  },

  forHospitals: {
    label: 'হাসপাতালের জন্য',
    title: 'আপনার হাসপাতাল চলুক একটি সংযুক্ত দল হিসেবে।',
    body: 'হাসপাতালের প্রতিদিনের কাজে আনুন আরও স্পষ্ট চিত্র ও সমন্বয়।',
    points: [
      [
        'লাইভ কিউ ও অ্যাপয়েন্টমেন্ট সমন্বয়',
        'ক্রম মেনে সিরিয়াল ডাকা, অপেক্ষায় থাকা প্রত্যেক রোগী থাকেন অবগত।',
      ],
      [
        'শয্যা ও জরুরি বিভাগের চিত্র',
        'ওয়ার্ড, আইসিইউ ও জরুরি বিভাগের সক্ষমতা, এক হালনাগাদ চিত্রে।',
      ],
      ['সংযুক্ত হাসপাতাল দল', 'রিসেপশন, চিকিৎসক, ওয়ার্ড ও ল্যাব কাজ করে একই চিত্র দেখে।'],
      ['স্পষ্টভাবে কাজের জন্য তথ্য', 'প্রতিটি তথ্য জানায় তা কতটা সাম্প্রতিক। কিছুই অনুমান নয়।'],
    ],
    explore: 'হাসপাতালের সমাধান দেখুন',
    alt: 'দৃষ্টান্তমূলক দৃশ্য: হাসপাতালের ওয়ার্ড ডেস্কে তিনজন বাংলাদেশি চিকিৎসক একসঙ্গে নোট দেখছেন।',
  },

  forPatients: {
    label: 'রোগীদের জন্য',
    title: 'সেবা খুঁজে পাওয়া হোক আরও সহজ।',
    body: 'স্বাস্থ্যসেবা খুঁজুন, সিরিয়াল বুক করুন, আর জেনে নিন লাইনে আপনার অবস্থান।',
    steps: [
      ['সেবা খুঁজুন', 'চিকিৎসক, বিশেষজ্ঞতা ও হাসপাতাল, এক খোঁজে।'],
      ['সিরিয়াল বুক করুন', 'নিজের ফোন থেকেই।'],
      ['লাইভ অগ্রগতি দেখুন', 'আগে কতজন আছেন, কখন আপনার পালা — জেনে নিন।'],
    ],
    open: 'পেশেন্ট অ্যাপে যান',
    alt: 'দৃষ্টান্তমূলক দৃশ্য: হাসপাতালের অপেক্ষার জায়গায় এক তরুণ তাঁর বাবাকে ফোন দেখাচ্ছেন।',
  },

  vision: {
    label: 'বাংলাদেশকে ঘিরে আমাদের লক্ষ্য',
    title: 'বাংলাদেশের জন্য তৈরি।',
    body: 'দেশের স্বাস্থ্যসেবার বাস্তবতাকে ঘিরে নকশা করা — আরও সংযুক্ত ভবিষ্যতের লক্ষ্যে।',
    points: [
      'বাংলা আগে, পাশে ইংরেজি',
      'মানুষের হাতের ফোনের কথা ভেবে তৈরি',
      'প্রতিটি হাসপাতালের তথ্য তার নিজস্ব সুরক্ষিত কর্মক্ষেত্রে',
    ],
    note: 'আটটি বিভাগজুড়ে সংযুক্ত সেবার আমাদের লক্ষ্য — বর্তমান হাসপাতাল কভারেজ নয়।',
    alt: 'আটটি বিভাগসহ বাংলাদেশের সীমানা। ঢাকা থেকে প্রতিটি বিভাগীয় সদরের দিকে রেখাগুলো একটি লক্ষ্য বোঝায়, চালু হাসপাতাল বা কভারেজ নয়।',
    credit: 'সীমানা: geoBoundaries (CC0)',
  },

  closing: {
    title: 'আরও সংযুক্ত স্বাস্থ্যসেবা গড়ি, একসঙ্গে।',
    body: 'আপনার হাসপাতালের পরবর্তী ধাপে MedLiveBD কীভাবে পাশে থাকতে পারে, জেনে নিন।',
    alt: 'দৃষ্টান্তমূলক দৃশ্য: সন্ধ্যার নীল আলোয় ঢাকাকে ঘিরে একটি এলাকা, ছাদের সারিতে ঘরের উষ্ণ আলো।',
  },

  hospitalsPage: {
    title: 'হাসপাতালের জন্য — MedLiveBD',
    description:
      'MedLiveBD বাংলাদেশের হাসপাতালকে একটি সংযুক্ত দল হিসেবে কাজ করতে সাহায্য করে: লাইভ কিউ, শয্যা ও জরুরি বিভাগের চিত্র, আর কর্মীদের জন্য স্পষ্ট তথ্য।',
    label: 'হাসপাতালের জন্য',
    heading: 'আপনার হাসপাতাল চলুক একটি সংযুক্ত দল হিসেবে।',
    lead: 'MedLiveBD রিসেপশন, চিকিৎসক, ওয়ার্ড, জরুরি বিভাগ ও ল্যাবকে দিনের একই লাইভ চিত্রে আনে — আর অপেক্ষায় থাকা রোগীদের রাখে অবগত।',
    alt: 'দৃষ্টান্তমূলক দৃশ্য: বাংলাদেশের একটি হাসপাতালের ওয়ার্কস্টেশনে নার্স, চিকিৎসক ও প্রশাসনিক কর্মী একসঙ্গে কাজ করছেন, পেছনে ওয়ার্ড দেখা যাচ্ছে।',
    capabilitiesTitle: 'আপনার হাসপাতালে যা বদলাবে',
    capabilities: [
      [
        'লাইভ কিউ ও সিরিয়াল',
        'রিসেপশন পরের রোগীকে ডাকলে অপেক্ষায় থাকা সবাই নিজের ফোনে দেখতে পান।',
      ],
      [
        'শয্যা ও জরুরি বিভাগের চিত্র',
        'ওয়ার্ড, আইসিইউ ও জরুরি বিভাগের সক্ষমতা — প্রতিটি সংখ্যা কতটা সাম্প্রতিক, তা-সহ।',
      ],
      ['একটি সংযুক্ত দল', 'রিসেপশন, চিকিৎসক, ওয়ার্ড, জরুরি বিভাগ ও ল্যাব কাজ করে একই চিত্র দেখে।'],
      [
        'প্রতিটি ভূমিকার জন্য স্পষ্ট',
        'বাংলা ও ইংরেজিতে শান্ত স্ক্রিন, প্রতিটি কাজের কথা ভেবে নকশা করা।',
      ],
      ['আপনার হাসপাতালের নিজস্ব পরিচয়', 'রোগীরা আপনার হাসপাতালকে পান তার নিজের নাম, লোগো ও রঙে।'],
      [
        'যেখানে আছেন, সেখান থেকেই শুরু',
        'আজকের কাজের ধরনের পাশাপাশি শুরু; আপনার বিদ্যমান তালিকা আনা হয় যত্নের সঙ্গে।',
      ],
    ],
    trustTitle: 'দায়িত্ব, নকশাতেই',
    trust: [
      ['হাসপাতালভিত্তিক গোপনীয়তা', 'প্রতিটি হাসপাতালের তথ্য থাকে তার নিজস্ব কর্মক্ষেত্রে।'],
      ['আগে সম্মতি', 'রোগীর রেকর্ড অন্য হাসপাতালে যায় শুধু তাঁর সম্মতিতে।'],
      ['সৎ তথ্য', 'লাইভ সংখ্যা জানায় তা কতটা সাম্প্রতিক। না-থাকা তথ্য কখনো অনুমান করা হয় না।'],
      ['সিদ্ধান্ত মানুষের', 'MedLiveBD সমন্বয়ে সহায়তা করে। কোনো চিকিৎসা-সিদ্ধান্ত নেয় না।'],
    ],
    stepsTitle: 'যেভাবে শুরু করি',
    steps: [
      ['একটি আলাপ', 'আপনার হাসপাতাল ও যা উন্নত করতে চান, সে সম্পর্কে আমাদের জানান।'],
      ['একটি ব্যক্তিগত ডেমো', 'আপনার বিভাগগুলোর আদলে কৃত্রিম তথ্যে MedLiveBD দেখুন।'],
      ['একটি যত্নশীল শুরু', 'আপনার দলের সঙ্গে প্রস্তুতি, আর আজকের কাজের ধরনের পাশাপাশি শুরু।'],
    ],
    ctaTitle: 'আপনার হাসপাতালের জন্য MedLiveBD দেখুন।',
    ctaBody: 'ডেমোতে কৃত্রিম তথ্য ব্যবহার করা হয় — কখনো প্রকৃত রোগীর তথ্য নয়।',
  },

  aboutPage: {
    title: 'আমাদের সম্পর্কে — MedLiveBD',
    label: 'আমাদের সম্পর্কে',
  },

  footer: {
    line: 'সুস্থ বাংলাদেশের জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম।',
    explore: 'দেখুন',
    company: 'প্রতিষ্ঠান',
    contact: 'যোগাযোগ',
    privacy: 'গোপনীয়তা নীতি',
    credits: 'ছবির কৃতজ্ঞতা',
    backTop: 'ওপরে ফিরে যান',
    synthetic:
      'ছবিগুলো এআই দিয়ে তৈরি দৃষ্টান্তমূলক দৃশ্য — প্রকৃত কর্মী, রোগী বা সহযোগী হাসপাতাল নয়।',
  },

  creditsTitle: 'ছবি ও মানচিত্রের কৃতজ্ঞতা',
  creditsIntro:
    'এই সাইটের জন্য এআই দিয়ে তৈরি দৃশ্য ও উন্মুক্ত লাইসেন্সের ভৌগোলিক তথ্য। সব ফাইল এই ওয়েবসাইট থেকেই সরবরাহ করা হয়।',
  assetsTitle: 'এই সাইটের জন্য তৈরি ছবি',
  assetsIntro:
    '২০২৬ সালের ১২ অক্টোবর OpenAI-এর ইমেজ জেনারেশন দিয়ে এই সাইটের জন্য দৃশ্যগুলো তৈরি করা হয়েছে। মানুষ ও পরিবেশগুলো কৃত্রিম দৃষ্টান্ত, MedLiveBD-এর প্রকৃত কর্মী, গ্রাহক বা হাসপাতালের ছবি নয়। এগুলো কোনো সমর্থন বা বর্তমান কভারেজ বোঝায় না।',
  assetNames: [
    'চিকিৎসকদের সংযোগ',
    'হাসপাতালের দল',
    'রোগীর সহজতর যাত্রা',
    'ঢাকাকে ঘিরে সন্ধ্যা',
    'হাসপাতালের কার্যক্রম',
  ],
  creditsMap: 'মানচিত্রের তথ্য',
  creditsSource: 'উৎস',
  back: 'MedLiveBD-তে ফিরে যান',

  privacyTitle: 'গোপনীয়তা নীতি',
  privacyUpdated: 'সর্বশেষ হালনাগাদ ১২ অক্টোবর ২০২৬',
  privacySections: [
    {
      heading: 'এই ওয়েবসাইট',
      body: 'এটি MedLiveBD-এর প্রাতিষ্ঠানিক ওয়েবসাইট। এখানে কোনো অ্যাকাউন্ট, ফর্ম, কুকি, অ্যানালিটিক্স বা বিজ্ঞাপনের ট্র্যাকার নেই, এবং আপনার ব্যক্তিগত তথ্য চাওয়া হয় না। এর ছবি, ফন্ট ও মানচিত্র এই সাইট থেকেই আসে।',
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
      body: 'MedLiveBD-এর ডেমোতে কৃত্রিম তথ্য ব্যবহার করা হয়। এই সাইট থেকে যে পেশেন্ট অ্যাপ খোলে, সেটি নমুনা তথ্যে চলা একটি ডেমো: অনুগ্রহ করে সেখানে প্রকৃত ব্যক্তিগত তথ্য দেবেন না। এই সাইটের স্বাস্থ্যসেবা ও শহরের দৃশ্যগুলো এআই দিয়ে তৈরি দৃষ্টান্ত; এগুলো MedLiveBD-এর প্রকৃত কর্মী, রোগী বা গ্রাহককে দেখায় না।',
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

export const copy = { en, bn };
