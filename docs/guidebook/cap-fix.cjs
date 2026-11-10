// The screens the full run missed: standby, the bed request answer, the token
// slips, a new patient at the registration desk, the created workspace, and
// the guest's consent code and access log.
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
  const second = shapla.sessions.find((s) => s.departmentNameEn === 'Cardiology' && s.id !== running.id);
  const only = process.argv[2];
  const want = (name) => !only || only === name;

  if (want('standby')) await step('standby', async () => {
    // The button shows only on a full session (BTN-A06D-STANDBY): the second
    // cardiologist's chamber is made full in the local demonstration database.
    require('node:child_process').execSync(
      `docker exec healthcare-db psql -U healthcare -d healthcare_dev -c "UPDATE sessions s SET capacity = GREATEST((SELECT count(*) FROM bookings b WHERE b.session_id = s.id AND b.status::text <> 'cancelled'), 1) WHERE id = '${second.id}'"`,
      { stdio: 'ignore' },
    );
    const ctx = await L.newContext(browser, { phone: true });
    const q = await ctx.newPage();
    await q.goto(L.PATIENT + '/book?specialty=CARD');
    await t(q, `hospital-${shapla.hospitalId}`).click();
    await visible(q, `doctor-${second.doctorId}`);
    await t(q, `doctor-${second.doctorId}`).click();
    await visible(q, `standby-join-${second.id}`, 20000);
    await shot(q, 'p-standby-offer', { tall: true, maxHeight: 1600 });
    await t(q, `standby-join-${second.id}`).click();
    await visible(q, 'standby-join');
    const form = q.getByTestId('standby-join');
    await form.getByLabel(/Patient name/).fill('Jahanara Begum');
    await form.getByLabel(/Mobile number/).fill('01911000456');
    await form.getByLabel(/^Age/).fill('52');
    await t(q, 'standby-choice-ask').click().catch(() => {});
    await shot(q, 'p-standby-form', { tall: true, maxHeight: 1700 });
    await t(q, 'standby-confirm').click();
    await q.waitForURL(/\/standby\?t=/, { timeout: 30000 });
    await visible(q, 'standby-status', 20000);
    await q.waitForTimeout(1200);
    await shot(q, 'p-standby-status', { tall: true, maxHeight: 1600 });
    await ctx.close();
  });

  if (want('bedrequest')) await step('bed request', async () => {
    const ctx = await L.newContext(browser, { phone: true });
    const p = await ctx.newPage();
    await p.goto(L.PATIENT + '/beds');
    await visible(p, 'bed-search');
    const btn = t(p, `request-bed-${shapla.hospitalId}`);
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ force: true });
    await visible(p, 'bed-request-sheet');
    await t(p, 'request-name').fill('Kamal Hossain');
    await t(p, 'request-phone').fill('01911000789');
    await t(p, 'request-age').fill('61');
    await p.getByTestId('bed-request-sheet').getByRole('button', { name: /^Male/ }).first().click({ force: true }).catch(() => {});
    await p.getByTestId('bed-request-sheet').getByRole('button', { name: /Within 60/ }).first().click({ force: true }).catch(() => {});
    await p.evaluate(() => window.scrollTo(0, 0));
    await shot(p, 'p-bed-request-form', { tall: true, maxHeight: 1700 });
    await t(p, 'request-send').dispatchEvent('click');
    await p.waitForTimeout(3000);
    await shot(p, 'p-bed-request-status', { tall: true, maxHeight: 1600 });
    await ctx.close();
  });

  if (want('slip')) await step('reception slip', async () => {
    const ctx = await L.newContext(browser, { session: await L.demoSession(shapla, 'receptionist') });
    await ctx.addInitScript(() => {
      window.print = () => {};
    });
    const r = await ctx.newPage();
    await r.goto(`${L.CONSOLE}/?session=${running.id}`);
    await visible(r, 'call-next', 20000);
    const more = r.locator('[data-testid^="row-more-"]').nth(2);
    await more.scrollIntoViewIfNeeded();
    await more.click();
    await r.waitForTimeout(500);
    await shot(r, 'c-reception-row-menu');
    await r.locator('[data-testid^="print-slip-"]:visible').first().click();
    await r.waitForSelector('[data-token-slip]', { state: 'attached', timeout: 15000 });
    await r.emulateMedia({ media: 'print' });
    await r.setViewportSize({ width: 600, height: 900 });
    await r.waitForTimeout(800);
    await shot(r, 'c-token-slip');
    await r.emulateMedia({ media: 'screen' });
    await ctx.close();
  });

  if (want('registration')) await step('registration', async () => {
    const ctx = await L.newContext(browser, { session: await L.demoSession(shapla, 'receptionist') });
    await ctx.addInitScript(() => {
      window.print = () => {};
    });
    const r = await ctx.newPage();
    await r.goto(`${L.CONSOLE}/?view=registration`);
    await visible(r, 'registration-console', 20000);
    await t(r, 'finder-phone').fill(`0191${String(Date.now()).slice(-7)}`);
    await visible(r, 'finder-name', 15000);
    await t(r, 'finder-name').fill('Shahana Parvin');
    await t(r, 'finder-age').fill('41');
    await r.getByTestId('finder-new').getByRole('button', { name: /^Female/ }).click();
    await shot(r, 'c-registration-new');
    await t(r, 'finder-register').click();
    await r.waitForTimeout(1200);
    const confirm = r.getByTestId('finder-confirm-patient');
    if (await confirm.count()) await confirm.first().click();
    await r.waitForTimeout(800);
    await t(r, `registration-add-${running.id}`).click();
    await r.waitForTimeout(800);
    await shot(r, 'c-registration-ready');
    await t(r, 'registration-submit').click();
    await visible(r, 'registration-confirmed', 20000);
    await r.waitForTimeout(800);
    await shot(r, 'c-registration-confirmed', { tall: true, maxHeight: 1150 });
    await t(r, 'registration-print-slip').click();
    await r.waitForSelector('[data-token-slip]', { state: 'attached', timeout: 15000 });
    await r.emulateMedia({ media: 'print' });
    await r.setViewportSize({ width: 600, height: 900 });
    await r.waitForTimeout(800);
    await shot(r, 'c-registration-slip');
    await ctx.close();
  });

  if (want('consent')) await step('guest consent code', async () => {
    const ctx = await L.newContext(browser, { phone: true });
    const p = await ctx.newPage();
    await p.goto(L.PATIENT + '/book?specialty=CARD');
    await t(p, `hospital-${shapla.hospitalId}`).click();
    await t(p, `doctor-${running.doctorId}`).click();
    await t(p, `session-${running.id}`).click();
    await p.getByLabel(/Patient name/).fill('Rahima Khatun');
    await p.getByLabel(/Mobile number/).fill(`0191${String(Date.now()).slice(-7)}`);
    await p.getByLabel(/^Age/).fill('34');
    await t(p, 'confirm-booking').click();
    await visible(p, 'booking-success', 20000);
    await p.goto(L.PATIENT + '/records');
    await visible(p, 'show-consent-code', 20000);
    await shot(p, 'p-records-guest');
    await t(p, 'show-consent-code').click();
    await p.waitForTimeout(1500);
    await shot(p, 'p-consent-code', { tall: true, maxHeight: 1500 });
    await p.goto(L.PATIENT + '/records');
    await visible(p, 'show-access', 20000);
    await t(p, 'show-access').click();
    await p.waitForTimeout(1500);
    await shot(p, 'p-access-log', { tall: true, maxHeight: 1500 });
    await ctx.close();
  });

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
