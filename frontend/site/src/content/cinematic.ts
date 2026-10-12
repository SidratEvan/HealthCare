/** Public company narrative, S-C-01/02/04/05, GR-06, FR-SEC-08. */

/** A title and its one-line explanation. */
type Point = readonly [title: string, body: string];

const en = {
  lead: 'One platform for hospital teams and the patients they serve — live queues, beds and records, in Bangla and English.',
  explore: 'Explore MedLiveBD',
  chapter: 'The pulse of connected care',
  scroll: 'Scroll',
  connection: 'Care happens between people.',
  connectionAccent: 'The information should stay connected.',
  connectionNote: 'One shared purpose. From the hospital to the person waiting for care.',
  experiences: 'Two experiences. One ecosystem.',
  hub: 'MedLiveBD',
  hospital: 'For hospitals',
  patient: 'For patients',
  hospitalTitle: 'Better connected teams.\nA clearer view of care.',
  patientTitle: 'Your healthcare journey,\nmade clearer.',
  /** What a hospital gets, point by point (owner, 12 October 2026: "only important point-to-point features"). */
  hospitalFeatures: [
    [
      'Live queue and serials',
      'Reception calls the next patient, and everyone waiting sees it on their phone.',
    ],
    ['Beds and emergency at a glance', 'Ward, ICU and emergency capacity in one shared view.'],
    [
      'Every role, one platform',
      'Reception, doctors, wards, lab and administration — in Bangla and English.',
    ],
  ] as readonly Point[],
  patientFeatures: [
    ['Find the right care', 'Search doctors, specialties and hospitals.'],
    ['Book a serial', 'Choose a doctor and a time, from the phone you already carry.'],
    ['Follow your serial live', 'See how many are ahead of you, and when it is your turn.'],
  ] as readonly Point[],
  comingSoon: 'Patient app coming soon',
  patientStatus: 'Public booking is not open yet.',
  mapLabel: 'Our Bangladesh vision',
  mapTitle: 'Built for Bangladesh.',
  mapAccent: 'Designed to connect\nwhat matters.',
  mapBody:
    'From a single hospital to every division. Technology shaped around our people, our language and the way care happens here.',
  mapNote: 'A vision of connectivity — not current hospital coverage.',
  mapAlt:
    'Accurate outline of Bangladesh and its eight divisions. Lines from Dhaka to each division headquarters illustrate an ambition, not active facilities or measured coverage.',
  mapCredit: 'Country and division geometry: geoBoundaries · CC0',
  trustLabel: 'Trust is part of the connection',
  trustTitle: 'Designed with responsibility.',
  trust: [
    ['Privacy in mind', 'Hospital workspaces and consent guide how information is shared.'],
    ['Clarity over certainty', 'Information shows how recent it is. Missing data stays honest.'],
    [
      'People at the centre',
      'Technology supports coordination. Clinical decisions belong to people.',
    ],
  ] as readonly Point[],
  contactTitle: 'Let’s build more\nconnected care, together.',
  contactBody: 'See what connected care could look like for your hospital.',
  emailHint: 'Opens your email app',
  foundersLink: 'Meet the founders',
  synthetic: 'AI-generated illustrative scenes. Not actual staff, patients or partner hospitals.',
  heroAlt:
    'Illustrative Bangladeshi male physician and female physician wearing hijab collaborating in a hospital.',
  teamAlt:
    'Illustrative Bangladeshi hospital team: two male doctors and a female doctor wearing hijab working together.',
  patientAlt:
    'Illustrative Bangladeshi father and adult son looking at a phone in a hospital waiting area.',
  atmosphereAlt:
    'Illustrative Dhaka-inspired neighborhood at blue hour, with warm lights among the rooftops.',
  assetsTitle: 'Original campaign imagery',
  assetsIntro:
    'These scenes were generated with OpenAI image generation for this website on 12 October 2026. The people and settings are synthetic illustrations, not photographs of MedLiveBD staff, customers or hospitals. They do not imply endorsement or actual coverage.',
  assetNames: [
    'Connected clinicians',
    'Hospital teamwork',
    'A clearer patient journey',
    'Dhaka-inspired evening',
  ],
};

type CinematicCopy = typeof en;
const bn: CinematicCopy = {
  lead: 'হাসপাতালের দল আর তাদের সেবা নেওয়া রোগীদের জন্য একটি প্ল্যাটফর্ম — লাইভ সিরিয়াল, শয্যা ও রেকর্ড, বাংলা ও ইংরেজিতে।',
  explore: 'MedLiveBD সম্পর্কে জানুন',
  chapter: 'সংযুক্ত স্বাস্থ্যসেবার স্পন্দন',
  scroll: 'নিচে দেখুন',
  connection: 'স্বাস্থ্যসেবার কেন্দ্রে মানুষ।',
  connectionAccent: 'তথ্যও থাকুক সংযুক্ত।',
  connectionNote: 'একই লক্ষ্য। হাসপাতাল থেকে সেবার অপেক্ষায় থাকা মানুষ পর্যন্ত।',
  experiences: 'দুই অভিজ্ঞতা। এক ইকোসিস্টেম।',
  hub: 'MedLiveBD',
  hospital: 'হাসপাতালের জন্য',
  patient: 'রোগীর জন্য',
  hospitalTitle: 'সংযুক্ত দল।\nসেবার আরও পরিষ্কার চিত্র।',
  patientTitle: 'আপনার স্বাস্থ্যসেবার যাত্রা\nহোক আরও সহজ।',
  hospitalFeatures: [
    ['লাইভ কিউ ও সিরিয়াল', 'রিসেপশন পরের রোগীকে ডাকলেই অপেক্ষায় থাকা সবাই ফোনে দেখতে পান।'],
    ['শয্যা ও জরুরি বিভাগ এক নজরে', 'ওয়ার্ড, আইসিইউ ও জরুরি বিভাগের সক্ষমতা একটি সমন্বিত চিত্রে।'],
    [
      'প্রতিটি ভূমিকা, একটি প্ল্যাটফর্ম',
      'রিসেপশন, চিকিৎসক, ওয়ার্ড, ল্যাব ও প্রশাসন — বাংলা ও ইংরেজিতে।',
    ],
  ],
  patientFeatures: [
    ['সঠিক সেবা খুঁজুন', 'চিকিৎসক, বিশেষজ্ঞতা ও হাসপাতাল খুঁজে নিন।'],
    ['সিরিয়াল বুক করুন', 'চিকিৎসক ও সময় বেছে নিন, নিজের ফোন থেকেই।'],
    ['লাইভ সিরিয়াল দেখুন', 'আপনার আগে কতজন আছেন আর কখন আপনার পালা, জেনে নিন।'],
  ],
  comingSoon: 'রোগীদের অ্যাপ শিগগিরই আসছে',
  patientStatus: 'জনসাধারণের বুকিং এখনো চালু হয়নি।',
  mapLabel: 'বাংলাদেশকে ঘিরে আমাদের লক্ষ্য',
  mapTitle: 'বাংলাদেশের জন্য।',
  mapAccent: 'জরুরি সংযোগগুলো\nগড়ে তোলার লক্ষ্যে।',
  mapBody:
    'একটি হাসপাতাল থেকে প্রতিটি বিভাগ পর্যন্ত। আমাদের মানুষ, ভাষা আর সেবার বাস্তবতার সঙ্গে মানানসই প্রযুক্তি।',
  mapNote: 'সংযোগের ভবিষ্যৎ ভাবনা — বর্তমান হাসপাতাল কভারেজ নয়।',
  mapAlt:
    'বাংলাদেশ ও এর আটটি বিভাগের নির্ভুল সীমানা। ঢাকা থেকে প্রতিটি বিভাগীয় সদরের দিকে রেখাগুলো সংযোগের ভবিষ্যৎ ভাবনা বোঝায়, চালু হাসপাতাল বা বর্তমান কভারেজ নয়।',
  mapCredit: 'দেশ ও বিভাগের সীমানা: geoBoundaries · CC0',
  trustLabel: 'সংযোগের সঙ্গে আস্থা',
  trustTitle: 'দায়িত্বশীল নকশা।',
  trust: [
    ['গোপনীয়তার গুরুত্ব', 'হাসপাতালের নিজস্ব কর্মক্ষেত্র ও সম্মতির ভিত্তিতে তথ্য ভাগ করার নকশা।'],
    ['তথ্যের স্বচ্ছতা', 'তথ্য কতটা হালনাগাদ তা দেখানো হয়। অনুপস্থিত তথ্য অনুমান করা হয় না।'],
    ['সিদ্ধান্তের কেন্দ্রে মানুষ', 'প্রযুক্তি সমন্বয়ে সহায়তা করে। চিকিৎসার সিদ্ধান্ত নেন মানুষ।'],
  ],
  contactTitle: 'আরও সংযুক্ত স্বাস্থ্যসেবা\nগড়ি, একসঙ্গে।',
  contactBody: 'আপনার হাসপাতালের জন্য সংযুক্ত সেবার সম্ভাবনা দেখুন।',
  emailHint: 'আপনার ইমেইল অ্যাপ খুলবে',
  foundersLink: 'প্রতিষ্ঠাতাদের সঙ্গে পরিচিত হোন',
  synthetic: 'দৃশ্যগুলো এআই দিয়ে তৈরি দৃষ্টান্ত। প্রকৃত কর্মী, রোগী বা সহযোগী হাসপাতাল নয়।',
  heroAlt:
    'দৃষ্টান্তমূলক বাংলাদেশি পুরুষ চিকিৎসক ও হিজাব পরা নারী চিকিৎসক হাসপাতালে একসঙ্গে কাজ করছেন।',
  teamAlt:
    'দৃষ্টান্তমূলক হাসপাতালের দল: দুই পুরুষ চিকিৎসক ও হিজাব পরা এক নারী চিকিৎসক একসঙ্গে কাজ করছেন।',
  patientAlt:
    'দৃষ্টান্তমূলক বাংলাদেশি বাবা ও প্রাপ্তবয়স্ক ছেলে হাসপাতালের অপেক্ষার স্থানে ফোন দেখছেন।',
  atmosphereAlt: 'সন্ধ্যার আলোয় ঢাকাকে ঘিরে কল্পিত দৃশ্য, ছাদের সারিতে ঘরের উষ্ণ আলো।',
  assetsTitle: 'এই সাইটের জন্য তৈরি ছবি',
  assetsIntro:
    '২০২৬ সালের ১২ অক্টোবর OpenAI-এর ইমেজ জেনারেশন দিয়ে এই সাইটের জন্য দৃশ্যগুলো তৈরি করা হয়েছে। মানুষ ও পরিবেশগুলো কৃত্রিম দৃষ্টান্ত, MedLiveBD-এর প্রকৃত কর্মী, গ্রাহক বা হাসপাতালের ছবি নয়। এগুলো কোনো সমর্থন বা বর্তমান কভারেজ বোঝায় না।',
  assetNames: ['চিকিৎসকদের সংযোগ', 'হাসপাতালের দল', 'রোগীর সহজতর যাত্রা', 'ঢাকাকে ঘিরে সন্ধ্যা'],
};
export const cinematic = { en, bn } as const;
