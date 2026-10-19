// Types for `followUp.js`, which a TypeScript browser spec reads
// (`e2e/doctor-midnight.spec.ts`; docs/django-migration/frontend-js.md).
export function customFollowUpDays(raw: string): number | null;
export function followUpDateIn(days: number, at?: Date): string;
export function followUpDateLabel(date: string, locale: 'bn' | 'en'): string;
