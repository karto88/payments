import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerify, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { TransactionChecker } from '../transactionChecker';
import { CARDS } from '../../config/cards.config';

type CardType = 'TBC' | 'BOG';

interface PreAuthOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  cardType: CardType;
}

/**
 * Pre-Authorization — ეტაპი 1 (order + payment).
 *
 * იგივე flow რაც DefaultOrderHelper, ოღონდ ორდერში ემატება მხოლოდ
 * `payWithPreAuth: true`. გადახდის შემდეგ თანხა არ ნაწილდება — ტრანზაქცია
 * რჩება "waiting for signature" სტატუსში, სანამ ცალკე complete/capture
 * endpoint-ით არ დაინიცირდება (ეტაპი 2 — მოგვიანებით).
 */
export class PreAuthHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayOrder(config: PreAuthOrderConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    // Gmail helper
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა — pre-auth flag-ით
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      payWithPreAuth: true,
    });

    console.log('✅ Order Created (payWithPreAuth)');

    // ბრაუზერის გახსნა
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome',
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

    // ტრანზაქციის status-ის შემოწმება — pre-auth-ზე უნდა იყოს TO_BE_CONFIRMED.
    // IBAN არ გამოდგება (ტრანზაქცია ჯერ დაუდასტურებელია), ამიტომ უნიკალური amount-ით ვპოულობთ.
    const txChecker = new TransactionChecker(this.request);
    const { status, transactionId } = await txChecker.getStatusByAmount(config.amount);

    return { integratorOrderId, transactionId, status, accessToken };
  }

  /**
   * ეტაპი 2 — ორდერის დაქომფლითება (complete/capture).
   * @param accessToken - ეტაპ 1-ის token (თავიდან აღარ ვამოწმდებით)
   * @param config.transactionId - ეტაპ 1-ის ტრანზაქციის ID (ცალსახად იმავე ტრანზაქციაზე ვმუშაობთ)
   * @param config.completeAmount - რამდენი უნდა დაქომფლითდეს
   */
  async completeOrder(
    accessToken: string,
    config: { integratorId: string; integratorOrderId: string; transactionId: number; completeAmount: number }
  ) {
    const paymentPage = new PaymentPage(this.request, null as any);

    await paymentPage.completePreAuthOrder(accessToken, {
      integratorId: config.integratorId,
      integratorOrderId: config.integratorOrderId,
      amount: config.completeAmount,
    });

    console.log(`✅ Order Completed (amount: ${config.completeAmount})`);

    const txChecker = new TransactionChecker(this.request);

    // ბიჯი 2 — complete-ის შემდეგ ტრანზაქცია უნდა იყოს WAITING_FOR_SIGNATURE (ხელმოსაწერში)
    const afterComplete = await txChecker.getStatusById(config.transactionId);
    console.log(`✅ After complete → ${afterComplete.status}`);

    // ბიჯი 3 — 10წმ დაცდა, მერე ერთხელ update-status (ხელმოწერა), შემდეგ საბოლოო status
    await new Promise(resolve => setTimeout(resolve, 10000));
    await txChecker.signById(config.transactionId);
    const final = await txChecker.getStatusById(config.transactionId, 3);

    return {
      transactionId: final.transactionId,
      afterCompleteStatus: afterComplete.status,
      status: final.status,
    };
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
