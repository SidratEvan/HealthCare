// The patient app, on a phone: browsing, booking, the live serial (moved by
// reception and delayed by the doctor), standby, emergency, beds, medicines,
// records and the signed-in account.
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const L = require('./lib.cjs');
const { step, shot } = L;

const t = (page, id) => page.getByTestId(id).first();
async function visible(page, id, timeout = 15000) {
  await t(page, id).waitFor({ state: 'visible', timeout });
}

(async () => {
  const browser = await L.chromium.launch();
  const all = await L.consoles();
  const shapla = all.find((c) => /Shapla/.test(c.nameEn));
  const running = shapla.sessions.find((s) => s.status === 'running') ?? shapla.sessions[0];
  const state = { hospitalId: shapla.hospitalId, sessionId: running.id, doctorId: running.doctorId };

  const phone = await L.newContext(browser, { phone: true });
  const p = await phone.newPage();

  // --- Home, both languages -------------------------------------------------
  await step('home', async () => {
    await p.goto(L.PATIENT + '/');
    await visible(p, 'home-search');
    await shot(p, 'p-home');
  });
  await step('home-bn', async () => {
    const bn = await L.newContext(browser, { phone: true, locale: 'bn' });
    const q = await bn.newPage();
    await q.goto(L.PATIENT + '/');
    await visible(q, 'home-search');
    await shot(q, 'p-home-bn');
    await bn.close();
  });

  // --- Search -----------------------------------------------------------------
  await step('search', async () => {
    await p.goto(L.PATIENT + '/search');
    await visible(p, 'search-needs');
    await shot(p, 'p-search');
  });
  await step('search-typed', async () => {
    await t(p, 'search-input').locator('input').first().fill('Shapla').catch(async () => {
      await p.getByTestId('search-input').fill('Shapla');
    });
    await p.waitForTimeout(1200);
    await shot(p, 'p-search-typed', { tall: true, maxHeight: 1600 });
  });
  await step('search-need-card', async () => {
    await p.goto(L.PATIENT + '/search');
    await t(p, 'need-specialty:CARD').click();
    await p.waitForTimeout(1200);
    await shot(p, 'p-search-cardiology', { tall: true, maxHeight: 1700 });
  });
  await step('search-need-burn', async () => {
    await p.goto(L.PATIENT + '/search');
    await t(p, 'need-capability:burn_unit').scrollIntoViewIfNeeded();
    await t(p, 'need-capability:burn_unit').click();
    await p.waitForTimeout(1200);
    await shot(p, 'p-search-burn', { tall: true, maxHeight: 1700 });
  });

  // --- Booking ------------------------------------------------------------------
  let trackingUrl = null;
  await step('book-hospitals', async () => {
    await p.goto(L.PATIENT + '/book?specialty=CARD');
    await visible(p, `hospital-${shapla.hospitalId}`);
    await shot(p, 'p-book-hospitals', { tall: true, maxHeight: 1300 });
  });
  await step('book-hospital-detail', async () => {
    await t(p, `hospital-${shapla.hospitalId}`).click();
    await visible(p, `doctor-${running.doctorId}`);
    await shot(p, 'p-book-hospital', { tall: true, maxHeight: 1600 });
  });
  await step('book-doctor', async () => {
    await t(p, `doctor-${running.doctorId}`).click();
    await visible(p, `session-${running.id}`);
    await shot(p, 'p-book-doctor', { tall: true, maxHeight: 1600 });
  });
  await step('book-form', async () => {
    await t(p, `session-${running.id}`).click();
    await visible(p, 'confirm-booking');
    await shot(p, 'p-book-form', { tall: true, maxHeight: 2000 });
  });
  await step('book-filled', async () => {
    await p.getByLabel(/Patient name/).fill('Rahima Khatun');
    await p.getByLabel(/Mobile number/).fill('01911000123');
    await p.getByLabel(/^Age/).fill('34');
    const female = p.getByRole('button', { name: /Female/ });
    if (await female.count()) await female.first().click();
    await p.getByLabel(/What is the problem/).fill('Chest pain when climbing stairs').catch(() => {});
    await shot(p, 'p-book-filled', { tall: true, maxHeight: 2000 });
  });
  await step('book-success', async () => {
    const code = p.getByTestId('guest-otp');
    await t(p, 'confirm-booking').click();
    await p.waitForTimeout(1500);
    if (await code.count()) {
      await shot(p, 'p-book-code', { tall: true, maxHeight: 1600 });
      const demo = await t(p, 'guest-demo-code').innerText().catch(() => '');
      const digits = (demo.match(/\d{6}/) ?? [''])[0];
      await code.locator('input').first().fill(digits).catch(async () => code.fill(digits));
      await p.waitForTimeout(800);
      const again = p.getByTestId('confirm-booking');
      if (await again.count()) await again.first().click();
    }
    await visible(p, 'booking-success', 20000);
    await shot(p, 'p-book-success', { tall: true, maxHeight: 1800 });
    trackingUrl = await t(p, 'tracking-link').getAttribute('href');
    state.trackingUrl = trackingUrl;
  });

  // --- The live serial, and the console moving it --------------------------------
  const counter = await L.newContext(browser, { session: await L.demoSession(shapla, 'receptionist') });
  const desk = await counter.newPage();
  await step('live-serial', async () => {
    await p.goto(trackingUrl.startsWith('http') ? trackingUrl : L.PATIENT + trackingUrl);
    await visible(p, 'live-serial', 20000);
    await p.waitForTimeout(1500);
    await shot(p, 'p-live-serial', { tall: true, maxHeight: 1700 });
  });
  await step('live-serial-next', async () => {
    await desk.goto(`${L.CONSOLE}/?session=${running.id}`);
    await visible(desk, 'call-next', 20000);
    const before = await t(p, 'now-serving').innerText().catch(() => '');
    await t(desk, 'call-next').click();
    await p.waitForFunction((b) => {
      const el = document.querySelector('[data-testid="now-serving"]');
      return el && el.textContent !== b;
    }, before, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(800);
    await shot(p, 'p-live-serial-moved', { tall: true, maxHeight: 1700 });
    await shot(desk, 'c-reception-after-next');
  });
  await step('live-serial-bn', async () => {
    const bn = await L.newContext(browser, { phone: true, locale: 'bn' });
    const q = await bn.newPage();
    await q.goto(trackingUrl.startsWith('http') ? trackingUrl : L.PATIENT + trackingUrl);
    await visible(q, 'live-serial', 20000);
    await shot(q, 'p-live-serial-bn', { tall: true, maxHeight: 1700 });
    await bn.close();
  });
  await step('live-serial-offline', async () => {
    await phone.setOffline(true);
    await p.waitForTimeout(6000);
    await shot(p, 'p-live-serial-offline', { tall: true, maxHeight: 1700 });
    await phone.setOffline(false);
    await p.waitForTimeout(3000);
  });

  // --- My serials ---------------------------------------------------------------
  await step('serials', async () => {
    await p.goto(L.PATIENT + '/serials');
    await p.waitForTimeout(1500);
    await shot(p, 'p-serials', { tall: true, maxHeight: 1600 });
  });

  // --- Emergency ----------------------------------------------------------------
  await step('emergency', async () => {
    await p.goto(L.PATIENT + '/emergency');
    await visible(p, 'problem-burn');
    await shot(p, 'p-emergency');
    await t(p, 'problem-burn').click();
    await p.waitForURL(/\/emergency\/results/, { timeout: 20000 });
    await visible(p, 'results', 20000).catch(() => {});
    await p.waitForTimeout(1500);
    await shot(p, 'p-emergency-results', { tall: true, maxHeight: 2000 });
    const onway = p.locator('[data-testid^="onway-"]').first();
    if (await onway.count()) {
      await onway.click();
      await p.waitForTimeout(1200);
      await shot(p, 'p-emergency-onway-form', { tall: true, maxHeight: 1600 });
      const send = p.getByTestId('onway-send');
      if (await send.count()) {
        await send.first().click();
        await p.waitForTimeout(2500);
        await shot(p, 'p-emergency-onway', { tall: true, maxHeight: 1600 });
        state.onwayUrl = p.url();
      }
    }
  });

  // --- Beds ---------------------------------------------------------------------
  await step('beds', async () => {
    await p.goto(L.PATIENT + '/beds');
    await visible(p, 'bed-search');
    await shot(p, 'p-beds', { tall: true, maxHeight: 1500 });
  });

  // --- Medicines ----------------------------------------------------------------
  await step('medicines', async () => {
    await p.goto(L.PATIENT + '/medicines');
    await visible(p, 'medicine-search');
    await t(p, 'medicine-search').locator('input').first().fill('Napa').catch(async () => p.getByTestId('medicine-search').fill('Napa'));
    await p.waitForTimeout(1800);
    await shot(p, 'p-medicines', { tall: true, maxHeight: 1600 });
  });

  // --- Records and account, as a guest and signed in ----------------------------
  await step('records-guest', async () => {
    await p.goto(L.PATIENT + '/records');
    await p.waitForTimeout(1200);
    await shot(p, 'p-records-guest');
  });
  const acct = await L.newContext(browser, { phone: true });
  const a = await acct.newPage();
  await step('signin', async () => {
    await a.goto(L.PATIENT + '/profile');
    await visible(a, 'signin-phone');
    await shot(a, 'p-signin');
    await t(a, 'signin-phone-input').locator('input').first().fill('01310000001').catch(async () => a.getByTestId('signin-phone-input').fill('01310000001'));
    await t(a, 'signin-send').click();
    await visible(a, 'signin-code');
    await a.waitForTimeout(800);
    await shot(a, 'p-signin-code');
    const demo = await t(a, 'signin-demo-code').innerText().catch(() => '');
    const digits = (demo.match(/\d{6}/) ?? [''])[0];
    await a.getByTestId('signin-code').locator('input').first().click();
    await a.keyboard.type(digits, { delay: 80 });
    await a.waitForTimeout(1500);
    const go = a.getByRole('button', { name: /Verify|Sign in|Confirm/ });
    if ((await a.getByTestId('account').count()) === 0 && (await go.count())) await go.first().click().catch(() => {});
    await visible(a, 'account', 20000);
    await a.waitForTimeout(1200);
    await shot(a, 'p-account', { tall: true, maxHeight: 2000 });
  });
  await step('records-account', async () => {
    await a.goto(L.PATIENT + '/records');
    await a.waitForTimeout(2000);
    await shot(a, 'p-records', { tall: true, maxHeight: 2000 });
    const reports = a.getByTestId('wallet-tab-reports');
    if (await reports.count()) {
      await reports.first().click();
      await a.waitForTimeout(1200);
      await shot(a, 'p-records-reports', { tall: true, maxHeight: 1800 });
    }
    const code = a.getByTestId('show-consent-code');
    if (await code.count()) {
      await code.first().click();
      await a.waitForTimeout(1200);
      await shot(a, 'p-consent-code', { tall: true, maxHeight: 1600 });
    }
  });
  await step('serials-account', async () => {
    await a.goto(L.PATIENT + '/serials');
    await a.waitForTimeout(1500);
    await shot(a, 'p-serials-account', { tall: true, maxHeight: 1800 });
  });

  // --- A hospital's own portal: the same app at <code>.<platform domain> --------
  for (const code of ['padma', 'shapla']) {
    await step(`portal-${code}`, async () => {
      const ctx = await L.newContext(browser, { phone: true });
      const q = await ctx.newPage();
      await q.goto(`http://${code}.localhost:3000/`);
      await q.waitForTimeout(2500);
      await shot(q, `p-portal-${code}`, { tall: true, maxHeight: 1500 });
      await ctx.close();
    });
  }

  writeFileSync(join(__dirname, 'state.json'), JSON.stringify(state, null, 1));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
