/** Local presentation copy: GR-06; truthful S-C-01/02/04/05, FR-SEC-08. */
export const contactEmail = 'sidrat@medlivebd.com';
export const demoHref = `mailto:${contactEmail}?subject=${encodeURIComponent('MedLiveBD — Hospital demonstration request')}`;
export type Locale = 'bn' | 'en';

const en = {
  title: 'MedLiveBD — A clearer picture of care',
  description:
    'Healthcare technology for Bangladesh. MedLiveBD connects patient queues, hospital operations, bed coordination and operational dashboards. Request a demonstration.',
  skip: 'Skip to content',
  menu: 'Menu',
  close: 'Close menu',
  language: 'Language',
  nav: ['The platform', 'For hospitals', 'About us', 'Contact'],
  demo: 'Request a demonstration',
  explore: 'Explore the platform',
  eyebrow: 'HEALTHCARE TECHNOLOGY · BANGLADESH',
  hero: ['A clearer', 'picture', 'of care.'],
  lead: 'Bring the patient journey and the hospital’s working day into the same picture. From the first serial to the next available bed.',
  heroFoot: 'Made for the people who keep hospitals moving.',
  signal: 'CONNECTED OPERATIONS',
  signalTitle: 'Every action has a next step.',
  signalLabels: [
    'Hospital workspace',
    'Reception',
    'Patient queue',
    'Beds & emergency',
    'Lab & pharmacy',
    'Administration',
  ],
  illustrative: 'Illustrative platform view · no live hospital data',
  strip: ['One connected platform', 'Hospital-specific workspaces', 'Bangla & English'],
  introLabel: 'THE PLATFORM',
  introTitle: 'Care is a journey.\nOperations should connect.',
  intro:
    'MedLiveBD is a healthcare technology platform for Bangladesh. It connects a patient-facing app with hospital staff consoles, so the front desk, care teams and administration can work with the same operational context.',
  introSmall: 'A private workspace for each hospital. A clearer experience for the patient.',
  flowLabel: 'START WITH THE EVERYDAY',
  flowTitle: 'One next.\nA connected day.',
  flowBody:
    'At the centre is the live chamber queue. When reception calls the next serial, the patient’s queue view updates. The same platform brings visibility to the work around that moment.',
  featureLabel: 'Explore a workflow',
  features: [
    {
      label: 'Patient & queue',
      title: 'A serial with context.',
      body: 'Patients can discover participating hospitals, find doctors, book a serial and follow the chamber queue. Reception manages the working queue, including pauses and delays.',
      stages: ['Book a serial', 'Follow the queue', 'Called by reception'],
      detail:
        'A queue view carries its update age. Connection loss or old information is made visible.',
      note: 'FR-PAT-16–19 · FR-QUE · FR-PAT-39',
    },
    {
      label: 'Beds & emergency',
      title: 'Capacity that teams can coordinate.',
      body: 'Ward teams manage bed states. Emergency teams handle inbound alerts, triage and referrals, with published capacity and capability information for discovery.',
      stages: ['Ward updates', 'Published capacity', 'Emergency coordination'],
      detail:
        'Availability comes from recorded hospital updates; old information is labelled with its age.',
      note: 'FR-BED-01/05/06 · FR-EMG-01/07',
    },
    {
      label: 'Lab & pharmacy',
      title: 'See where the next task stands.',
      body: 'Laboratory teams follow doctor-ordered tests through collection, processing and report delivery. Pharmacy teams publish and reconfirm medicine availability.',
      stages: ['Team update', 'Workflow visibility', 'Patient information'],
      detail:
        'Pharmacy visibility covers medicine availability. Prescription QR dispensing is outside the current version.',
      note: 'FR-LAB-01–04 · FR-PHR-02',
    },
    {
      label: 'Hospital dashboards',
      title: 'The working day, in view.',
      body: 'Administration can see chamber activity and recorded operational counts, explore reports and manage hospital settings, staff and desks.',
      stages: ['Recorded activity', 'Operational overview', 'Reports & follow-up'],
      detail:
        'Operational summaries reflect recorded activity, rather than an assumed picture of corridor occupancy.',
      note: 'FR-ADM-01/10/11/12',
    },
  ],
  example: 'ILLUSTRATIVE WORKFLOW',
  exampleCaption: 'An operational view, without patient information.',
  hospitalLabel: 'FOR YOUR HOSPITAL',
  hospitalTitle: 'Your hospital.\nConnected, on its terms.',
  hospitalBody:
    'Start with how your teams already work. Configure the hospital workspace, bring in checked setup data, and demonstrate the relevant workflows together.',
  steps: [
    {
      title: 'Set the context',
      body: 'Configure departments, doctors, chambers, staff roles and desks for the hospital.',
    },
    {
      title: 'Bring the teams together',
      body: 'Enable the relevant modules. Use checked imports with preview and approval for supported data.',
    },
    {
      title: 'Rehearse the working day',
      body: 'Walk through patient and staff workflows with demonstration data before any real deployment.',
    },
  ],
  advantagesLabel: 'BUILT AROUND REAL OPERATIONS',
  advantagesTitle: 'Clarity for the desk.\nContext for the hospital.',
  advantages: [
    {
      title: 'Patient-facing clarity',
      body: 'Make the serial, chamber status and freshness of available information visible to patients.',
    },
    {
      title: 'A shared operational context',
      body: 'Connect reception, wards, emergency, laboratory, pharmacy and administration through role-specific workspaces.',
    },
    {
      title: 'A considered starting point',
      body: 'Hospital setup and validated imports support onboarding. Connections to existing hospital systems are arranged separately; no automatic HMS integration is assumed.',
    },
  ],
  aboutLabel: 'ABOUT MEDLIVEBD',
  aboutTitle: 'Technology for the spaces\nbetween care.',
  aboutBody:
    'A patient waiting for a call. A receptionist managing a chamber. A ward team updating a bed. MedLiveBD focuses on the operational connections between those moments, for hospitals and patients in Bangladesh.',
  aboutFoot: 'Care today. Healthy tomorrow.',
  contactLabel: 'LET’S TALK',
  contactTitle: 'See your working day\nin a new light.',
  contactBody:
    'Tell us about your hospital and the workflows you would like to explore. We’ll arrange a demonstration of MedLiveBD.',
  emailLabel: 'Email the MedLiveBD team',
  contactNote:
    'Demonstrations use synthetic data. Hospital deployment, provider connections and commercial terms are discussed directly.',
  footer: 'Healthcare technology for Bangladesh.',
  backTop: 'Back to top',
  copyright: 'MedLiveBD',
};

const bn: typeof en = {
  title: 'MedLiveBD — হাসপাতালের কাজ, এক সংযোগে',
  description:
    'বাংলাদেশের জন্য স্বাস্থ্যসেবা প্রযুক্তি। রোগীর সিরিয়াল, হাসপাতালের কার্যক্রম, শয্যা সমন্বয় ও ড্যাশবোর্ডকে যুক্ত করে MedLiveBD। ডেমোর জন্য যোগাযোগ করুন।',
  skip: 'মূল বিষয়বস্তুতে যান',
  menu: 'মেনু',
  close: 'মেনু বন্ধ করুন',
  language: 'ভাষা',
  nav: ['প্ল্যাটফর্ম', 'হাসপাতালের জন্য', 'আমাদের সম্পর্কে', 'যোগাযোগ'],
  demo: 'ডেমোর জন্য যোগাযোগ',
  explore: 'প্ল্যাটফর্ম দেখুন',
  eyebrow: 'স্বাস্থ্যসেবা প্রযুক্তি · বাংলাদেশ',
  hero: ['হাসপাতালের কাজ,', 'আরও স্পষ্ট।', 'এক সংযোগে।'],
  lead: 'রোগীর যাত্রা ও হাসপাতালের প্রতিদিনের কাজকে দেখুন একই ছবিতে। প্রথম সিরিয়াল থেকে পরবর্তী খালি শয্যা পর্যন্ত।',
  heroFoot: 'যাঁরা হাসপাতালের কাজ সচল রাখেন, তাঁদের জন্য।',
  signal: 'সংযুক্ত কার্যক্রম',
  signalTitle: 'প্রতিটি কাজের সঙ্গে পরের ধাপ।',
  signalLabels: [
    'হাসপাতালের কর্মক্ষেত্র',
    'রিসেপশন',
    'রোগীর সিরিয়াল',
    'শয্যা ও জরুরি বিভাগ',
    'ল্যাব ও ফার্মেসি',
    'প্রশাসন',
  ],
  illustrative: 'প্ল্যাটফর্মের ধারণাচিত্র · সরাসরি হাসপাতালের তথ্য নয়',
  strip: ['একটি সংযুক্ত প্ল্যাটফর্ম', 'প্রতি হাসপাতালের নিজস্ব কর্মক্ষেত্র', 'বাংলা ও ইংরেজি'],
  introLabel: 'প্ল্যাটফর্ম',
  introTitle: 'সেবার প্রতিটি ধাপ।\nকাজের প্রতিটি সংযোগ।',
  intro:
    'MedLiveBD বাংলাদেশের জন্য একটি স্বাস্থ্যসেবা প্রযুক্তি প্ল্যাটফর্ম। রোগীর অ্যাপ ও হাসপাতালের কর্মীদের কনসোলকে যুক্ত করে এটি—যাতে রিসেপশন, সেবাদানকারী দল ও প্রশাসন একই কার্যক্রমের প্রেক্ষাপট নিয়ে কাজ করতে পারে।',
  introSmall: 'হাসপাতালের নিজস্ব কর্মক্ষেত্র। রোগীর জন্য আরও স্পষ্ট অভিজ্ঞতা।',
  flowLabel: 'প্রতিদিনের কাজ থেকে শুরু',
  flowTitle: 'পরের সিরিয়াল।\nসংযুক্ত পুরো দিন।',
  flowBody:
    'প্ল্যাটফর্মের কেন্দ্রে রয়েছে চেম্বারের সরাসরি সিরিয়াল। রিসেপশন পরের সিরিয়াল ডাকলে রোগীর অ্যাপে সিরিয়ালের অবস্থা বদলে যায়। এই মুহূর্তের আশপাশের কাজও দৃশ্যমান করে একই প্ল্যাটফর্ম।',
  featureLabel: 'একটি কাজের ধাপ দেখুন',
  features: [
    {
      label: 'রোগী ও সিরিয়াল',
      title: 'সিরিয়ালের সঙ্গে প্রয়োজনীয় তথ্য।',
      body: 'রোগী অংশগ্রহণকারী হাসপাতাল ও চিকিৎসক খুঁজতে, সিরিয়াল নিতে এবং চেম্বারের সিরিয়াল অনুসরণ করতে পারেন। বিরতি ও বিলম্বসহ চলমান সিরিয়াল পরিচালনা করে রিসেপশন।',
      stages: ['সিরিয়াল নেওয়া', 'সিরিয়াল অনুসরণ', 'রিসেপশনের ডাক'],
      detail:
        'সিরিয়ালের তথ্য কত পুরোনো তা দেখানো হয়। সংযোগ বিচ্ছিন্ন হলে বা তথ্য পুরোনো হলে তা স্পষ্টভাবে জানানো হয়।',
      note: 'FR-PAT-16–19 · FR-QUE · FR-PAT-39',
    },
    {
      label: 'শয্যা ও জরুরি বিভাগ',
      title: 'সক্ষমতা জানা, সমন্বয় করা।',
      body: 'ওয়ার্ডের কর্মীরা শয্যার অবস্থা পরিচালনা করেন। জরুরি বিভাগের দল আগমনবার্তা, ট্রায়াজ ও রেফারাল সামলায়। প্রকাশিত শয্যা ও সেবার সক্ষমতা খুঁজে দেখা যায়।',
      stages: ['ওয়ার্ডের হালনাগাদ', 'প্রকাশিত সক্ষমতা', 'জরুরি সমন্বয়'],
      detail:
        'প্রাপ্যতার তথ্য আসে হাসপাতালের নথিভুক্ত হালনাগাদ থেকে। পুরোনো তথ্যের বয়স দেখানো হয়।',
      note: 'FR-BED-01/05/06 · FR-EMG-01/07',
    },
    {
      label: 'ল্যাব ও ফার্মেসি',
      title: 'পরের কাজের অবস্থা দেখুন।',
      body: 'চিকিৎসকের দেওয়া পরীক্ষার নির্দেশ থেকে নমুনা সংগ্রহ, প্রক্রিয়াকরণ ও রিপোর্ট পৌঁছানো পর্যন্ত ধাপ অনুসরণ করে ল্যাব। ফার্মেসি ওষুধের প্রাপ্যতা প্রকাশ ও পুনরায় নিশ্চিত করে।',
      stages: ['দলের হালনাগাদ', 'কাজের দৃশ্যমানতা', 'রোগীর জন্য তথ্য'],
      detail:
        'ফার্মেসিতে ওষুধের প্রাপ্যতা দেখা যায়। প্রেসক্রিপশনের QR দিয়ে ওষুধ বিতরণ বর্তমান সংস্করণের আওতায় নেই।',
      note: 'FR-LAB-01–04 · FR-PHR-02',
    },
    {
      label: 'হাসপাতালের ড্যাশবোর্ড',
      title: 'দিনের কাজ, এক নজরে।',
      body: 'প্রশাসন চেম্বারের কার্যক্রম ও নথিভুক্ত পরিচালনাগত সংখ্যা দেখতে, রিপোর্ট বিশ্লেষণ করতে এবং হাসপাতালের সেটিংস, কর্মী ও ডেস্ক পরিচালনা করতে পারে।',
      stages: ['নথিভুক্ত কার্যক্রম', 'কাজের সারসংক্ষেপ', 'রিপোর্ট ও পরের পদক্ষেপ'],
      detail:
        'সারসংক্ষেপ নথিভুক্ত কার্যক্রম দেখায়। করিডরে কতজন আছেন তার অনুমানকে প্রকৃত সংখ্যা হিসেবে দেখায় না।',
      note: 'FR-ADM-01/10/11/12',
    },
  ],
  example: 'কাজের ধাপের ধারণাচিত্র',
  exampleCaption: 'কার্যক্রমের একটি দৃশ্য, রোগীর তথ্য ছাড়াই।',
  hospitalLabel: 'আপনার হাসপাতালের জন্য',
  hospitalTitle: 'আপনার হাসপাতাল।\nনিজস্ব নিয়মে, সংযুক্ত।',
  hospitalBody:
    'আপনার দল যেভাবে কাজ করে, সেখান থেকেই শুরু। হাসপাতালের কর্মক্ষেত্র সাজান, যাচাই করা প্রাথমিক তথ্য আনুন এবং প্রাসঙ্গিক কাজের ধাপগুলো একসঙ্গে দেখুন।',
  steps: [
    {
      title: 'কর্মক্ষেত্র সাজান',
      body: 'হাসপাতালের বিভাগ, চিকিৎসক, চেম্বার, কর্মীদের ভূমিকা ও ডেস্ক নির্ধারণ করুন।',
    },
    {
      title: 'দলগুলোকে যুক্ত করুন',
      body: 'প্রয়োজনীয় মডিউল চালু করুন। সমর্থিত তথ্যের জন্য যাচাই, প্রিভিউ ও অনুমোদনসহ ইমপোর্ট ব্যবহার করুন।',
    },
    {
      title: 'দিনের কাজের মহড়া দিন',
      body: 'প্রকৃত ব্যবহারের আগে ডেমো তথ্য দিয়ে রোগী ও কর্মীদের কাজের ধাপগুলো দেখুন।',
    },
  ],
  advantagesLabel: 'হাসপাতালের বাস্তব কাজকে ঘিরে',
  advantagesTitle: 'ডেস্কে স্পষ্টতা।\nহাসপাতালে কাজের প্রেক্ষাপট।',
  advantages: [
    {
      title: 'রোগীর জন্য স্পষ্ট তথ্য',
      body: 'রোগীকে সিরিয়াল, চেম্বারের অবস্থা ও পাওয়া তথ্যের বয়স দেখান।',
    },
    {
      title: 'কাজের একই প্রেক্ষাপট',
      body: 'ভূমিকা অনুযায়ী কর্মক্ষেত্রের মাধ্যমে রিসেপশন, ওয়ার্ড, জরুরি বিভাগ, ল্যাব, ফার্মেসি ও প্রশাসনকে যুক্ত করুন।',
    },
    {
      title: 'ভেবে নেওয়া শুরু',
      body: 'হাসপাতাল সেটআপ ও যাচাই করা ইমপোর্ট কাজ শুরু করতে সহায়তা করে। বর্তমান হাসপাতাল সফটওয়্যারের সঙ্গে সংযোগ আলাদাভাবে ঠিক করা হয়; স্বয়ংক্রিয় HMS সংযোগ ধরে নেওয়া হয় না।',
    },
  ],
  aboutLabel: 'MEDLIVEBD সম্পর্কে',
  aboutTitle: 'সেবার মাঝের\nসংযোগের জন্য প্রযুক্তি।',
  aboutBody:
    'ডাকের অপেক্ষায় একজন রোগী। চেম্বার সামলানো একজন রিসেপশন কর্মী। শয্যার অবস্থা বদলানো ওয়ার্ডের দল। বাংলাদেশের হাসপাতাল ও রোগীদের জন্য এই মুহূর্তগুলোর কার্যক্রমকে যুক্ত করাই MedLiveBD-এর লক্ষ্য।',
  aboutFoot: 'আজকের যত্ন। আগামী দিনের সুস্থতা।',
  contactLabel: 'কথা বলুন',
  contactTitle: 'আপনার দিনের কাজ\nনতুনভাবে দেখুন।',
  contactBody:
    'আপনার হাসপাতাল ও যে কাজের ধাপগুলো দেখতে চান সে সম্পর্কে জানান। আমরা MedLiveBD-এর একটি ডেমোর ব্যবস্থা করব।',
  emailLabel: 'MedLiveBD দলকে ইমেইল করুন',
  contactNote:
    'ডেমোতে কৃত্রিম তথ্য ব্যবহার করা হয়। হাসপাতালের ব্যবহার, সেবাদাতা সংযোগ ও বাণিজ্যিক শর্ত সরাসরি আলোচনা করা হয়।',
  footer: 'বাংলাদেশের জন্য স্বাস্থ্যসেবা প্রযুক্তি।',
  backTop: 'ওপরে ফিরে যান',
  copyright: 'MedLiveBD',
};

export const copy = { bn, en };
