import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';

interface TIPOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
}

export class TIPPaymentHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayTIPOrder(config: TIPOrderConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    // Gmail helper
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      validUntil: config.validUntil,
    });

    console.log('✅ Order Created');

    // ბრაუზერის გახსნა
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
    });

    const page = await context.newPage();
    await page.goto(paymentUrl);
    console.log('✅ Payment page opened');

    // საბანკო ბარათი
    await page.locator('button', { hasText: 'საბანკო ბარათი' }).click();
    await page.waitForTimeout(2000);

    // TBC ბარათის შევსება
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    // პირველი OTP
    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ OTP: ${otp}`);

    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle');

    // Modal დახურვა - TIP-ის დასატოვებლად
    await page.waitForTimeout(2000);

    try {
      await page.click('svg.absolute.top-5.right-5', { timeout: 3000 });
    } catch {
      try {
        await page.click('.bg-violet', { position: { x: 5, y: 5 }, timeout: 3000 });
      } catch {
        await page.evaluate(() => {
          // @ts-ignore
          const modal = document.querySelector('.fixed.inset-0');
          if (modal) modal.remove();
        });
      }
    }

    await page.waitForTimeout(1000);

    // TIP 20% არჩევა
    await page.locator('button', { hasText: '20%' }).click();
    await page.waitForTimeout(1000);

    // "Send" ღილაკზე კლიკი
    await page.locator('button', { hasText: 'Send' }).click();
    await page.waitForTimeout(2000);

    // მეორე გადახდა - TIP-ის გადახდა (0.03 GEL)
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    // ძველი OTP-ების წაშლა
    await gmail.deleteOldOTPEmails();
    await page.waitForTimeout(2000);

    // ახალი OTP მიღება
    const otp2 = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ TIP OTP: ${otp2}`);

    await fillOTPAndVerifyTBC(page, otp2);
    await page.waitForTimeout(2000);

    // Done ღილაკი
    await page.locator('button.font-semibold.text-base.text-violet.mt-8.mb-5').click();

    console.log('✅ TIP Payment completed\n');
    await page.waitForTimeout(3000);
    await context.close();
  }
}
