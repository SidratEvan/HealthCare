// Shared helpers for the guidebook captures: a browser, demo sessions, and a
// shot that saves the picture plus every labelled element's box.
const { createRequire } = require('node:module');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRequire = createRequire(join(__dirname, '../../package.json'));
const { chromium } = repoRequire('@playwright/test');

const API = 'http://localhost:4000/api/v1';
const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function json(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['idempotency-key'] = `book${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function consoles() {
  return (await json('GET', '/demo/consoles')).data.data.consoles;
}

async function demoSession(hospital, role) {
  const minted = await json('POST', '/demo/token', hospital ? { hospitalId: hospital.hospitalId, role } : { role });
  if (minted.status !== 200) throw new Error(`demo token ${role}: ${minted.status} ${JSON.stringify(minted.data)}`);
  const d = minted.data.data;
  return {
    token: d.token,
    hospitalId: d.hospitalId,
    staffName: d.staffName,
    role,
    ...(hospital ? { hospitalNameBn: hospital.nameBn, hospitalNameEn: hospital.nameEn } : {}),
  };
}

const HIDE_DEV = 'nextjs-portal{display:none!important}';

async function newContext(browser, { phone = false, locale = 'en', session = null, scale = 1.5 } = {}) {
  const context = await browser.newContext({
    viewport: phone ? PHONE : DESKTOP,
    deviceScaleFactor: scale,
    isMobile: phone,
    hasTouch: phone,
    locale: locale === 'bn' ? 'bn-BD' : 'en-GB',
    timezoneId: 'Asia/Dhaka',
  });
  await context.addInitScript(
    ([loc, sess]) => {
      try {
        window.localStorage.setItem('platform.locale', loc);
        if (sess) window.sessionStorage.setItem('console.demo-session', JSON.stringify(sess));
      } catch {
        /* storage unavailable */
      }
    },
    [locale, session],
  );
  return context;
}

/** Every visible element with a data-testid, plus headings and buttons, in page coordinates. */
async function elementsOn(page) {
  return await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const nodes = document.querySelectorAll('[data-testid], h1, h2, h3, button, a[href], input, select, textarea, [role="tab"], nav, header, aside, main');
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const box = { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
      const key = `${box.x},${box.y},${box.w},${box.h}`;
      const id = el.getAttribute('data-testid');
      if (!id && seen.has(key)) continue;
      seen.add(key);
      out.push({
        id,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        text: (el.innerText || el.value || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 90),
        box,
      });
    }
    return out;
  });
}

async function settle(page, ms = 600) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    /* sockets keep the network busy */
  }
  await page.addStyleTag({ content: HIDE_DEV }).catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * Saves <name>.jpg and <name>.json.
 *
 * tall: the viewport is stretched to the page's height (up to maxHeight) so a
 * long page is one picture and fixed bars stay where a person sees them.
 * scrollTo: a testid to scroll into view first (normal-height shots).
 */
async function shot(page, name, { tall = false, maxHeight = 2400, scrollTo = null, meta = {}, marks = null } = {}) {
  await settle(page);
  const original = page.viewportSize();
  if (scrollTo) {
    await page.getByTestId(scrollTo).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
  }
  if (tall) {
    const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    const target = Math.min(Math.max(height, original.height), maxHeight);
    if (target !== original.height) {
      await page.setViewportSize({ width: original.width, height: target });
      await page.waitForTimeout(500);
    }
  }
  const size = page.viewportSize();
  const file = join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  // Boxes relative to what the picture shows (the viewport), not the document.
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const elements = (await elementsOn(page)).map((e) => ({ ...e, box: { ...e.box, x: e.box.x - scroll.x, y: e.box.y - scroll.y } }));
  // Text with no label of its own, found by its words: the smallest element saying it.
  for (const [markName, pattern] of Object.entries(marks ?? {})) {
    const found = await page.evaluate((source) => {
      const re = new RegExp(source);
      let best = null;
      for (const el of document.querySelectorAll('body *')) {
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text || !re.test(text)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) continue;
        const area = r.width * r.height;
        if (!best || area < best.area) best = { x: r.left, y: r.top, w: r.width, h: r.height, area };
      }
      return best;
    }, pattern.source ?? String(pattern));
    if (found) elements.push({ id: markName, tag: 'mark', role: null, aria: null, text: '', box: { x: Math.round(found.x), y: Math.round(found.y), w: Math.round(found.w), h: Math.round(found.h) } });
    else console.log(`  mark not found: ${markName}`);
  }
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ name, url: page.url(), width: size.width, height: size.height, meta, elements }, null, 1));
  console.log(`shot ${name} ${size.width}x${size.height} (${elements.length} elements)`);
  if (tall && size.height !== original.height) await page.setViewportSize(original);
  return { width: size.width, height: size.height, elements };
}

/** Runs one capture step; a failure is logged and the rest goes on. */
async function step(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.log(`FAILED ${label}: ${String(error.message ?? error).split('\n')[0]}`);
  }
}

module.exports = { chromium, API, CONSOLE, PATIENT, OUT, json, consoles, demoSession, newContext, shot, settle, elementsOn, step };
