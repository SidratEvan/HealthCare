/**
 * `GET /search` — one search across the network (`S-A-07s`, `FR-PAT-16`–`18`).
 *
 * Public like the rest of discovery, so the two things worth a test are what
 * it answers for each kind of need, and what it never carries. Runs against
 * the seeded demo database (CLAUDE.md §6): six facilities, two with burn
 * units, three with an ICU.
 */

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PublicCapacity, SearchNeed } from '@platform/domain';

import { createApp } from '../app.js';

import type { Express } from 'express';

const BASE = '/api/v1';

interface Listing {
  readonly id: string;
  readonly nameEn: string;
  readonly capabilities: readonly string[];
  readonly capabilityAsOf: string | null;
  readonly doctorCount: number | null;
  readonly sittingNow: number;
  readonly openSerialsToday: number;
  readonly beds: PublicCapacity | null;
}

interface Answer {
  readonly need: SearchNeed | null;
  readonly text: string | null;
  readonly hospitals: readonly Listing[];
  readonly doctors: readonly {
    readonly nameEn: string;
    readonly chambers: readonly { readonly hospitalId: string; readonly departmentCode: string }[];
  }[];
  readonly asOf: string;
}

let app: Express;

async function search(query: string): Promise<Answer> {
  const response = await request(app).get(`${BASE}/search${query}`);
  expect(response.status).toBe(200);
  return response.body.data as Answer;
}

beforeAll(() => {
  app = createApp();
});

describe('search is public and stamped (FR-GST-01, FR-PAT-14)', () => {
  it('answers without a token, with every participating hospital and when it was read', async () => {
    const answer = await search('');

    expect(answer.need).toBeNull();
    expect(answer.text).toBeNull();
    expect(answer.hospitals.length).toBeGreaterThanOrEqual(6);
    expect(Number.isNaN(Date.parse(answer.asOf))).toBe(false);
  });

  it('carries nothing about a person or a hospital’s inside', async () => {
    const response = await request(app).get(`${BASE}/search?need=specialty:CARD`);
    const raw = JSON.stringify(response.body);

    // The privacy boundary of the network (FR-NET-02): what is absent.
    for (const forbidden of [
      'patient',
      'booking',
      'staff',
      'email',
      'password',
      'bmdcNumber',
      'revenue',
    ]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('a need answers with the hospitals that can provide it (FR-PAT-17)', () => {
  it('a specialty: only hospitals with a doctor in it, each with its live counts', async () => {
    const answer = await search('?need=specialty:CARD');

    expect(answer.need).toEqual({ kind: 'specialty', code: 'CARD' });
    expect(answer.hospitals.length).toBeGreaterThan(0);
    for (const hospital of answer.hospitals) {
      expect(hospital.doctorCount).toBeGreaterThan(0);
      expect(typeof hospital.sittingNow).toBe('number');
      expect(typeof hospital.openSerialsToday).toBe('number');
    }

    // And the doctors in it, each with somewhere to be booked.
    expect(answer.doctors.length).toBeGreaterThan(0);
    for (const doctor of answer.doctors) {
      expect(doctor.chambers.some((chamber) => chamber.departmentCode === 'CARD')).toBe(true);
    }
  });

  it('a bed kind: only hospitals that have it, most free first, full ones kept', async () => {
    const answer = await search('?need=bed:icu');

    expect(answer.hospitals.length).toBeGreaterThanOrEqual(3);
    const free = answer.hospitals.map((hospital) => {
      const tally = hospital.beds?.byKind.find((entry) => entry.kind === 'icu');
      expect(tally, hospital.nameEn).toBeDefined();
      return tally?.asOf === null ? -1 : (tally?.free ?? -1);
    });
    expect(free).toEqual([...free].sort((a, b) => b - a));

    // A bed search does not list doctors.
    expect(answer.doctors).toEqual([]);
  });

  it('a capability: only hospitals that say they have it now, with when that was confirmed', async () => {
    const answer = await search('?need=capability:burn_unit');
    const names = answer.hospitals.map((hospital) => hospital.nameEn).sort();

    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^Jamuna/);
    expect(names[1]).toMatch(/^Padma/);
    for (const hospital of answer.hospitals) {
      expect(hospital.capabilities).toContain('burn_unit');
      expect(hospital.capabilityAsOf).not.toBeNull();
    }
  });
});

describe('typed text (FR-PAT-16, FR-PAT-18)', () => {
  it('reads a word that names a need as that need, in either language', async () => {
    const english = await search('?q=ICU');
    const bangla = await search(`?q=${encodeURIComponent('আইসিইউ')}`);

    expect(english.need).toEqual({ kind: 'bed', bedKind: 'icu' });
    expect(bangla.need).toEqual({ kind: 'bed', bedKind: 'icu' });
    expect(bangla.hospitals.map((hospital) => hospital.id)).toEqual(
      english.hospitals.map((hospital) => hospital.id),
    );
  });

  it('finds a hospital by part of its name, in either script', async () => {
    const english = await search('?q=shapla');
    const bangla = await search(`?q=${encodeURIComponent('শাপলা')}`);

    // Seeded names carry the demonstration label (FR-DEM-07), so by prefix.
    expect(english.need).toBeNull();
    for (const answer of [english, bangla]) {
      expect(answer.hospitals.length).toBeGreaterThan(0);
      expect(answer.hospitals.every((hospital) => hospital.nameEn.startsWith('Shapla'))).toBe(true);
    }
  });

  it('finds a doctor by part of the name, with the hospital they sit at', async () => {
    const answer = await search('?q=Ayesha');

    const ayesha = answer.doctors.find((doctor) => doctor.nameEn.startsWith('Ayesha Siddika'));
    expect(ayesha).toBeDefined();
    expect(ayesha?.chambers.length).toBeGreaterThan(0);
  });

  it('narrows a chosen need by the text typed with it', async () => {
    const all = await search('?need=bed:icu');
    const narrowed = await search('?need=bed:icu&q=padma');

    expect(narrowed.hospitals.length).toBeLessThan(all.hospitals.length);
    expect(narrowed.hospitals.every((hospital) => hospital.nameEn.startsWith('Padma'))).toBe(true);
  });

  it('answers a name nobody has with nothing, not with everything', async () => {
    const answer = await search('?q=zzzzqqqq');

    expect(answer.hospitals).toEqual([]);
    expect(answer.doctors).toEqual([]);
  });
});

describe('what is refused (FR-PAT-18)', () => {
  it('refuses a need the data does not hold rather than answering with none', async () => {
    const response = await request(app).get(`${BASE}/search?need=specialty:ONCO`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a malformed need and a position outside Bangladesh', async () => {
    expect((await request(app).get(`${BASE}/search?need=icu`)).status).toBe(400);
    expect((await request(app).get(`${BASE}/search?lat=51.5&lng=-0.1`)).status).toBe(400);
  });
});
