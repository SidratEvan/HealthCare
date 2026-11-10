// The new-workspace review and its result, with the parts that matter on screen.
const L = require('./lib.cjs');
const { step, shot } = L;
const t = (page, id) => page.getByTestId(id).first();

(async () => {
  const browser = await L.chromium.launch();
  await step('platform new, review, created', async () => {
    const ctx = await L.newContext(browser, { session: await L.demoSession(null, 'platform_admin') });
    const page = await ctx.newPage();
    await page.goto(L.CONSOLE + '/?view=platform');
    await t(page, 'platform-console').waitFor({ timeout: 20000 });
    await t(page, 'platform-new').click();
    await t(page, 'platform-new-form').waitFor();
    const form = page.getByTestId('platform-new-form');
    const code = `RIVER${String(Date.now()).slice(-3)}`;
    await form.getByLabel(/Hospital name \(Bangla\)/).fill('নদীতীর হাসপাতাল (ডেমো)');
    await form.getByLabel(/Hospital name \(English\)/).fill('Riverside Hospital (Demo)');
    await form.getByLabel(/Hospital code/).fill(code);
    await form.getByLabel(/Registration|licen/i).first().fill('DGHS-DEMO-0042').catch(() => {});
    await form.getByRole('button', { name: /^Private hospital/ }).first().click();
    await form.getByRole('button', { name: /^Dhaka$/ }).first().click();
    await form.getByLabel(/^District/).fill('Dhaka').catch(() => {});
    await form.getByLabel(/First administrator.s name/).fill('Riverside Admin (Demo)');
    await form.getByLabel(/First administrator.s email/).fill(`admin-${code.toLowerCase()}@onboarding.demo.invalid`);
    await t(page, 'platform-create').click();
    const save = page.getByTestId('management-confirm-save');
    await save.first().waitFor({ state: 'visible', timeout: 15000 });
    // The review is taller than the screen: shown on a taller one.
    await page.setViewportSize({ width: 1440, height: 1120 });
    await page.waitForTimeout(600);
    await shot(page, 'c-platform-review');
    await page.setViewportSize({ width: 1440, height: 900 });
    await save.first().click();
    await t(page, 'platform-created').waitFor({ timeout: 15000 });
    await page.getByTestId('platform-created').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -120));
    await page.waitForTimeout(500);
    await shot(page, 'c-platform-created');
    await ctx.close();
  });
  await browser.close();
})();
