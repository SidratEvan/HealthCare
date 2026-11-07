/** Existing V1 regressions now perform the new review step explicitly.
 * Dirty-navigation prompts fail here; they have separate cancellation coverage. */
import { expect, type Page } from '@playwright/test';

import { CONSOLE } from '../../shared/i18n/src/messages.js';

export async function approveManagementWrites(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('management-confirm-save'), async () => {
    const dialog = page.getByTestId('management-confirm').locator('..').locator('..');
    await expect(dialog).not.toContainText(CONSOLE.manageLeaveTitle.bn);
    await expect(dialog).not.toContainText(CONSOLE.manageLeaveTitle.en);
    await page.getByTestId('management-confirm-save').click();
  });
}
export async function managementSection(page: Page, id: string): Promise<void> {
  const close = page.getByTestId('management-close');
  if (await close.isVisible()) await close.click();
  const key =
    id === 'staff'
      ? 'adminNavStaff'
      : id === 'doctors' || id === 'departments'
        ? 'adminNavDoctors'
        : 'adminNavSettings';
  await page
    .locator('.cf-nav')
    .getByRole('button', { name: new RegExp(`${CONSOLE[key].bn}|${CONSOLE[key].en}`) })
    .click();
  await expect(page.getByTestId('hospital-settings')).toBeVisible();
  if (id === 'departments') await page.getByTestId('management-group-departments').click();
  else if (id === 'staff' || id === 'doctors') {
    await page.getByTestId('management-group-home').click();
    await page.getByTestId('management-add').click();
  } else {
    const back = page.getByTestId('settings-back');
    if (await back.isVisible()) await back.click();
    await page.getByTestId(`settings-group-${id}`).click();
  }
}
