// Staff console, part B: ward, emergency, lab, pharmacy, administration
// (today, reports, staff, doctors, settings, import), onboarding and the
// national dashboard.
const { readFileSync } = require('node:fs');
const L = require('./lib.cjs');
const { step, shot } = L;

const t = (page, id) => page.getByTestId(id).first();
async function visible(page, id, timeout = 15000) {
  await t(page, id).waitFor({ state: 'visible', timeout });
}
async function closeSheet(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
async function firstOf(page, prefix, filter) {
  const all = page.locator(`[data-testid^="${prefix}"]`);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const text = (await el.innerText().catch(() => '')) ?? '';
    if (!filter || filter.test(text)) return el;
  }
  return null;
}

(async () => {
  const browser = await L.chromium.launch();
  const all = await L.consoles();
  const shapla = all.find((c) => /Shapla/.test(c.nameEn));
  const open = async (role, path, opts = {}) => {
    const ctx = await L.newContext(browser, { session: await L.demoSession(opts.hospital === null ? null : shapla, role), ...(opts.locale ? { locale: opts.locale } : {}) });
    await ctx.addInitScript(() => {
      window.print = () => {};
    });
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + path);
    return { ctx, page };
  };

  // --- Ward ---------------------------------------------------------------------
  await step('ward', async () => {
    const { ctx, page } = await open('ward', '/?view=ward');
    await visible(page, 'ward-board', 20000);
    await shot(page, 'c-ward');
    const free = await firstOf(page, 'bed-tile-', /Free/);
    await free.click();
    await visible(page, 'bed-panel');
    await shot(page, 'c-ward-free-bed');
    await t(page, 'action-admit').click();
    await visible(page, 'admit-form');
    await t(page, 'admit-name').fill('Nurul Islam').catch(() => {});
    await t(page, 'admit-phone').fill('01911000777').catch(() => {});
    await t(page, 'admit-age').fill('67').catch(() => {});
    await page.locator('[data-testid^="admit-sex-"]').first().click().catch(() => {});
    await shot(page, 'c-ward-admit');
    await closeSheet(page);
    await closeSheet(page);
    const occupied = await firstOf(page, 'bed-tile-', /Occupied/);
    await occupied.click();
    await visible(page, 'bed-panel');
    await shot(page, 'c-ward-occupied-bed');
    await t(page, 'action-transfer').click();
    await page.waitForTimeout(600);
    await shot(page, 'c-ward-transfer');
    await closeSheet(page);
    await closeSheet(page);
    await t(page, 'ward-filter-free').click();
    await page.waitForTimeout(600);
    await shot(page, 'c-ward-filter-free');
    await t(page, 'ward-filter-free').click();
    await page.waitForTimeout(400);
    const pending = page.getByTestId('pending-admissions');
    if (await pending.count()) await shot(page, 'c-ward-requests', { scrollTo: 'pending-admissions' });
    await ctx.close();
  });

  // --- Emergency --------------------------------------------------------------------
  await step('er', async () => {
    const { ctx, page } = await open('emergency', '/?view=er');
    await visible(page, 'er-console', 20000);
    await shot(page, 'c-er');
    await shot(page, 'c-er-triage', { scrollTo: 'er-triage' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await t(page, 'er-walkin').click();
    await page.waitForTimeout(600);
    await shot(page, 'c-er-walkin');
    await closeSheet(page);
    const refer = page.locator('[data-testid^="er-refer-0"], [data-testid^="er-refer-"]').filter({ hasText: /referral/i }).first();
    await refer.scrollIntoViewIfNeeded();
    await refer.click();
    await page.waitForTimeout(1500);
    await shot(page, 'c-er-refer');
    await closeSheet(page);
    const admit = page.locator('[data-testid^="er-admit-"]').filter({ hasText: /Admit/ }).first();
    if (await admit.count()) {
      await admit.scrollIntoViewIfNeeded();
      await admit.click();
      await page.waitForTimeout(800);
      await shot(page, 'c-er-admit');
      await closeSheet(page);
    }
    const decline = page.locator('[data-testid^="er-incoming-decline-"]').first();
    if (await decline.count()) {
      await decline.scrollIntoViewIfNeeded();
      await decline.click();
      await page.waitForTimeout(600);
      await shot(page, 'c-er-decline');
      await closeSheet(page);
    }
    await ctx.close();
  });

  // --- Lab ----------------------------------------------------------------------------
  await step('lab', async () => {
    const { ctx, page } = await open('lab', '/?view=lab');
    await visible(page, 'lab-console', 20000);
    await shot(page, 'c-lab');
    const reveal = page.locator('[data-testid^="lab-reveal-"]').first();
    await reveal.click();
    await page.waitForTimeout(1000);
    await shot(page, 'c-lab-patient');
    const upload = page.locator('[data-testid^="lab-upload-"]').first();
    await upload.scrollIntoViewIfNeeded();
    await upload.click();
    await page.waitForTimeout(800);
    await shot(page, 'c-lab-upload');
    await closeSheet(page);
    const reported = page.getByTestId('lab-filters').getByRole('button', { name: /Reported/ });
    if (await reported.count()) {
      await reported.first().click();
      await page.waitForTimeout(1000);
      await shot(page, 'c-lab-reported');
    }
    await ctx.close();
  });

  // --- Pharmacy ------------------------------------------------------------------------
  await step('pharmacy', async () => {
    const { ctx, page } = await open('pharmacy', '/?view=pharmacy');
    await visible(page, 'pharmacy-console', 20000);
    await shot(page, 'c-pharmacy');
    await t(page, 'pharmacy-search').fill('Napa');
    await page.waitForTimeout(800);
    await shot(page, 'c-pharmacy-search');
    await ctx.close();
  });

  // --- Administration: today and reports ------------------------------------------------
  const { ctx: aCtx, page: a } = await open('hospital_admin', '/?view=admin');
  const nav = async (name) => {
    await a.locator('.cf-nav').getByRole('button', { name }).first().click();
    await a.waitForTimeout(1200);
  };
  /** A fresh dashboard, so a panel left open by a failed step blocks nothing. */
  const fresh = async () => {
    await a.goto(L.CONSOLE + '/?view=admin');
    await visible(a, 'admin-now', 20000);
    const discard = a.getByTestId('management-discard');
    if (await discard.count()) await discard.first().click().catch(() => {});
  };
  await step('admin-today', async () => {
    await visible(a, 'admin-now', 20000);
    await shot(a, 'c-admin');
    await shot(a, 'c-admin-attention', { scrollTo: 'admin-attention' });
    await shot(a, 'c-admin-chambers', { scrollTo: 'admin-chambers' });
    await shot(a, 'c-admin-figures', { scrollTo: 'admin-today-figures' });
  });
  await step('admin-reports', async () => {
    await nav(/^Reports/);
    await a.waitForTimeout(1500);
    await shot(a, 'c-reports');
    const tabs = a.locator('[data-testid^="admin-tab-"]');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const id = await tabs.nth(i).getAttribute('data-testid');
      await tabs.nth(i).click();
      await a.waitForTimeout(1500);
      await shot(a, `c-reports-${id.replace('admin-tab-', '')}`);
    }
  });

  // --- Administration: staff, doctors, desks, departments -------------------------------
  let tempEmail = null;
  let tempPassword = null;
  await step('admin-staff', async () => {
    await nav(/^Staff/);
    await visible(a, 'management-add', 15000);
    await shot(a, 'c-staff');
    const person = a.locator('[data-testid^="management-change-"]').first();
    if (await person.count()) {
      await person.click();
      await a.waitForTimeout(1000);
      await shot(a, 'c-staff-person');
      await t(a, 'management-close').click().catch(() => closeSheet(a));
      await a.waitForTimeout(600);
    }
    await t(a, 'management-add').click();
    await a.waitForTimeout(800);
    const form = a.getByTestId('settings-add-staff');
    tempEmail = `reception3.${Date.now()}@shapla-general.demo.invalid`;
    await form.getByLabel(/Full name/).fill('Nasrin Akter (Demo)');
    await form.getByLabel(/^Email/).fill(tempEmail);
    await shot(a, 'c-staff-add');
    await t(a, 'settings-add-staff-submit').click();
    await a.waitForTimeout(800);
    const confirm = a.getByTestId('management-confirm-save');
    if (await confirm.count()) {
      await shot(a, 'c-staff-confirm');
      await confirm.first().click();
    }
    await visible(a, 'settings-temp-password-value', 15000);
    tempPassword = ((await t(a, 'settings-temp-password-value').textContent()) ?? '').trim();
    await shot(a, 'c-staff-temp-password');
    await t(a, 'management-close').click().catch(() => closeSheet(a));
  });
  await step('admin-desks', async () => {
    await fresh();
    await nav(/^Staff/);
    await t(a, 'management-group-desks').click();
    await a.waitForTimeout(1000);
    await shot(a, 'c-desks');
    await t(a, 'management-group-access').click().catch(() => {});
    await a.waitForTimeout(1000);
    await shot(a, 'c-access');
  });
  await step('admin-doctors', async () => {
    await fresh();
    await nav(/^Doctors/);
    await a.waitForTimeout(1000);
    await shot(a, 'c-doctors');
    const person = a.locator('[data-testid^="management-change-"]').first();
    if (await person.count()) {
      await person.click();
      await a.waitForTimeout(1000);
      await shot(a, 'c-doctor-person');
      await t(a, 'management-close').click().catch(() => closeSheet(a));
    }
    await t(a, 'management-group-departments').click().catch(() => {});
    await a.waitForTimeout(1000);
    await shot(a, 'c-departments');
  });

  // --- Settings ----------------------------------------------------------------------------
  await step('settings', async () => {
    await fresh();
    await nav(/^Settings/);
    await visible(a, 'settings-status', 15000);
    await shot(a, 'c-settings');
    for (const group of ['profile', 'face', 'rules', 'beds', 'capabilities', 'identity', 'sms']) {
      const g = a.getByTestId(`settings-group-${group}`);
      if (!(await g.count())) continue;
      await g.first().click();
      await a.waitForTimeout(1200);
      await shot(a, `c-settings-${group}`);
      if (group === 'face') {
        for (const [part, id] of [
          ['logo', 'settings-logo'],
          ['brand', 'settings-brand'],
          ['publishing', 'settings-publishing'],
        ]) {
          if (await a.getByTestId(id).count()) await shot(a, `c-settings-${part}`, { scrollTo: id });
        }
      }
      const back = a.getByTestId('settings-back');
      if (await back.count()) await back.first().click();
      else await nav(/^Settings/);
      await a.waitForTimeout(800);
    }
  });

  // --- Data import ---------------------------------------------------------------------------
  await step('import', async () => {
    await a.goto(L.CONSOLE + '/?view=imports');
    await visible(a, 'hospital-import', 20000);
    await shot(a, 'c-import');
    // Set B, the patient register.
    await a.getByRole('button', { name: /Patient register/ }).first().click();
    await a.waitForTimeout(600);
    await shot(a, 'c-import-set-b');
    const csv = readFileSync(require('node:path').join(__dirname, '../../database/seeds/samples/hospital-export-patients.csv'));
    await t(a, 'import-file').setInputFiles({ name: 'hospital-export-patients.csv', mimeType: 'text/csv', buffer: csv });
    await a.waitForTimeout(500);
    await t(a, 'import-check').click();
    await a.waitForTimeout(3000);
    if (await a.getByTestId('import-mapping').count()) {
      await shot(a, 'c-import-mapping');
      await shot(a, 'c-import-mapping-detail', { scrollTo: 'map-confirm' });
      await t(a, 'map-confirm').click();
      await a.waitForTimeout(3000);
    }
    await visible(a, 'import-preview', 20000);
    await shot(a, 'c-import-preview');
    await t(a, 'import-commit').click();
    await a.waitForTimeout(800);
    await shot(a, 'c-import-confirm');
    await t(a, 'import-confirm-yes').click();
    await a.waitForTimeout(3500);
    await shot(a, 'c-import-done');
    await shot(a, 'c-import-history', { scrollTo: 'import-history' });
  });
  await aCtx.close();

  // --- A new member of staff signs in with a temporary password -----------------------------
  await step('change-password', async () => {
    if (!tempPassword) return;
    const ctx = await L.newContext(browser);
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + '/?login=1');
    await visible(page, 'staff-login');
    await t(page, 'login-email').fill(tempEmail);
    await t(page, 'login-password').fill(tempPassword);
    await t(page, 'login-submit').click();
    await visible(page, 'change-password', 20000);
    await shot(page, 'c-change-password');
    await ctx.close();
  });

  // --- Platform onboarding ------------------------------------------------------------------------
  await step('platform', async () => {
    const { ctx, page } = await open('platform_admin', '/?view=platform', { hospital: null });
    await visible(page, 'platform-console', 20000);
    await shot(page, 'c-platform');
    await t(page, 'platform-row-SHAPLA').click();
    await visible(page, 'platform-workspace', 15000);
    await page.waitForTimeout(1200);
    await shot(page, 'c-platform-workspace');
    // The workspace's sections are tabs: each is opened and shown.
    for (const section of ['readiness', 'services', 'access', 'health']) {
      const tab = page.getByTestId(`platform-section-${section}`);
      if (!(await tab.count())) continue;
      await tab.first().click();
      await page.waitForTimeout(1200);
      await shot(page, `c-platform-${section}`);
      if (section === 'access' || section === 'health') {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(600);
        await shot(page, `c-platform-${section}-more`);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
    const applied = page.locator('[data-testid^="platform-row-"]').filter({ hasText: /Nodi/ }).first();
    if (await applied.count()) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await applied.click();
      await page.waitForTimeout(1200);
      await shot(page, 'c-platform-applied');
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await t(page, 'platform-new').click();
    await visible(page, 'platform-new-form');
    const form = page.getByTestId('platform-new-form');
    const code = `RIVER${String(Date.now()).slice(-3)}`;
    await form.getByLabel(/Hospital name \(Bangla\)/).fill('নদীতীর হাসপাতাল (ডেমো)');
    await form.getByLabel(/Hospital name \(English\)/).fill('Riverside Hospital (Demo)');
    await form.getByLabel(/Hospital code/).fill(code);
    await form.getByLabel(/Registration|licen/i).first().fill('DGHS-DEMO-0042').catch(() => {});
    await form.getByRole('button', { name: /^Private hospital/ }).first().click().catch(() => {});
    await form.getByRole('button', { name: /^Dhaka$/ }).first().click().catch(() => {});
    await form.getByLabel(/^District/).fill('Dhaka').catch(() => {});
    await form.getByLabel(/First administrator.s name/).fill('Riverside Admin (Demo)');
    await form.getByLabel(/First administrator.s email/).fill(`admin-${code.toLowerCase()}@onboarding.demo.invalid`);
    await shot(page, 'c-platform-new', { scrollTo: 'platform-create' });
    await t(page, 'platform-create').click();
    // A review of what will be created comes first.
    const save = page.getByTestId('management-confirm-save');
    await save.first().waitFor({ state: 'visible', timeout: 15000 });
    await shot(page, 'c-platform-review');
    await save.first().click();
    await visible(page, 'platform-created', 15000);
    await shot(page, 'c-platform-created');
    await ctx.close();
  });

  // --- National dashboard -----------------------------------------------------------------------
  await step('gov', async () => {
    const { ctx, page } = await open('gov_viewer', '/?view=gov', { hospital: null });
    await visible(page, 'gov-dashboard', 20000);
    for (const tab of ['capacity', 'er', 'signals', 'benchmarks']) {
      await t(page, `gov-tab-${tab}`).click();
      await page.waitForTimeout(1500);
      await shot(page, `c-gov-${tab}`);
    }
    await ctx.close();
  });

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
