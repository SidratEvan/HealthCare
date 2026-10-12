/**
 * The about page and the homepage's people (S-C-01), in the owner's words of
 * 12 October 2026. Names are written as the founders write them, in both
 * languages. A personal address is shown only once it is confirmed active
 * (owner, 12 October 2026): Mayesha's is not yet, so she is reached through
 * the company address.
 */
export interface Founder {
  readonly key: string;
  readonly name: string;
  /** The short title the homepage shows. */
  readonly short: string;
  readonly role: string;
  readonly focus: string;
  readonly bio: readonly string[];
  readonly email?: string;
  /** E.164, for the tel: link. */
  readonly phone: string;
  readonly phoneDisplay: string;
}

const people = {
  sidrat: {
    key: 'sidrat',
    name: 'SK Sidratul Islam Priyo',
    email: 'sidrat@medlivebd.com',
    phone: '+8801352380467',
    phoneDisplay: '+880 1352-380467',
  },
  mayesha: {
    key: 'mayesha',
    name: 'Mayesha Farzana',
    phone: '+8801346078142',
    phoneDisplay: '+880 1346-078142',
  },
} as const;

/** Checks each founder against the shape the pages read, without narrowing it. */
const list = (founders: readonly Founder[]): readonly Founder[] => founders;

const en = {
  label: 'Meet our founders',
  heading: 'Driven by a shared vision for a more connected Bangladesh.',
  intro: [
    'MedLiveBD was founded on a simple belief: healthcare technology should make life easier for both the people providing care and the people seeking it.',
    'Combining technology leadership with on-the-ground operations in Bangladesh, our founders are working to build a healthcare ecosystem that connects hospitals, healthcare professionals, and patients.',
  ],
  founders: list([
    {
      ...people.sidrat,
      short: 'Managing Partner & CEO',
      role: 'Co-Founder · Managing Partner & Chief Executive Officer (CEO)',
      focus: 'Product Vision, Technology and Strategy',
      bio: [
        'Sidrat leads MedLiveBD’s technology development, product vision, and overall business strategy. Based in Canada, he brings a technology-driven approach to addressing the everyday operational challenges faced by healthcare institutions in Bangladesh.',
        'He is responsible for developing the MedLiveBD platform and shaping its long-term direction, with a focus on practical innovation, connected hospital operations, and better digital experiences for patients.',
      ],
    },
    {
      ...people.mayesha,
      short: 'Partner & COO',
      role: 'Co-Founder · Partner & Chief Operating Officer (COO)',
      focus: 'Operations, Hospital Relations and Implementation',
      bio: [
        'Mayesha leads MedLiveBD’s operations in Bangladesh, focusing on hospital engagement, institutional relationships, and implementation coordination.',
        'Her role connects the company’s technology vision with the practical needs of healthcare institutions. She focuses on understanding hospital operations, coordinating with healthcare stakeholders, and helping make MedLiveBD practical for hospital teams.',
      ],
    },
  ]),
  email: 'Email',
  phone: 'Phone',
  visionLabel: 'Our shared vision',
  visionTitle: 'Building technology that brings healthcare closer together.',
  visionBody:
    'Our ambition is to help create a Bangladesh where hospitals are better connected, healthcare professionals have clearer operational information, and patients can navigate their healthcare journeys with greater confidence.',
  visionClose: 'MedLiveBD is our commitment to building toward that future.',
  ctaTitle: 'Interested in working with MedLiveBD?',
  ctaBody: 'Write to us to discuss a partnership or request a demonstration.',
};

const bn: typeof en = {
  label: 'আমাদের প্রতিষ্ঠাতা',
  heading: 'আরও সংযুক্ত বাংলাদেশের অভিন্ন স্বপ্নে অনুপ্রাণিত।',
  intro: [
    'MedLiveBD প্রতিষ্ঠিত হয়েছে একটি সহজ বিশ্বাস থেকে: স্বাস্থ্যসেবা প্রযুক্তি সেবা দেওয়া মানুষ আর সেবা নেওয়া মানুষ — দুজনের জীবনই সহজ করবে।',
    'প্রযুক্তির নেতৃত্ব আর বাংলাদেশে মাঠপর্যায়ের পরিচালনাকে একসঙ্গে এনে আমাদের প্রতিষ্ঠাতারা এমন একটি স্বাস্থ্যসেবা ইকোসিস্টেম গড়ে তুলছেন, যা হাসপাতাল, স্বাস্থ্যকর্মী ও রোগীদের সংযুক্ত করে।',
  ],
  founders: list([
    {
      ...people.sidrat,
      short: 'ম্যানেজিং পার্টনার ও সিইও',
      role: 'সহ-প্রতিষ্ঠাতা · ম্যানেজিং পার্টনার ও প্রধান নির্বাহী কর্মকর্তা (সিইও)',
      focus: 'প্রযুক্তি, পণ্যের রূপকল্প ও কৌশল',
      bio: [
        'সিদরাত MedLiveBD-এর প্রযুক্তি উন্নয়ন, পণ্যের রূপকল্প ও সামগ্রিক ব্যবসায়িক কৌশলের নেতৃত্ব দেন। কানাডায় থেকে তিনি বাংলাদেশের স্বাস্থ্যসেবা প্রতিষ্ঠানগুলোর প্রতিদিনের পরিচালনাগত চ্যালেঞ্জ মোকাবিলায় প্রযুক্তিনির্ভর দৃষ্টিভঙ্গি নিয়ে আসেন।',
        'MedLiveBD প্ল্যাটফর্ম গড়ে তোলা ও এর দীর্ঘমেয়াদি দিকনির্দেশনা ঠিক করার দায়িত্ব তাঁর — বাস্তবসম্মত উদ্ভাবন, সংযুক্ত হাসপাতাল পরিচালনা আর রোগীদের জন্য আরও ভালো ডিজিটাল অভিজ্ঞতার ওপর জোর দিয়ে।',
      ],
    },
    {
      ...people.mayesha,
      short: 'পার্টনার ও সিওও',
      role: 'সহ-প্রতিষ্ঠাতা · পার্টনার ও প্রধান পরিচালন কর্মকর্তা (সিওও)',
      focus: 'পরিচালনা, হাসপাতাল সম্পর্ক ও বাস্তবায়ন',
      bio: [
        'মায়েশা বাংলাদেশে MedLiveBD-এর পরিচালনার নেতৃত্ব দেন — হাসপাতালের সঙ্গে যোগাযোগ, প্রাতিষ্ঠানিক সম্পর্ক ও বাস্তবায়নের সমন্বয়ে মনোযোগ দিয়ে।',
        'তাঁর ভূমিকা প্রতিষ্ঠানের প্রযুক্তিগত রূপকল্পকে স্বাস্থ্যসেবা প্রতিষ্ঠানের বাস্তব প্রয়োজনের সঙ্গে যুক্ত করে। হাসপাতালের কাজ বোঝা, স্বাস্থ্যসেবা-সংশ্লিষ্টদের সঙ্গে সমন্বয় আর হাসপাতালের দলের জন্য MedLiveBD-কে কার্যকর করে তোলায় তিনি মনোযোগ দেন।',
      ],
    },
  ]),
  email: 'ইমেইল',
  phone: 'ফোন',
  visionLabel: 'আমাদের অভিন্ন লক্ষ্য',
  visionTitle: 'এমন প্রযুক্তি, যা স্বাস্থ্যসেবাকে আরও কাছাকাছি আনে।',
  visionBody:
    'আমাদের লক্ষ্য এমন একটি বাংলাদেশ গড়তে সহায়তা করা, যেখানে হাসপাতালগুলো আরও সংযুক্ত, স্বাস্থ্যকর্মীদের হাতে থাকে পরিষ্কার পরিচালনাগত তথ্য, আর রোগীরা আরও আত্মবিশ্বাসের সঙ্গে নিজেদের স্বাস্থ্যসেবার পথ চলতে পারেন।',
  visionClose: 'সেই ভবিষ্যতের দিকে এগিয়ে যাওয়ার অঙ্গীকারই MedLiveBD।',
  ctaTitle: 'MedLiveBD-এর সঙ্গে কাজ করতে আগ্রহী?',
  ctaBody: 'অংশীদারত্ব নিয়ে আলোচনা বা ডেমোর অনুরোধ করতে আমাদের লিখুন।',
};

export const founders = { en, bn } as const;
