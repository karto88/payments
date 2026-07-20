import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { CardPaymentHelper } from '../CardPaymentHelper';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerify, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';

type DirectLinkProvider = 'BOG' | 'TBC';

interface DirectLinkOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  provider: DirectLinkProvider;
}

export class DirectLinkHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayDirectLink(config: DirectLinkOrderConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      validUntil: config.validUntil,
      directLinkProvider: config.provider,
    });

    console.log(`\n✅ Order Created - ${config.provider}`);

    // ბრაუზერის გახსნა
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(paymentUrl);
    console.log('✅ Page loaded');

    // BOG ან TBC-ის მიხედვით სხვადასხვა automation
    if (config.provider === 'BOG') {
      await this.automateBOGPayment(page);
    } else {
      await this.automateTBCPayment(page);
    }

    await closePaymentSuccess(page, context);

    console.log(`✅ ${config.provider} directLinkProvider payment is success`);
  }

  private async automateBOGPayment(page: any) {
    const card = new CardPaymentHelper(page);
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);

    // ბარათის მონაცემების ჩაწერა
    await card.fillCardAndPay(
      CARDS.TBC.number.replace(/(.{4})/g, '$1 ').trim(),
      `${CARDS.TBC.expiry.slice(0, 2)}/${CARDS.TBC.expiry.slice(2)}`,
      CARDS.TBC.cvv
    );
    console.log('✅ Card filled');

    await page.waitForLoadState('networkidle');

    // OTP მიღება
    const otp = await gmail.getLatestOTP(20);
    console.log(`✅ OTP: ${otp}`);

    // OTP შევსება
    await card.fillOTPAndSubmit(otp);
    console.log('✅ Payment completed');
  }

  private async automateTBCPayment(page: any) {
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);

    // ბარათის მონაცემების ჩაწერა
    await page.waitForSelector('#cardNumber', { timeout: 10000 });
    await page.waitForTimeout(1000); // form-ის JS მიბმას მოასწროს

    await page.fill('#cardNumber', CARDS.TBC.number);
    await page.fill('#cardExpirationDateCustom', CARDS.TBC.expiry);
    await page.fill('#cvc2', CARDS.TBC.cvv);
    await page.locator('#cvc2').blur(); // change/blur → ვალიდაცია გააქტიურდეს, submit enable
    await page.waitForTimeout(500);

    console.log('✅ Card filled');

    // submit — actionable-ს დაველოდოთ (button ვალიდაციამდე disabled შეიძლება იყოს)
    await page.locator('#payment-submit').click({ timeout: 20000 });
    console.log('✅ Submit clicked');

    await page.waitForLoadState('networkidle');

    // OTP მიღება
    const otp = await gmail.getLatestOTP(20);
    console.log(`✅ OTP: ${otp}`);

    // OTP შევსება
    await fillOTPAndVerify(page, otp);
  }
}
