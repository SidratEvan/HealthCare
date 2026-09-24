/**
 * Names in both languages, on every read a screen names something from
 * (`GR-06`, `FR-LOC-01`, `SEG-A00-LANG`, `SEG-B00-LANG`).
 *
 * The language switch changes the screen without asking the server again —
 * `I18N-08`: "applies instantly without reload" — so each read has to carry
 * the English name beside the Bangla one already. These are the reads that
 * used to carry only the Bangla: the console picker's chambers, a hospital's
 * doctors and their departments, the bookable sessions, a facility's
 * address, and the lab catalogue.
 *
 * "English" is checked as English: present, and free of Bengali script, so
 * a column accidentally selected twice cannot pass for a translation.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { resetEmitter } from '../realtime/emit.js';

import { labFixture } from './support/labFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';
const FARMGATE = { lat: 23.758, lng: 90.39 } as const;

let app: Express;

beforeEach(() => {
  app = createApp();
  resetEmitter();
});

/** A name that is really in English: not blank, and no Bengali script. */
function expectEnglish(value: unknown, what: string): void {
  expect(typeof value, what).toBe('string');
  const text = value as string;
  expect(text.trim(), what).not.toBe('');
  expect(/[ঀ-৿]/.test(text), `${what} has Bengali script: ${text}`).toBe(false);
}

/** And its Bangla partner is really Bangla. */
function expectBangla(value: unknown, what: string): void {
  expect(typeof value, what).toBe('string');
  expect(/[ঀ-৿]/.test(value as string), `${what} has no Bengali script`).toBe(true);
}

async function cardiologyHospitalId(): Promise<string> {
  const list = await request(app).get(`${BASE}/hospitals?specialty=CARD`);
  const id = (list.body.data.hospitals as { id: string }[])[0]?.id;
  if (id === undefined) throw new Error('No seeded hospital offers CARD.');
  return id;
}

describe('GET /demo/consoles — the picker (S-B-01)', () => {
  it('names each facility, doctor and department in both languages', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    expect(response.status).toBe(200);

    const consoles = response.body.data.consoles as {
      nameBn: string;
      nameEn: string;
      sessions: {
        doctorNameBn: string;
        doctorNameEn: string;
        departmentNameBn: string;
        departmentNameEn: string;
      }[];
    }[];
    expect(consoles.length).toBeGreaterThan(0);

    for (const facility of consoles) {
      expectBangla(facility.nameBn, 'facility nameBn');
      expectEnglish(facility.nameEn, 'facility nameEn');
      for (const session of facility.sessions) {
        expectEnglish(session.doctorNameEn, 'doctorNameEn');
        expectBangla(session.departmentNameBn, 'departmentNameBn');
        expectEnglish(session.departmentNameEn, 'departmentNameEn');
      }
    }
  });
});

describe('discovery (S-A-07, S-A-05h, S-A-07b)', () => {
  it('gives a hospital card its address in both languages', async () => {
    const response = await request(app).get(`${BASE}/hospitals?specialty=CARD`);
    const hospitals = response.body.data.hospitals as {
      addressBn: string | null;
      addressEn: string | null;
    }[];

    const addressed = hospitals.filter((hospital) => hospital.addressBn !== null);
    expect(addressed.length).toBeGreaterThan(0);
    for (const hospital of addressed) {
      expectBangla(hospital.addressBn, 'addressBn');
      expectEnglish(hospital.addressEn, 'addressEn');
    }
  });

  it("names a hospital's doctors' departments in both languages", async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/${await cardiologyHospitalId()}/doctors`,
    );
    const doctors = response.body.data.doctors as {
      departmentNameBn: string;
      departmentNameEn: string;
    }[];

    expect(doctors.length).toBeGreaterThan(0);
    for (const doctor of doctors) {
      expectBangla(doctor.departmentNameBn, 'departmentNameBn');
      expectEnglish(doctor.departmentNameEn, 'departmentNameEn');
    }
  });

  it('names the doctor and hospital of a bookable session in both languages', async () => {
    const response = await request(app).get(
      `${BASE}/sessions?hospitalId=${await cardiologyHospitalId()}`,
    );
    const sessions = response.body.data.sessions as {
      hospitalNameEn: string;
      doctorNameEn: string;
    }[];

    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) {
      expectEnglish(session.hospitalNameEn, 'hospitalNameEn');
      expectEnglish(session.doctorNameEn, 'doctorNameEn');
    }
  });
});

describe('GET /emergency/search (S-A-10b)', () => {
  it("gives each ER's address in both languages", async () => {
    const response = await request(app)
      .get(`${BASE}/emergency/search`)
      .query({ ...FARMGATE, problem: 'burn' });
    expect(response.status).toBe(200);

    const results = response.body.data.results as {
      addressBn: string | null;
      addressEn: string | null;
    }[];
    const addressed = results.filter((result) => result.addressBn !== null);
    expect(addressed.length).toBeGreaterThan(0);
    for (const result of addressed) expectEnglish(result.addressEn, 'addressEn');
  });
});

describe('GET /lab/catalogue — the test chips (BTN-B05-TEST)', () => {
  it('names every test in both languages', async () => {
    const lab = await labFixture('Shapla');
    const response = await request(app)
      .get(`${BASE}/lab/catalogue`)
      .set('authorization', `Bearer ${lab.doctorToken}`);
    expect(response.status).toBe(200);

    const tests = response.body.data.tests as { code: string; nameBn: string; nameEn: string }[];
    expect(tests.length).toBeGreaterThan(0);
    for (const test of tests) {
      expect(test.nameBn.trim(), test.code).not.toBe('');
      expectEnglish(test.nameEn, `${test.code} nameEn`);
    }
  });

  it("keeps each test's Bangla name as it was, which is what an order stores", async () => {
    const response = await request(app)
      .get(`${BASE}/lab/catalogue`)
      .set('authorization', `Bearer ${(await labFixture('Shapla')).doctorToken}`);
    const xray = (response.body.data.tests as { code: string; nameBn: string }[]).find(
      (test) => test.code === 'XR-CHEST',
    );
    expect(xray?.nameBn).toBe('বুকের এক্স-রে');
  });
});
