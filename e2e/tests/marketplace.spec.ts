import { expect, test, type Browser, type Page } from '@playwright/test';
import { PORTAL, WEB } from '../urls';

/**
 * The full advocate-marketplace journey, driven through the real UIs of both
 * apps against a real API and database:
 *
 *   advocate registers -> admin verifies -> consumer books -> advocate accepts
 *   -> consumer tries to pay (gateway not configured) -> advocate completes and
 *   closes -> each side sees the right notifications.
 *
 * Each persona gets its own browser context, so their sessions (localStorage
 * tokens) never mix — exactly like three different people.
 */

const runId = process.env.E2E_RUN_ID ?? Date.now().toString(36);
const PASSWORD = 'correct horse battery staple';
const advocate = {
  email: `e2e-adv-${runId}@example.com`,
  name: `Adv. E2E ${runId}`,
};
const consumerEmail = `e2e-consumer-${runId}@example.com`;
const topic = `E2E vendor contract ${runId}`;

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe.serial('advocate marketplace journey', () => {
  let advocatePage: Page;
  let adminPage: Page;
  let consumerPage: Page;

  test.beforeAll(async ({ browser }) => {
    advocatePage = await newPage(browser);
    adminPage = await newPage(browser);
    consumerPage = await newPage(browser);
  });

  test('an advocate registers and awaits verification', async () => {
    const page = advocatePage;
    await page.goto(`${PORTAL}/register`);
    await page.getByLabel('Email').fill(advocate.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Full name').fill(advocate.name);
    await page.getByLabel('State').fill('KA');
    await page.getByLabel('City').fill('Bengaluru');
    await page.getByLabel('Practice areas').fill('CONTRACT_LAW');
    await page.getByLabel('Languages').fill('en');
    await page.getByLabel('Consultation fee (₹)').fill('1500');
    await page.getByLabel('Years of experience').fill('6');
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page).toHaveURL(/\/profile$/);

    await page.goto(`${PORTAL}/`);
    await expect(page.getByText('Awaiting verification')).toBeVisible();
  });

  test('an admin verifies the advocate', async () => {
    const page = adminPage;
    await page.goto(`${WEB}/login`);
    await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL ?? '');
    await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD ?? '');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/profile$/);

    await page.goto(`${WEB}/admin/advocates`);
    const card = page.locator('li', { hasText: advocate.email });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Verify' }).click();
    await expect(card).toHaveCount(0);

    // The action is recorded in the audit log.
    await page.goto(`${WEB}/admin/audit`);
    await expect(page.getByRole('cell', { name: 'advocate.verified' }).first()).toBeVisible();
  });

  test('a consumer finds the advocate and books a consultation', async () => {
    const page = consumerPage;
    await page.goto(`${WEB}/register`);
    await page.getByLabel('Email').fill(consumerEmail);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/profile$/);

    await page.goto(`${WEB}/advocates`);
    await page.getByRole('link', { name: new RegExp(advocate.name) }).click();
    await expect(page.getByRole('heading', { name: advocate.name })).toBeVisible();

    await page.getByLabel('Topic').fill(topic);
    await page.getByLabel('Describe what you need help with').fill('Termination clause review.');
    await page.getByRole('button', { name: 'Request consultation' }).click();
    await expect(page.getByText('Request sent.')).toBeVisible();
  });

  test('the advocate is notified and accepts with a schedule', async () => {
    const page = advocatePage;
    await page.goto(`${PORTAL}/`);
    await expect(page.getByRole('link', { name: /Notifications, \d+ unread/ })).toBeVisible();

    await page.goto(`${PORTAL}/notifications`);
    await expect(page.getByText('New consultation request')).toBeVisible();

    await page.goto(`${PORTAL}/consultations`);
    const card = page.locator('li', { hasText: topic });
    await card.getByRole('button', { name: 'Accept' }).click();
    await card.getByLabel('Scheduled date & time').fill('2030-01-15T10:30');
    await card.getByLabel(/Meeting link/).fill('https://meet.example.com/e2e');
    await card.getByRole('button', { name: 'Confirm accept' }).click();
    await expect(card.getByText('Scheduled', { exact: true })).toBeVisible();
  });

  test('the consumer sees the schedule; checkout reports the gateway is not configured', async () => {
    const page = consumerPage;
    await page.goto(`${WEB}/consultations`);
    const card = page.locator('li', { hasText: topic });
    await expect(card.getByText('Scheduled', { exact: true })).toBeVisible();
    await expect(card.getByText(/Unpaid/)).toBeVisible();

    await card.getByRole('button', { name: /^Pay / }).click();
    await expect(card.getByRole('alert')).toContainText("Payments aren't configured");

    await page.goto(`${WEB}/notifications`);
    await expect(page.getByText('Your consultation was accepted')).toBeVisible();
  });

  test('the advocate completes and closes the matter; the consumer is told', async () => {
    const page = advocatePage;
    await page.goto(`${PORTAL}/consultations`);
    const card = page.locator('li', { hasText: topic });
    await card.getByLabel(/Matter notes/).fill('Advised on clause 4.2.');
    await card.getByRole('button', { name: 'Mark completed' }).click();
    await card.getByRole('button', { name: 'Close matter' }).click();
    await expect(card.getByText('Closed', { exact: true })).toBeVisible();

    await consumerPage.goto(`${WEB}/notifications`);
    await expect(consumerPage.getByText('Your consultation is complete')).toBeVisible();
    // Private matter notes never reach the consumer.
    await consumerPage.goto(`${WEB}/consultations`);
    await expect(consumerPage.getByText('Advised on clause 4.2.')).toHaveCount(0);
  });

  test('a consumer cannot open the admin console', async () => {
    await consumerPage.goto(`${WEB}/admin`);
    // (Not getByRole('alert'): Next's route announcer also has role="alert".)
    await expect(
      consumerPage.getByText('The admin console is only available to administrator accounts.'),
    ).toBeVisible();
  });
});
