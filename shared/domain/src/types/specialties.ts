/**
 * The specialty catalogue (`GET /specialties`, BACKEND.md §7.2).
 *
 * In `shared/domain` because it is a contract rather than data: the code is
 * what `departments.code` carries, what a discovery query filters on, and what
 * a patient app puts in a URL. Three places agreeing on the spelling of `CARD`
 * is exactly the kind of thing that belongs where both sides import it from.
 *
 * It lived in `database/seeds/data/reference.ts` first, because the seeds were
 * the first thing that needed it. That copy now re-exports this one — a
 * specialty the seeds knew about and the API did not would be a department
 * nobody could search for.
 *
 * The eight are the ones `FR-DEM-02` names. Adding a ninth is a product
 * decision and a `PRD.md` edit, not a code change made in passing.
 */

export const SPECIALTIES = [
  { code: 'CARD', nameBn: 'কার্ডিওলজি', nameEn: 'Cardiology' },
  { code: 'MED', nameBn: 'মেডিসিন', nameEn: 'Medicine' },
  { code: 'GYN', nameBn: 'গাইনী', nameEn: 'Gynaecology' },
  { code: 'ORTHO', nameBn: 'অর্থোপেডিক্স', nameEn: 'Orthopaedics' },
  { code: 'PAED', nameBn: 'শিশু', nameEn: 'Paediatrics' },
  { code: 'NEURO', nameBn: 'নিউরোলজি', nameEn: 'Neurology' },
  { code: 'ENT', nameBn: 'নাক কান গলা', nameEn: 'ENT' },
  { code: 'DERM', nameBn: 'চর্ম ও যৌন', nameEn: 'Dermatology' },
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

/**
 * A department code, as a union of the eight.
 *
 * `as const` above is what makes this a union of literals rather than
 * `string` — so a typo in a seed, a query or a URL is a compile error instead
 * of an empty result page that looks like "no doctors available".
 */
export type SpecialtyCode = Specialty['code'];

/** A specialty by code. Throws rather than returning a silent nothing. */
export function specialtyOf(code: SpecialtyCode): Specialty {
  const found = SPECIALTIES.find((entry) => entry.code === code);
  if (found === undefined) throw new Error(`Unknown specialty code: ${code}`);
  return found;
}

/** True when this code names a specialty the product offers. */
export function isSpecialtyCode(code: string): code is SpecialtyCode {
  return SPECIALTIES.some((entry) => entry.code === code);
}
