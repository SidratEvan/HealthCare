/**
 * Names for what an import maps onto (`S-B-14`, `FR-IMP-13`–`18`).
 *
 * The template's columns are identifiers (`date_of_birth`, `fee_taka`). A
 * hospital administrator matching their own file to them reads a name, in
 * the language the screen is in; these are those names, with the kinds of
 * row a structure file can hold and the kinds of value a column can.
 */

import type { Locale, Message } from './messages.js';

/** Each template column, as a person reads it. */
export const IMPORT_FIELD_NAMES = {
  ref: { bn: 'আপনাদের নিজস্ব আইডি', en: 'Your own ID' },
  name_bn: { bn: 'নাম (বাংলা)', en: 'Name (Bangla)' },
  name_en: { bn: 'নাম (ইংরেজি)', en: 'Name (English)' },
  code: { bn: 'সংক্ষিপ্ত কোড', en: 'Short code' },
  bmdc_number: { bn: 'বিএমডিসি নম্বর', en: 'BMDC number' },
  degrees: { bn: 'ডিগ্রি', en: 'Degrees' },
  specialties: { bn: 'বিশেষত্ব', en: 'Specialties' },
  department_ref: { bn: 'বিভাগের আইডি', en: 'Department ID' },
  room: { bn: 'রুম', en: 'Room' },
  fee_taka: { bn: 'ফি (টাকা)', en: 'Fee (taka)' },
  doctor_ref: { bn: 'ডাক্তারের আইডি', en: 'Doctor ID' },
  weekday: { bn: 'বার', en: 'Weekday' },
  start: { bn: 'শুরুর সময়', en: 'Start time' },
  end: { bn: 'শেষের সময়', en: 'End time' },
  serials: { bn: 'দিনে সিরিয়াল সংখ্যা', en: 'Serials per day' },
  ward_ref: { bn: 'ওয়ার্ডের আইডি', en: 'Ward ID' },
  floor: { bn: 'তলা', en: 'Floor' },
  bed_kind: { bn: 'বেডের ধরন', en: 'Bed kind' },
  bed_label: { bn: 'বেড নম্বর', en: 'Bed number' },
  nightly_taka: { bn: 'প্রতি রাতের ভাড়া (টাকা)', en: 'Price per night (taka)' },
  role: { bn: 'ভূমিকা', en: 'Role' },
  email: { bn: 'ইমেইল', en: 'Email' },
  full_name: { bn: 'পুরো নাম', en: 'Full name' },
  date_of_birth: { bn: 'জন্ম তারিখ', en: 'Date of birth' },
  age_years: { bn: 'বয়স (বছর)', en: 'Age (years)' },
  sex: { bn: 'লিঙ্গ', en: 'Sex' },
  mobile: { bn: 'মোবাইল নম্বর', en: 'Mobile number' },
  blood_group: { bn: 'রক্তের গ্রুপ', en: 'Blood group' },
  patient_ref: { bn: 'রোগীর আইডি', en: 'Patient ID' },
  date: { bn: 'তারিখ', en: 'Date' },
  serial: { bn: 'সিরিয়াল নম্বর', en: 'Serial number' },
  paid: { bn: 'পরিশোধ হয়েছে কি না', en: 'Paid or not' },
} as const satisfies Record<string, Message>;

/** A template column's name; the identifier itself for one this list lacks. */
export function importFieldName(field: string, locale: Locale): string {
  return (IMPORT_FIELD_NAMES as Record<string, Message | undefined>)[field]?.[locale] ?? field;
}

/** What a structure file is a list of. */
export const STRUCTURE_TYPE_NAMES = {
  department: { bn: 'বিভাগ', en: 'Departments' },
  doctor: { bn: 'ডাক্তার', en: 'Doctors' },
  schedule: { bn: 'সাপ্তাহিক সময়সূচি', en: 'Weekly schedules' },
  ward: { bn: 'ওয়ার্ড', en: 'Wards' },
  bed: { bn: 'বেড', en: 'Beds' },
  staff: { bn: 'কর্মী', en: 'Staff' },
} as const satisfies Record<string, Message>;

export function structureTypeName(type: string, locale: Locale): string {
  return (STRUCTURE_TYPE_NAMES as Record<string, Message | undefined>)[type]?.[locale] ?? type;
}

/** What a column was found to hold. */
export const COLUMN_KIND_NAMES = {
  empty: { bn: 'খালি', en: 'nothing' },
  text: { bn: 'লেখা', en: 'text' },
  integer: { bn: 'সংখ্যা', en: 'whole numbers' },
  money: { bn: 'টাকার অঙ্ক', en: 'amounts' },
  date: { bn: 'তারিখ', en: 'dates' },
  time: { bn: 'সময়', en: 'times' },
  phone: { bn: 'ফোন নম্বর', en: 'phone numbers' },
  email: { bn: 'ইমেইল ঠিকানা', en: 'email addresses' },
} as const satisfies Record<string, Message>;

export function columnKindName(kind: string, locale: Locale): string {
  return (COLUMN_KIND_NAMES as Record<string, Message | undefined>)[kind]?.[locale] ?? kind;
}
