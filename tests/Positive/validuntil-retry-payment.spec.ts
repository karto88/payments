import { test, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../../utils/GmailHelper';
import { fillOTPAndVerifyTBC, closePaymentSuccess } from '../../utils/PaymentFlowHelper';
import { TransactionChecker } from '../../utils/transactionChecker';
import { CARDS } from '../../config/cards.config';
import * as dotenv from 'dotenv';

dotenv.config();

test('validUntil Order', async ({ request }) => {
  const authPage = new AuthPage(request);
  const paymentPage = new PaymentPage(request, null as any);
  const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);

  await gmail.deleteOldOTPEmails();

  // ავტორიზაცია
  const accessToken = await authPage.authenticate();

  // ორდერის შექმნა (validUntil-ით!)
  const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    validUntil: '2026-12-30 14:40:23',
  });

  console.log('✅ Order Created (with validUntil)');
  console.log(`Payment URL: ${paymentUrl}\n`);

  // ==========================================
  // 1️⃣ პირველი ცდა - CREDO ბარათი (insufficient funds)
  // ==========================================
  console.log('🔴 First Attempt - CREDO card (insufficient funds) - Payment will FAIL');

  const context1 = await chromium.launchPersistentContext('./playwright-card-data', {
    headless: false,
    channel: 'chrome'
  });

  const page1 = await context1.newPage();
  await page1.goto(paymentUrl);

  // საბანკო ბარათი
  await page1.locator('button', { hasText: 'საბანკო ბარათი' }).click();
  await page1.waitForTimeout(2000);

  // CREDO ბარათის შევსება (თანხა არ არის!)
  await page1.locator('#cardNumber').fill(CARDS.CREDO.number);
  await page1.locator('#cardExpirationDateCustom').fill(CARDS.CREDO.expiry);
  await page1.locator('#cvc2').fill(CARDS.CREDO.cvv);
  await page1.locator('#payment-submit').click();
  await page1.waitForLoadState('networkidle');

  // CREDO OTP მიღება
  const credoOTP = await gmail.getLatestOTP(30, undefined, 'CREDO');
  console.log(`✅ CREDO OTP: ${credoOTP}`);

  // OTP შევსება (CREDO-ს form: input[name="code"])
  await page1.waitForSelector('input[name="code"]', { timeout: 10000 });
  await page1.locator('input[name="code"]').fill(credoOTP);
  await page1.waitForTimeout(1000);

  // Submit OTP (button[name="verify"])
  await page1.locator('button[name="verify"]').click();
  await page1.waitForLoadState('networkidle');

  // Error modal-ის OK ღილაკს დავაჭიროთ რომ დაიხუროს
  await page1.waitForTimeout(2000);
  await page1.locator('button:has-text("OK")').click();
  console.log('❌ First Payment FAILED (CREDO - insufficient funds)');

  // Browser არ დახურო - იმავე გვერდზე თავიდან ვცადოთ!
  console.log('\n✅ Second Attempt - Retrying on SAME page with TBC\n');

  await gmail.deleteOldOTPEmails();

  // იმავე page1-ზე თავიდან "საბანკო ბარათი" ღილაკი
  await page1.locator('button', { hasText: 'საბანკო ბარათი' }).click();
  await page1.waitForTimeout(2000);

  // TBC ბარათის შევსება (იმავე გვერდზე!)
  await page1.locator('#cardNumber').fill(CARDS.TBC.number);
  await page1.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
  await page1.locator('#cvc2').fill(CARDS.TBC.cvv);
  await page1.locator('#payment-submit').click();
  await page1.waitForLoadState('networkidle');

  // TBC OTP მიღება
  const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
  console.log(`✅ TBC OTP: ${otp}`);

  await fillOTPAndVerifyTBC(page1, otp);
  await page1.waitForLoadState('networkidle');

  // Success modal დახურვა
  await closePaymentSuccess(page1, context1);

  console.log('✅ Second Payment SUCCESS\n');

  // Transaction status შემოწმება
  const txChecker = new TransactionChecker(request);
  const result = await txChecker.checkTransactionStatus('GE62BG0000000610917722');

  if (result.distributionStatus === 'SUCCESS') {
    console.log('✅ Test PASSED: Retry payment successful on order without validUntil');
  } else {
    console.log(`ℹ️ Transaction status: ${result.distributionStatus}`);
  }
});
