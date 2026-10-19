/** Approved Ward/ER copy, scoped to these workspaces (GR-06, FR-BED-07, FR-EMG-08). */
export const WARD_WORKSPACE = {
  title: { bn: 'ওয়ার্ড ও বেড', en: 'Ward and beds' },
  board: { bn: 'বেড বোর্ড', en: 'Bed board' },
  waiting: { bn: 'ভর্তির অপেক্ষায়', en: 'Waiting' },
  description: {
    bn: 'বেডের অবস্থা ও করা যায় এমন কাজ দেখতে বেডে চাপুন।',
    en: 'Tap a bed to see its state and what can be done.',
  },
  attention: { bn: 'খেয়াল করুন', en: 'Needs attention' },
  openBed: { bn: 'বেড খুলুন', en: 'Open bed' },
  emptyFilter: {
    bn: 'এই ওয়ার্ডে এই অবস্থার কোনো বেড নেই। অন্য অবস্থা বা সব ওয়ার্ড দেখুন।',
    en: 'No beds in this state in the selected ward. Choose another state or all wards.',
  },
  allStates: { bn: 'সব অবস্থা', en: 'All states' },
  review: { bn: 'ভর্তির তথ্য যাচাই করুন', en: 'Review admission' },
  reviewHint: {
    bn: 'রোগী ও বেড মিলিয়ে তারপর নিশ্চিত করুন। সার্ভারে নিশ্চিত হলে ভর্তি সম্পন্ন হবে।',
    en: 'Check the patient and bed before confirming. Admission completes when confirmed by the server.',
  },
  confirmAdmission: { bn: 'হ্যাঁ, ভর্তি করুন', en: 'Yes, admit' },
  helpStates: {
    bn: 'বেডে চাপুন। শুধু বর্তমান অবস্থায় করা যায় এমন কাজ দেখাবে। ছাড়পত্র বা স্থানান্তরের পর পুরোনো বেড পরিষ্কার করতে হবে।',
    en: 'Open a bed for its allowed actions. Discharge and transfer send the old bed for cleaning; mark it cleaned when complete.',
  },
  helpWaiting: {
    bn: 'ইআর রোগীর জন্য বেড নিজে বেছে নিন। নাম ও ফোন ওয়ার্ডে নিন। ইআর থেকে পাঠানো মানে বেড সংরক্ষিত নয়; ওয়ার্ডের “বেড নেই” উত্তর এই সংস্করণে নেই।',
    en: 'Choose the bed for an ER case explicitly, then take name and phone at the ward. A handoff does not reserve a bed. This version has no ward “no bed” reply.',
  },
  helpOffline: {
    bn: 'অফলাইনে বেডের পরিবর্তন ক্রমে রাখা হয়। রোগীর নাম ও অপেক্ষার অনুরোধ দেখতে সংযোগ দরকার। অ্যাপের অনুরোধে বেড রাখতে সংযোগ দরকার।',
    en: 'Offline bed changes are kept in order. Patient names, waiting requests and responding to app requests need a connection.',
  },
  helpMirror: {
    bn: 'অ্যাপের সংখ্যার সময় ও বোর্ডের সঙ্গে পার্থক্য দেখুন। আগামীকালের হিসাব সম্ভাব্য, শুধু কর্মীদের জন্য।',
    en: 'Check the age and any mismatch in public capacity. Tomorrow’s figure is a staff-only forecast.',
  },
};

export const ER_WORKSPACE = {
  soundUnavailable: {
    bn: 'এই ব্রাউজারে সতর্কতার শব্দ চালু করা যাচ্ছে না। নতুন সতর্কতার জন্য পর্দার দিকে খেয়াল রাখুন।',
    en: 'Alert sound is unavailable in this browser. Watch the screen for new alerts.',
  },
  title: { bn: 'জরুরি বিভাগ', en: 'Emergency department' },
  overview: { bn: 'জরুরি বিভাগ', en: 'Emergency' },
  description: {
    bn: 'আসছেন, জরুরি বিভাগে আছেন ও রেফারেলের খবর—এক জায়গায়।',
    en: 'On the way, in the ER and referral updates in one place.',
  },
  red: { bn: 'লাল', en: 'Red' },
  sort: {
    bn: 'লাল → ট্রায়াজ হয়নি → হলুদ → সবুজ। প্রতিটি দলে সবচেয়ে আগে আসা রোগী আগে।',
    en: 'Red → not triaged → yellow → green. Longest waiting first within each group.',
  },
  handoff: {
    bn: 'ওয়ার্ডে পাঠানো মানে বেড সংরক্ষিত নয়। ওয়ার্ড ভর্তি করলে রোগী এই তালিকা থেকে চলে যাবেন।',
    en: 'Sending to the ward does not hold a bed. The case leaves this list when the ward admits them.',
  },
  confirmArrival: { bn: 'রোগী এসে পৌঁছেছেন—নিশ্চিত করুন', en: 'Confirm the patient has arrived' },
  arrivalHint: {
    bn: 'এখানে নতুন ইআর টোকেন হবে এবং পাঠানো হাসপাতালের কেস বন্ধ হবে। গ্রহণ করা আর এসে পৌঁছানো এক নয়।',
    en: 'Arrival creates an ER token here and closes the sending hospital’s case. Acceptance and arrival are separate steps.',
  },
  helpTriage: {
    bn: 'ট্রায়াজ কর্মীর সিদ্ধান্ত। রঙের সঙ্গে আকার ও লেখা আছে; হাসপাতালের রঙ বদলালেও বদলায় না। কোনো চিকিৎসা বা ট্রায়াজ পরামর্শ দেওয়া হয় না।',
    en: 'Staff decide triage. Colour, shape and text stay fixed across hospital brands. No triage or treatment is suggested.',
  },
  helpReferrals: {
    bn: 'প্রয়োজনীয় সক্ষমতা ও বেড দিয়ে হাসপাতাল খুঁজুন। তথ্যের বয়স দেখুন। গ্রহণের পরও রোগী পাঠানো হাসপাতালে থাকেন; এসে পৌঁছানো নিশ্চিত হলে কেস সরে।',
    en: 'Search by required capability and bed; check the age of each figure. Acceptance keeps the patient at the sending hospital until arrival is confirmed.',
  },
  helpPrivacy: {
    bn: 'তালিকায় নাম থাকে না। ফোন দেখতে চাপলে সেই দেখা নথিভুক্ত হয়। রেফারেলে নাম বা ফোন পাঠানো হয় না।',
    en: 'Lists contain no names. Opening a phone number records the view. Referrals send no name or phone.',
  },
  helpOffline: {
    bn: 'অফলাইনে কাজ ক্রমে রাখা হয়। নতুন সতর্কতা বা রেফারেল আসবে না; অন্য হাসপাতাল খুঁজতে সংযোগ দরকার। শব্দ চালু করতে ব্রাউজারে একবার চাপতে হতে পারে।',
    en: 'Offline actions are kept in order. New alerts and referrals cannot arrive; hospital search needs a connection. Browser sound may need one tap to enable.',
  },
};
