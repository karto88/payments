import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerify, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';

type CardType = 'TBC' | 'BOG';

interface GpsStatusConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  cardType: CardType;
}

export class GpsStatusHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayOrder(config: GpsStatusConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    // Gmail helper
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
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

    // საბანკო ბარათი ღილაკზე click
    await page.locator('button', { hasText: 'საბანკო ბარათი' }).click();
    await page.waitForTimeout(2000);

    // ბარათის ტიპის მიხედვით შევსება
    if (config.cardType === 'TBC') {
      await this.fillTBCCard(page, gmail);
    } else {
      await this.fillBOGCard(page, gmail);
    }

    await page.waitForLoadState('networkidle');

    // Success modal დახურვა
    await closePaymentSuccess(page, context);

    // GPS Status — გადახდის შემდეგ ვამოწმებთ ორდერის სტატუსს/დეტალებს
    console.log('🔍 Fetching order status...');
    const statusDetails = await paymentPage.getOrderStatus(
      accessToken,
      config.integratorId,
      integratorOrderId
    );

    console.log('\n📋 ===== ORDER STATUS =====');
    console.log(JSON.stringify(statusDetails, null, 2));
    console.log('==========================\n');

    return statusDetails;
  }

  private async fillTBCCard(page: any, gmail: GmailHelper) {
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ OTP: ${otp}`);

    await fillOTPAndVerifyTBC(page, otp);
  }

  private async fillBOGCard(page: any, gmail: GmailHelper) {
    await page.locator('#cardNumber').fill(CARDS.BOG.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.BOG.expiry);
    await page.locator('#cvc2').fill(CARDS.BOG.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'BOG');
    console.log(`✅ OTP: ${otp}`);

    await fillOTPAndVerify(page, otp);
  }
}
