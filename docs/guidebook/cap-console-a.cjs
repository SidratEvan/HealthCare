// Staff console, part A: getting in (picker, sign-in, two-step, applying),
// reception and its actions, the registration desk, and the doctor.
const L = require('./lib.cjs');
const { codeAt } = require('./totp.cjs');
const { step, shot } = L;

const t = (page, id) => page.getByTestId(id).first();
async function visible(page, id, timeout = 15000) {
  await t(page, id).waitFor({ state: 'visible', timeout });
}
async function closeSheet(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
const NO_PRINT = () => {
  window.print = () => {};
};

(async () => {
  const browser = await L.chromium.launch();
  const all = await L.consoles();
  const shapla = all.find((c) => /Shapla/.test(c.nameEn));
  const running = shapla.sessions.find((s) => s.status === 'running') ?? shapla.sessions[0];

  // --- Getting in ---------------------------------------------------------------
  await step('picker', async () => {
    const ctx = await L.newContext(browser);
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + '/');
    await visible(page, 'console-picker', 20000);
    await shot(page, 'c-picker');
    await shot(page, 'c-picker-chambers', { scrollTo: 'picker-group-all' });
    await ctx.close();
  });
  await step('picker-bn', async () => {
    const ctx = await L.newContext(browser, { locale: 'bn' });
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + '/');
    await visible(page, 'console-picker', 20000);
    await shot(page, 'c-picker-bn');
    await ctx.close();
  });
  await step('login', async () => {
    const ctx = await L.newContext(browser);
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + '/?login=1');
    await visible(page, 'staff-login');
    await shot(page, 'c-login');
    await t(page, 'login-email').fill('receptionist1@shapla-general.demo.invalid');
    await t(page, 'login-password').fill('not-the-password');
    await t(page, 'login-submit').click();
    await visible(page, 'login-error');
    await shot(page, 'c-login-error');
    await t(page, 'login-password').fill('demo-password-2026');
    await t(page, 'login-submit').click();
    await page.waitForTimeout(3000);
    await shot(page, 'c-login-landing');
    await ctx.close();
  });
  await step('two-step setup', async () => {
    const ctx = await L.newContext(browser);
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + '/?login=1');
    await visible(page, 'staff-login');
    await t(page, 'login-email').fill('admin@shapla-general.demo.invalid');
    await t(page, 'login-password').fill('demo-password-2026');
    await t(page, 'login-submit').click();
    await visible(page, 'two-factor-setup', 30000);
    await page.waitForTimeout(1000);
    await shot(page, 'c-2fa-setup', { tall: true, maxHeight: 1250 });
    const secret = ((await t(page, 'tfa-secret').textContent()) ?? '').replace(/\s/g, '');
    await t(page, 'tfa-setup-code').fill(codeAt(secret));
    await t(page, 'tfa-setup-submit').click();
    await visible(page, 'tfa-recovery-codes', 20000);
    await shot(page, 'c-2fa-recovery');
    await t(page, 'tfa-recovery-kept').check();
    await t(page, 'tfa-recovery-continue').click();
    await page.waitForTimeout(3000);
    await shot(page, 'c-admin-landing');
    await ctx.close();
    // A new browser tab holds no session: signing in again now asks for the code.
    const again = await L.newContext(browser);
    const next = await again.newPage();
    await next.goto(L.CONSOLE + '/?login=1');
    await visible(next, 'staff-login');
    await t(next, 'login-email').fill('admin@shapla-general.demo.invalid');
    await t(next, 'login-password').fill('demo-password-2026');
    await t(next, 'login-submit').click();
    await visible(next, 'two-factor-code', 30000);
    await shot(next, 'c-2fa-code');
    await again.close();
  });
  await step('apply', async () => {
    const ctx = await L.newContext(browser);
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + '/?apply=1');
    await visible(page, 'apply-form');
    await shot(page, 'c-apply');
    await t(page, 'apply-name-bn').fill('নদী ক্লিনিক (ডেমো)');
    await t(page, 'apply-name-en').fill('Nodi Clinic (Demo)');
    await t(page, 'apply-kind-clinic').click();
    await t(page, 'apply-division-Dhaka').click();
    await t(page, 'apply-district').fill('Gazipur');
    await t(page, 'apply-phone').fill('01911000321');
    await t(page, 'apply-registration').fill('DEMO-REG-7788');
    await t(page, 'apply-admin-name').fill('Farzana Akter (Demo)');
    await t(page, 'apply-admin-email').fill(`farzana.${Date.now()}@nodi.demo.invalid`);
    await t(page, 'apply-admin-mobile').fill('01911000654');
    await t(page, 'apply-password').fill('Nodi-demo-2026!');
    await t(page, 'apply-password-again').fill('Nodi-demo-2026!');
    await shot(page, 'c-apply-filled', { scrollTo: 'apply-submit' });
    await t(page, 'apply-submit').click();
    await visible(page, 'apply-done', 20000);
    await shot(page, 'c-apply-done');
    await ctx.close();
  });

  // --- Reception ------------------------------------------------------------------
  const rCtx = await L.newContext(browser, { session: await L.demoSession(shapla, 'receptionist') });
  await rCtx.addInitScript(NO_PRINT);
  const r = await rCtx.newPage();
  await step('reception', async () => {
    await r.goto(`${L.CONSOLE}/?session=${running.id}`);
    await visible(r, 'call-next', 20000);
    await shot(r, 'c-reception');
    await shot(r, 'c-reception-queue', { scrollTo: 'queue-table' });
    await r.evaluate(() => window.scrollTo(0, 0));
  });
  await step('reception-walkin', async () => {
    await t(r, 'add-walkin').click();
    await visible(r, 'walkin-sheet');
    await shot(r, 'c-reception-walkin');
    await closeSheet(r);
  });
  await step('reception-chamber-more', async () => {
    await t(r, 'chamber-more').click();
    await r.waitForTimeout(500);
    await shot(r, 'c-reception-more');
    await closeSheet(r);
  });
  await step('reception-row-more', async () => {
    const more = r.locator('[data-testid^="row-more-"]').nth(1);
    await more.scrollIntoViewIfNeeded();
    await more.click();
    await r.waitForTimeout(500);
    await shot(r, 'c-reception-row-more');
    await closeSheet(r);
  });
  await step('reception-check-in', async () => {
    const check = r.locator('[data-testid^="check-in-"]').filter({ hasNot: r.locator('[data-testid="check-in-sheet"]') }).first();
    await check.scrollIntoViewIfNeeded();
    await check.click();
    await visible(r, 'check-in-sheet');
    await shot(r, 'c-reception-check-in');
    await closeSheet(r);
  });
  await step('reception-pause', async () => {
    await r.evaluate(() => window.scrollTo(0, 0));
    await t(r, 'pause-session').click();
    await r.waitForTimeout(800);
    const confirm = r.getByRole('button', { name: /^Pause/ });
    if ((await r.locator('[data-testid^="paused-banner"]').count()) === 0 && (await confirm.count()) > 1) await confirm.last().click();
    await r.waitForTimeout(1200);
    await shot(r, 'c-reception-paused');
    const resume = r.locator('[data-testid^="resume-session"]').first();
    if (await resume.count()) await resume.click();
    await r.waitForTimeout(1200);
  });
  await step('reception-standby', async () => {
    await shot(r, 'c-reception-standby', { scrollTo: 'standby-card' });
    await r.evaluate(() => window.scrollTo(0, 0));
  });
  await step('reception-offline', async () => {
    await rCtx.setOffline(true);
    await r.waitForTimeout(2500);
    await t(r, 'call-next').click();
    await r.waitForTimeout(1500);
    await shot(r, 'c-reception-offline', {
      marks: {
        'mark-waiting-sync': /^\d+ · Waiting to sync$/,
        'mark-needs-connection': /^Giving a serial needs a connection$/,
        'mark-called-toast': /^Called serial \d+/,
      },
    });
    await rCtx.setOffline(false);
    await r.waitForTimeout(6000);
    await shot(r, 'c-reception-synced');
  });
  await step('reception-help', async () => {
    const help = r.getByRole('button', { name: /^Help/ });
    await help.first().click();
    await r.waitForTimeout(800);
    await shot(r, 'c-reception-help');
    await closeSheet(r);
  });
  await step('reception-bn', async () => {
    const ctx = await L.newContext(browser, { locale: 'bn', session: await L.demoSession(shapla, 'receptionist') });
    const page = await ctx.newPage();
    await page.goto(`${L.CONSOLE}/?session=${running.id}`);
    await visible(page, 'call-next', 20000);
    await shot(page, 'c-reception-bn');
    await ctx.close();
  });

  // --- Registration desk -------------------------------------------------------------
  await step('registration', async () => {
    await r.goto(`${L.CONSOLE}/?view=registration`);
    await visible(r, 'registration-console', 20000);
    await shot(r, 'c-registration');
    await t(r, 'finder-phone').fill('01310000001');
    await t(r, 'finder-search').click();
    await r.waitForTimeout(1500);
    await shot(r, 'c-registration-found');
  });

  // --- Doctor ---------------------------------------------------------------------------
  const dCtx = await L.newContext(browser, { session: await L.demoSession(shapla, 'doctor') });
  await dCtx.addInitScript(NO_PRINT);
  const d = await dCtx.newPage();
  await step('doctor', async () => {
    await d.goto(`${L.CONSOLE}/?session=${running.id}`);
    await visible(d, 'doctor-workspace', 20000);
    await d.waitForTimeout(1500);
    await shot(d, 'c-doctor');
  });
  await step('doctor-queue', async () => {
    const toggle = d.getByTestId('doctor-queue-toggle');
    if ((await toggle.count()) && (await toggle.first().isVisible())) {
      await toggle.first().click();
      await d.waitForTimeout(800);
      await shot(d, 'c-doctor-queue');
      await toggle.first().click().catch(() => {});
      await d.waitForTimeout(500);
    }
  });
  await step('doctor-write', async () => {
    await t(d, 'visit-diagnosis').fill('Stable angina — review in two weeks');
    await t(d, 'rx-add').click();
    await d.waitForTimeout(400);
    await t(d, 'rx-name-0').fill('Amlo');
    await d.waitForTimeout(1200);
    await shot(d, 'c-doctor-medicine', { scrollTo: 'rx-rows' });
    const option = d.getByRole('option').first();
    if (await option.count()) await option.click();
    else await d.keyboard.press('Enter');
    await d.waitForTimeout(500);
    await t(d, 'rx-schedule-0').fill('1+0+1').catch(() => {});
    await t(d, 'rx-days-0').fill('14').catch(() => {});
    const cbc = d.getByTestId('visit-tests').getByText(/CBC/).first();
    if (await cbc.count()) await cbc.click();
    await t(d, 'visit-advice').fill('Walk 30 minutes a day. Less salt. Come back if the pain lasts more than 10 minutes.');
    await t(d, 'follow-up-14').click();
    await d.waitForTimeout(600);
    await shot(d, 'c-doctor-written', { scrollTo: 'visit-tests' });
  });
  await step('doctor-sign-review', async () => {
    await t(d, 'sign-and-next').click();
    await d.waitForTimeout(800);
    await shot(d, 'c-doctor-sign');
    const confirm = d.getByTestId('doctor-confirm-sign');
    if (await confirm.count()) {
      await confirm.first().click();
      await d.waitForTimeout(2500);
      await shot(d, 'c-doctor-next-patient');
    }
  });
  await step('doctor-delay', async () => {
    const delay = d.getByRole('button', { name: /late|delay/i }).first();
    if (await delay.count()) {
      await delay.click();
      await d.waitForTimeout(800);
      await shot(d, 'c-doctor-delay');
      await closeSheet(d);
    }
  });
  await step('doctor-bn', async () => {
    const ctx = await L.newContext(browser, { locale: 'bn', session: await L.demoSession(shapla, 'doctor') });
    const page = await ctx.newPage();
    await page.goto(`${L.CONSOLE}/?session=${running.id}`);
    await visible(page, 'doctor-workspace', 20000);
    await page.waitForTimeout(1500);
    await shot(page, 'c-doctor-bn');
    await ctx.close();
  });

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
