/**
 * The founders (S-C-01, S-C-05), owner, 12 October 2026: names, titles and how
 * to reach them — no story. Names are written as the founders write them.
 */
export interface Founder {
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly email: string;
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
    email: 'mayesha@medlivebd.com',
    phone: '+8801346078142',
    phoneDisplay: '+880 1346-078142',
  },
} as const;

const en = {
  label: 'Founders',
  heading: 'The people behind MedLiveBD.',
  founders: [
    { ...people.sidrat, title: 'Managing Partner & CEO' },
    { ...people.mayesha, title: 'Partner & COO' },
  ] as readonly Founder[],
  email: 'Email',
  phone: 'Phone',
  ctaTitle: 'Interested in working with MedLiveBD?',
};

const bn: typeof en = {
  label: 'প্রতিষ্ঠাতা',
  heading: 'MedLiveBD-এর পেছনের মানুষ।',
  founders: [
    { ...people.sidrat, title: 'ম্যানেজিং পার্টনার ও সিইও' },
    { ...people.mayesha, title: 'পার্টনার ও সিওও' },
  ],
  email: 'ইমেইল',
  phone: 'ফোন',
  ctaTitle: 'MedLiveBD-এর সঙ্গে কাজ করতে আগ্রহী?',
};

export const founders = { en, bn } as const;
