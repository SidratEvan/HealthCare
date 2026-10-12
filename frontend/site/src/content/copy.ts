/** Local presentation copy: GR-06; truthful S-C-01/02/04/05, FR-SEC-08. */
export const contactEmail = 'support@medlivebd.com';
export const demoHref = `mailto:${contactEmail}?subject=${encodeURIComponent('MedLiveBD — Hospital demonstration request')}`;
export type Locale = 'bn' | 'en';

/** One workflow the explorer shows, with the real screen captured for it. */
export interface Feature {
  readonly key: 'patient' | 'reception' | 'doctor' | 'ward' | 'lab' | 'admin';
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly detail: string;
  /** Read aloud for the screenshot; says it is demonstration data. */
  readonly alt: string;
}

const en = {
  title: 'MedLiveBD — A clearer picture of care',
  description:
    'Healthcare technology for Bangladesh. MedLiveBD connects patient queues, hospital operations, bed coordination and operational dashboards. Request a demonstration.',
  skip: 'Skip to content',
  menu: 'Menu',
  close: 'Close menu',
  nav: ['The platform', 'For hospitals', 'About us', 'Contact'],
  demo: 'Request a demonstration',
  explore: 'See the platform',
  eyebrow: 'Healthcare technology · Bangladesh',
  hero: ['A clearer ', 'picture of care.'],
  lead: 'Reception taps next, and every waiting patient’s phone shows it within seconds. MedLiveBD connects the hospital’s working day — queues, doctors, beds, emergency, lab — with the people waiting on it.',
  heroAltConsole:
    'The MedLiveBD reception console: today’s chambers with the serial now being served, demonstration data',
  heroAltPhone:
    'The MedLiveBD patient app: a live serial with the number now being served, demonstration data',
  liveBadge: 'Live serial',
  illustrative: 'Real MedLiveBD screens · demonstration data, no patient information',
  introLabel: 'The platform',
  introTitle: 'One platform.\nEvery desk connected.',
  intro:
    'A Bangla-first patient app and role-specific hospital consoles, built on one live queue. Each hospital works in its own private workspace; patients see only what the hospital chooses to publish, always with how old it is.',
  featureLabel: 'Choose a workspace',
  features: [
    {
      key: 'patient',
      label: 'Patient app',
      title: 'A serial the patient can trust.',
      body: 'Patients find participating hospitals and doctors, book a serial, and follow the chamber live — in Bangla or English, without installing anything.',
      detail: 'Every live figure carries its age. A lost connection is shown, never hidden.',
      alt: 'The patient app’s live serial screen, demonstration data',
    },
    {
      key: 'reception',
      label: 'Reception',
      title: 'Every chamber on one desk.',
      body: 'Reception runs several doctors’ queues at once: arrivals, walk-ins, call next, late and no-show, pauses and delays.',
      detail: 'Keeps working through a dropped connection and reconciles when it returns.',
      alt: 'The reception console with several chambers, demonstration data',
    },
    {
      key: 'doctor',
      label: 'Doctor',
      title: 'The consultation, in one place.',
      body: 'The doctor sees the queue, the patient’s permitted history, and writes notes, medicines, tests and follow-up — then signs and calls the next.',
      detail:
        'A record is signed against the patient it was written for, whatever the queue does meanwhile.',
      alt: 'The doctor’s consultation workspace, demonstration data',
    },
    {
      key: 'ward',
      label: 'Beds & emergency',
      title: 'Capacity teams can coordinate.',
      body: 'Wards keep bed states current; the emergency department handles incoming alerts, triage and referrals between hospitals.',
      detail: 'Published capacity comes from recorded updates, with its age beside it.',
      alt: 'The ward bed board, demonstration data',
    },
    {
      key: 'lab',
      label: 'Lab & pharmacy',
      title: 'From order to report.',
      body: 'The lab follows doctor-ordered tests through sample, processing and report delivery to the patient. Pharmacies confirm which medicines are available.',
      detail: 'Medicine availability not reconfirmed within 12 hours is shown as unknown.',
      alt: 'The laboratory console, demonstration data',
    },
    {
      key: 'admin',
      label: 'Administration',
      title: 'The working day, in view.',
      body: 'Administrators see today’s chambers and recorded counts, run reports, and manage departments, doctors, staff, desks and settings.',
      detail: 'Figures reflect what was recorded — not an estimate presented as fact.',
      alt: 'The hospital administration dashboard, demonstration data',
    },
  ] satisfies readonly Feature[],
  hospitalLabel: 'For hospitals',
  hospitalTitle: 'Set up on your terms.',
  hospitalBody:
    'Start from how your teams already work. We configure your workspace with you, bring in your existing lists through a checked import, and rehearse the day before anyone relies on it.',
  steps: [
    {
      title: 'Configure',
      body: 'Departments, doctors, chambers, staff roles and desks.',
    },
    {
      title: 'Import',
      body: 'Your existing lists, checked and previewed before anything is written.',
    },
    {
      title: 'Rehearse',
      body: 'Walk through the day with demonstration data before going live.',
    },
  ],
  aboutLabel: 'About MedLiveBD',
  aboutTitle: 'Technology for the spaces\nbetween care.',
  aboutBody:
    'A patient waiting for a call. A receptionist managing a chamber. A ward team updating a bed. MedLiveBD connects those moments, for hospitals and patients in Bangladesh.',
  principles: [
    { title: 'Honest by design', body: 'Old information says it is old.' },
    { title: 'Private per hospital', body: 'Each hospital’s data stays in its own workspace.' },
    { title: 'Bangla first', body: 'Every screen in Bangla and English.' },
  ],
  aboutFoot: 'Care today. Healthy tomorrow.',
  contactLabel: 'Let’s talk',
  contactTitle: 'See your working day\nin a new light.',
  contactBody:
    'Tell us about your hospital and the workflows you would like to explore. We’ll arrange a demonstration of MedLiveBD.',
  emailLabel: 'Email the MedLiveBD team',
  contactNote:
    'Demonstrations use synthetic data. Hospital deployment, provider connections and commercial terms are discussed directly.',
  footer: 'Healthcare technology for Bangladesh.',
  footerCompany: 'Company',
  footerContact: 'Contact',
  footerLanguage: 'Language',
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

const bn: typeof en = {
  title: 'MedLiveBD — হাসপাতালের কাজ, এক সংযোগে',
  description:
    'বাংলাদেশের জন্য স্বাস্থ্যসেবা প্রযুক্তি। রোগীর সিরিয়াল, হাসপাতালের কার্যক্রম, শয্যা সমন্বয় ও ড্যাশবোর্ডকে যুক্ত করে MedLiveBD। ডেমোর জন্য যোগাযোগ করুন।',
  skip: 'মূল বিষয়বস্তুতে যান',
  menu: 'মেনু',
  close: 'মেনু বন্ধ করুন',
  nav: ['প্ল্যাটফর্ম', 'হাসপাতালের জন্য', 'আমাদের সম্পর্কে', 'যোগাযোগ'],
  demo: 'ডেমোর জন্য যোগাযোগ',
  explore: 'প্ল্যাটফর্ম দেখুন',
  eyebrow: 'স্বাস্থ্যসেবা প্রযুক্তি · বাংলাদেশ',
  hero: ['হাসপাতালের কাজ, ', 'আরও স্পষ্ট।'],
  lead: 'রিসেপশন পরের সিরিয়াল ডাকলে অপেক্ষমাণ প্রত্যেক রোগীর ফোনে কয়েক সেকেন্ডেই তা দেখা যায়। সিরিয়াল, চিকিৎসক, শয্যা, জরুরি বিভাগ, ল্যাব—হাসপাতালের পুরো দিনকে রোগীর সঙ্গে যুক্ত করে MedLiveBD।',
  heroAltConsole: 'MedLiveBD রিসেপশন কনসোল: আজকের চেম্বার ও চলমান সিরিয়াল, ডেমো তথ্য',
  heroAltPhone: 'MedLiveBD রোগীর অ্যাপ: লাইভ সিরিয়াল, ডেমো তথ্য',
  liveBadge: 'লাইভ সিরিয়াল',
  illustrative: 'MedLiveBD-এর আসল স্ক্রিন · ডেমো তথ্য, কোনো রোগীর তথ্য নয়',
  introLabel: 'প্ল্যাটফর্ম',
  introTitle: 'একটি প্ল্যাটফর্ম।\nসব ডেস্ক যুক্ত।',
  intro:
    'বাংলা-প্রথম রোগীর অ্যাপ আর ভূমিকাভিত্তিক হাসপাতাল কনসোল, একই লাইভ সিরিয়ালের ওপর। প্রতিটি হাসপাতালের নিজস্ব গোপন কর্মক্ষেত্র; রোগী দেখেন শুধু হাসপাতাল যা প্রকাশ করে, তথ্য কত পুরোনো তা-সহ।',
  featureLabel: 'একটি কর্মক্ষেত্র বেছে নিন',
  features: [
    {
      key: 'patient',
      label: 'রোগীর অ্যাপ',
      title: 'ভরসা করার মতো সিরিয়াল।',
      body: 'রোগী হাসপাতাল ও চিকিৎসক খুঁজে সিরিয়াল নেন, চেম্বারের সিরিয়াল সরাসরি দেখেন—কিছু ইনস্টল না করেই।',
      detail: 'প্রতিটি লাইভ তথ্যের পাশে তার বয়স। সংযোগ গেলে তা জানানো হয়।',
      alt: 'রোগীর অ্যাপের লাইভ সিরিয়াল, ডেমো তথ্য',
    },
    {
      key: 'reception',
      label: 'রিসেপশন',
      title: 'সব চেম্বার এক ডেস্কে।',
      body: 'একসঙ্গে কয়েকজন চিকিৎসকের সিরিয়াল: আগমন, ওয়াক-ইন, পরের জন, দেরি, অনুপস্থিতি, বিরতি।',
      detail: 'ইন্টারনেট গেলেও কাজ চলে; ফিরে এলে মিলিয়ে নেয়।',
      alt: 'কয়েকটি চেম্বারসহ রিসেপশন কনসোল, ডেমো তথ্য',
    },
    {
      key: 'doctor',
      label: 'চিকিৎসক',
      title: 'পরামর্শ, এক জায়গায়।',
      body: 'সিরিয়াল, রোগীর অনুমোদিত ইতিহাস, নোট, ওষুধ, পরীক্ষা ও ফলো-আপ—তারপর স্বাক্ষর দিয়ে পরের জন।',
      detail: 'রেকর্ড স্বাক্ষর হয় সেই রোগীরই নামে, যাঁর জন্য লেখা।',
      alt: 'চিকিৎসকের পরামর্শ কর্মক্ষেত্র, ডেমো তথ্য',
    },
    {
      key: 'ward',
      label: 'শয্যা ও জরুরি',
      title: 'শয্যা জানা, সমন্বয় সহজ।',
      body: 'ওয়ার্ড শয্যার অবস্থা হালনাগাদ রাখে; জরুরি বিভাগ আগমনবার্তা, ট্রায়াজ ও হাসপাতালের মধ্যে রেফারাল সামলায়।',
      detail: 'প্রকাশিত সংখ্যার পাশে তার বয়স দেখানো হয়।',
      alt: 'ওয়ার্ডের শয্যা বোর্ড, ডেমো তথ্য',
    },
    {
      key: 'lab',
      label: 'ল্যাব ও ফার্মেসি',
      title: 'নির্দেশ থেকে রিপোর্ট।',
      body: 'নমুনা, প্রক্রিয়াকরণ থেকে রোগীর কাছে রিপোর্ট পৌঁছানো পর্যন্ত ল্যাব অনুসরণ করে। ফার্মেসি ওষুধের প্রাপ্যতা নিশ্চিত করে।',
      detail: '১২ ঘণ্টায় নিশ্চিত না হলে ওষুধের তথ্য “জানা নেই” দেখায়।',
      alt: 'ল্যাবরেটরি কনসোল, ডেমো তথ্য',
    },
    {
      key: 'admin',
      label: 'প্রশাসন',
      title: 'দিনের কাজ, এক নজরে।',
      body: 'আজকের চেম্বার ও নথিভুক্ত সংখ্যা, রিপোর্ট, আর বিভাগ, চিকিৎসক, কর্মী, ডেস্ক ও সেটিংস।',
      detail: 'সংখ্যা আসে নথিভুক্ত কাজ থেকে, অনুমান থেকে নয়।',
      alt: 'হাসপাতাল প্রশাসনের ড্যাশবোর্ড, ডেমো তথ্য',
    },
  ],
  hospitalLabel: 'হাসপাতালের জন্য',
  hospitalTitle: 'আপনার নিয়মে শুরু।',
  hospitalBody:
    'আপনার দল যেভাবে কাজ করে, সেখান থেকেই শুরু। কর্মক্ষেত্র একসঙ্গে সাজাই, যাচাই করে আপনার তালিকা আনি, আর চালুর আগে পুরো দিনের মহড়া দিই।',
  steps: [
    { title: 'সাজানো', body: 'বিভাগ, চিকিৎসক, চেম্বার, কর্মীর ভূমিকা ও ডেস্ক।' },
    { title: 'তথ্য আনা', body: 'আপনার তালিকা, লেখার আগে যাচাই ও প্রিভিউ।' },
    { title: 'মহড়া', body: 'চালুর আগে ডেমো তথ্যে পুরো দিন।' },
  ],
  aboutLabel: 'MedLiveBD সম্পর্কে',
  aboutTitle: 'সেবার মাঝের\nসংযোগের প্রযুক্তি।',
  aboutBody:
    'ডাকের অপেক্ষায় রোগী, চেম্বার সামলানো রিসেপশন, শয্যা হালনাগাদ করা ওয়ার্ড—বাংলাদেশের হাসপাতাল ও রোগীদের জন্য এই মুহূর্তগুলো যুক্ত করে MedLiveBD।',
  principles: [
    { title: 'সৎ তথ্য', body: 'পুরোনো তথ্য নিজেই জানায় সে পুরোনো।' },
    { title: 'হাসপাতালের গোপনীয়তা', body: 'প্রতিটি হাসপাতালের তথ্য তার নিজস্ব কর্মক্ষেত্রে।' },
    { title: 'বাংলা প্রথম', body: 'প্রতিটি স্ক্রিন বাংলা ও ইংরেজিতে।' },
  ],
  aboutFoot: 'আজকের যত্ন। আগামী দিনের সুস্থতা।',
  contactLabel: 'কথা বলুন',
  contactTitle: 'আপনার দিনের কাজ\nনতুনভাবে দেখুন।',
  contactBody: 'আপনার হাসপাতাল সম্পর্কে জানান। আমরা MedLiveBD-এর একটি ডেমোর ব্যবস্থা করব।',
  emailLabel: 'MedLiveBD দলকে ইমেইল করুন',
  contactNote:
    'ডেমোতে কৃত্রিম তথ্য ব্যবহার করা হয়। হাসপাতালের ব্যবহার, সেবাদাতা সংযোগ ও বাণিজ্যিক শর্ত সরাসরি আলোচনা করা হয়।',
  footer: 'বাংলাদেশের জন্য স্বাস্থ্যসেবা প্রযুক্তি।',
  footerCompany: 'প্রতিষ্ঠান',
  footerContact: 'যোগাযোগ',
  footerLanguage: 'ভাষা',
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
