export const CLINICAL = {
  stockChanged: {
    bn: 'তথ্য অন্য কর্মী বদলেছেন। নতুন তালিকা দেখে আবার নিশ্চিত করুন।',
    en: 'Another staff member changed the stock. Review the reloaded list before confirming again.',
  },
  lab: { bn: 'ল্যাব — পরীক্ষার তালিকা', en: 'Lab — test queue' },
  pharmacy: { bn: 'ফার্মেসি — ওষুধের মজুত', en: 'Pharmacy — medicine stock' },
  labIntro: {
    bn: 'প্রথমে পুরোনো পরীক্ষা। প্রতিটি পরীক্ষায় পরের ধাপ দেখানো আছে।',
    en: 'Oldest test first. Each test shows its next step.',
  },
  pharmacyIntro: {
    bn: 'আপনি যা জানান, রোগীর অনুসন্ধানে তা-ই দেখা যায়। এটি পরিমাণের হিসাব নয়।',
    en: 'What you mark here is what patients searching see. Availability only.',
  },
  switchConsole: { bn: 'কনসোল বদলান', en: 'Switch console' },
  searchTests: { bn: 'পরীক্ষার নাম লিখুন, যেমন CBC', en: 'Type a test name, e.g. CBC' },
  searchMedicines: { bn: 'ওষুধের নাম লিখুন, যেমন Napa', en: 'Type a medicine name, e.g. Napa' },
  noMatches: {
    bn: 'এই অনুসন্ধানে কিছু পাওয়া যায়নি। ফিল্টার বা অনুসন্ধান বদলান।',
    en: 'No matches. Change the search or filter.',
  },
  sampleNeeded: { bn: 'নমুনা নিতে হবে', en: 'Sample needed' },
  collected: { bn: 'নমুনা নেওয়া হয়েছে', en: 'Sample collected' },
  processing: { bn: 'প্রসেসিং চলছে', en: 'Processing' },
  allStages: { bn: 'সব ধাপ', en: 'All stages' },
  reference: { bn: 'অর্ডার রেফারেন্স', en: 'Order reference' },
  byDoctor: { bn: 'চিকিৎসকের অর্ডার', en: 'Ordered by a doctor' },
  noDoctor: { bn: 'অর্ডারকারী চিকিৎসক নেই', en: 'No ordering doctor' },
  cancelTitle: { bn: 'পরীক্ষাটি বাতিল করবেন?', en: 'Cancel this test?' },
  cancelHint: {
    bn: 'এই পরীক্ষার কাজ থেমে যাবে। বাতিল অর্ডার সব তালিকায় থাকবে।',
    en: 'Work on this test will stop. The cancelled order remains under All.',
  },
  uploadTitle: { bn: 'রিপোর্ট জমা দিন', en: 'Submit the report' },
  uploadReview: {
    bn: 'অর্ডার রেফারেন্স, রোগী ও ফাইল মিলিয়ে নিন। জমা হলে রিপোর্ট রেকর্ডে পাওয়া যাবে; এটি এসএমএস পাওয়া বা পড়ার প্রমাণ নয়।',
    en: 'Match the order reference, patient and file. A committed report is available in records; this does not prove SMS receipt or reading.',
  },
  chooseFile: { bn: 'রিপোর্টের ফাইল বেছে নিন', en: 'Choose the report file' },
  fileHint: {
    bn: 'PDF, JPEG, PNG বা WebP; সর্বোচ্চ ১০ MiB।',
    en: 'PDF, JPEG, PNG or WebP; up to 10 MiB.',
  },
  fileEmpty: {
    bn: 'ফাইলটি খালি। অন্য ফাইল বেছে নিন।',
    en: 'The file is empty. Choose another file.',
  },
  back: { bn: 'ফিরে যান', en: 'Go back' },
  retryUpload: {
    bn: 'ফাইল রাখা আছে। অবস্থা যাচাই করে একই অর্ডারে আবার চেষ্টা করুন।',
    en: 'The selected file is kept. Check the order status and retry the same attempt.',
  },
  uploadUncertain: {
    bn: 'জমা হয়েছে কি না নিশ্চিত নয়। সার্ভারের অবস্থা যাচাই করা হচ্ছে।',
    en: 'The upload result is uncertain. Checking the server state.',
  },
  uploadOtherReport: {
    bn: 'এই অর্ডারে আগেই অন্য একটি রিপোর্ট জমা হয়েছে। আপনার ফাইলটি পাঠানো হয়নি। অর্ডারের রিপোর্ট দেখে মিলিয়ে নিন।',
    en: 'A different report was already delivered on this order. Your file was not sent. Check the order’s report.',
  },
  confirmTitle: { bn: 'পুরো তালিকা যাচাই করেছেন?', en: 'Checked the whole list?' },
  confirmHint: {
    bn: 'অনুসন্ধান বা ফিল্টারে লুকানো ওষুধসহ প্রতিটি চিহ্ন অপরিবর্তিত রেখে নতুন করে নিশ্চিত হবে। পুরোনো আছে চিহ্ন আবার রোগীর কাছে আছে হিসেবে দেখা যাবে। আগে তাক মিলিয়ে নিন।',
    en: 'Every flag, including medicines hidden by search or filters, will be renewed unchanged. Old in-stock claims become available again. Check the shelf first.',
  },
  bulkLimit: {
    bn: 'একবারে সর্বোচ্চ ২০০টি ওষুধ নিশ্চিত করা যায়। প্রতিটি সারি আলাদা যাচাই করুন।',
    en: 'One request supports up to 200 medicines. Check individual rows for this list.',
  },
  stockUncertain: {
    bn: 'পরিবর্তনের ফল নিশ্চিত নয়। তালিকা আবার পড়া হয়েছে; তাক মিলিয়ে আবার চেষ্টা করুন।',
    en: 'The update result is uncertain. The list has been read again; check the shelf before retrying.',
  },
  stillInStock: { bn: 'এখনো আছে', en: 'Still in stock' },
  patientAnswer: { bn: 'রোগীর অ্যাপে দেখা যায়', en: 'Patients see in the app' },
  stockHelp: {
    bn: 'তাক দেখে আছে বা নেই জানান। আছে চিহ্ন ১২ ঘণ্টা পর জানা নেই হয়; নেই চিহ্ন বদলানো পর্যন্ত থাকে। পুরো তালিকা নিশ্চিত করলে লুকানো সারিও নতুন হয়। মজুতের পরিমাণ বা ওষুধ বিতরণ এখানে নেই।',
    en: 'Check the shelf before marking in or out. In-stock becomes unknown at 12 hours; out-of-stock persists until changed. Whole-list confirmation includes hidden rows. There are no quantities or dispensing here.',
  },
  labHelp: {
    bn: 'নমুনা নেওয়া → প্রসেসিং → রিপোর্ট: ধাপ কেবল সামনে যায়। নাম দেখতে আলাদা অনলাইন অনুরোধ লাগে। রিপোর্টের অর্ডার ও রোগী মিলিয়ে ফাইল জমা দিন। রিপোর্ট বদলানো বা প্রত্যাহার এখানে নেই।',
    en: 'Sample collection → processing → report: stages only move forward. Patient names need a separate online request. Match the order and patient before submitting a file. Reports cannot be replaced or withdrawn here.',
  },
};
