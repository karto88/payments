import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerify, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';

type CardType = 'TBC' | 'BOG';

interface SavedCardConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  cardType: CardType;
}

/**
 * Saved Card flow:
 *   1. ორდერის შექმნა — saveCard: true + directLinkProvider: "CREDO"
 *   2. გადახდა — ჩვეულებრივი card-fill + OTP flow (reuse)
 *   3. Card token-ის წამოღება — getCardToken (encrypt → GET card/order-id → decrypt)
 */
export class SavedCardHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createPayAndGetCardToken(config: SavedCardConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    // Gmail helper
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა — saveCard + directLinkProvider CREDO
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      validUntil: config.validUntil,
      saveCard: true,
      directLinkProvider: 'CREDO',
    });

    console.log('✅ Order Created (saveCard + CREDO)');

    // ბრაუზერის გახსნა
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
    });

    const page = await context.newPage();
    await page.goto(paymentUrl);
    console.log('✅ Payment page opened');

    // CREDO direct link — "საბანკო ბარათი" ღილაკი არ არის, პირდაპირ ბარათის ველები ჩნდება
    await page.waitForSelector('#cardNumber', { timeout: 15000 });

    // ბარათის ტიპის მიხედვით შევსება
    if (config.cardType === 'TBC') {
      await this.fillTBCCard(page, gmail);
    } else {
      await this.fillBOGCard(page, gmail);
    }

    await page.waitForLoadState('networkidle');

    // Success modal დახურვა
    await closePaymentSuccess(page, context);

    // Card token-ის წამოღება გადახდის შემდეგ
    const cardData = await paymentPage.getCardToken(
      accessToken,
      config.integratorId,
      integratorOrderId
    );

    return cardData;
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
