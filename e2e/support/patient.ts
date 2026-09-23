/**
 * The patient's side of a console spec: book as a guest, keep the SMS link.
 *
 * The same steps `two-device-queue.spec.ts` takes, shared here for specs that
 * need a patient's phone on a chamber they are driving from the console. The
 * canary keeps its own copy on purpose: it is the one spec that must never
 * change because something else did.
 */

import { expect, type BrowserContext, type Page } from '@playwright/test';

import type { ConsoleSession } from './console.js';

const PATIENT = 'http://localhost:3000';

/** A phone nobody else in the run will use (`DB-P6` normalised). */
export function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

/** Books a guest serial on the spec's chamber and returns the tracking link. */
export async function bookAsGuest(page: Page, session: ConsoleSession): Promise<string> {
  await page.goto(`${PATIENT}/book?specialty=${session.departmentCode}`);

  await page.getByTestId(`hospital-${session.hospitalId}`).click();
  await page.getByTestId(`doctor-${session.doctorId}`).click();
  await page.getByTestId(`session-${session.sessionId}`).click();

  await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
  await page.getByLabel('মোবাইল নম্বর').fill(guestPhone());
  await page.getByLabel('বয়স').fill('34');
  await page.getByRole('button', { name: 'বিকাশ' }).click();
  await page.getByTestId('confirm-booking').click();

  await expect(page.getByTestId('booking-success')).toBeVisible();

  const href = await page.getByTestId('tracking-link').getAttribute('href');
  if (href === null) throw new Error('the success screen issued no tracking link');
  return href;
}

/** Opens the live serial from the SMS link, on its own device. */
export async function openLiveSerial(context: BrowserContext, trackingUrl: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(trackingUrl);
  await expect(page.getByTestId('live-serial')).toBeVisible();
  return page;
}
