import { Page, BrowserContext } from '@playwright/test';

// BOG OTP (input[name="code"])
export async function fillOTPAndVerify(page: Page, otp: string) {
  await page.waitForSelector('input[name="code"]', { timeout: 10000 });
  await page.fill('input[name="code"]', otp);
  await page.click('[name="verify"]');
}

// TBC OTP (#Verification)
export async function fillOTPAndVerifyTBC(page: Page, otp: string) {
  await page.fill('#Verification', otp);
  await page.click('[name="verify"]');
}

/**
 * ღილაკზე დაკლიკება თუ არსებობს (optional ნაბიჯი).
 * 1.5წმ დაცდა — z-[9999] overlay transition-ის გამო.
 */
async function clickIfPresent(page: Page, name: string, label: string) {
  try {
    const btn = page.getByRole('button', { name });
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(1500); // overlay settle
    await btn.click();
    console.log(`✅ Clicked ${label}`);
    await page.waitForTimeout(1500); // შემდეგ გვერდს დაველოდოთ
  } catch {
    console.log(`ℹ️ ${label} not present — გამოვტოვე`);
  }
}

/**
 * success გვერდის modal/Skip/Done-ის დახურვა (browser-ს არ ხურავს).
 * გამოიყენება closePaymentSuccess-შიც და redirect flow-შიც.
 */
export async function dismissSuccessModals(page: Page) {
  // დავლოდოთ success გვერდს
  await page.waitForTimeout(3000);

  // 1️⃣ QR / receipt modal-ის დახურვა (თუ არის)
  try {
    const closeButton = page.locator('svg.absolute.top-5.right-5, button.absolute.top-5.right-5').first();
    await closeButton.waitFor({ state: 'visible', timeout: 5000 });
    await closeButton.click();
    console.log('✅ Closed QR terminal modal');
    await page.waitForTimeout(1000);
  } catch (error) {
    console.log('ℹ️ QR terminal modal not found');
  }

  // 2️⃣ Skip — rating გვერდზე (თუ rating ჩართულია)
  await clickIfPresent(page, 'Skip', 'Skip button');

  // 3️⃣ Done — ბოლო გვერდზე (ცალკე ღილაკი, Skip-ის შემდეგ ჩნდება)
  await clickIfPresent(page, 'Done', 'Done button');
}

export async function closePaymentSuccess(page: Page, context: BrowserContext) {
  await dismissSuccessModals(page);
  await page.waitForTimeout(2000);
  await context.close();
}
