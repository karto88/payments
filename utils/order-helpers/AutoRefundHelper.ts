import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';
import { assertCondition, assertField } from '../assertions';

const OP_CANCEL = 'DELETE /order/cancel';
const OP_TX = 'Auto refund — merchant transaction';
const OP_BALANCE = 'Auto refund — merchant balance';

interface AutoRefundConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  phone: string; // BALANCE flow-იანი merchant-ის device login — ბალანსის / ტრანზაქციის შესამოწმებლად
}

/**
 * Auto refund — დაქენსელებულ ორდერზე გადახდა ავტომატურად უნდა დარეფანდდეს:
 *   1. ორდერის შექმნა + გახსნა (ბარათის მონაცემები → OTP გვერდამდე)
 *   2. გადახდამდე ორდერის cancel (PROCESSING) → status CANCELLED
 *   3. OTP-ის შეყვანა — ვიხდით დაქენსელებულ ორდერზე
 *   4. merchant-ის ტრანზაქცია REFUNDED (auto refund)
 *   5. merchant-ის ბალანსი უცვლელი (BALANCE flow — ჩარიცხვა + refund = 0)
 */
export class AutoRefundHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async cancelPayAndCheckAutoRefund(config: AutoRefundConfig) {
    const paymentPage = new PaymentPage(this.request, null as any);

    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ბალანსი ტესტის წინ
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone);
    const balanceBefore = await this.getBalance(deviceToken);
    const lastTxIdBefore = (await this.getTransactions(deviceToken))[0]?.id; // ძველი ტრანზაქციები არ აგვერიოს
    console.log(`✅ Balance before: ${balanceBefore} GEL`);

    // 1. ორდერის შექმნა
    const accessToken = await new AuthPage(this.request).authenticate();
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
    });
    console.log('✅ Order Created');
    console.log(`✅ Payment URL: ${paymentUrl}`);

    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
    });
    const page = await context.newPage();
    await page.goto(paymentUrl);
    console.log('✅ Payment page opened');

    await page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ }).click();
    await page.waitForTimeout(2000);

    // ბარათის მონაცემები → OTP გვერდი (ჯერ არ ვიხდით)
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);
    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    // 2. cancel — გადახდამდე (OTP ჯერ არ შეგვყავს)
    const cancelResult = await paymentPage.cancelOrder(accessToken, config.integratorId, integratorOrderId);
    // ⚠️ API აბრუნებს „CANCELLED" (docs-ში წერია „CANCELED")
    assertField(OP_CANCEL, cancelResult, 'status', 'CANCELLED');
    console.log(`✅ Order canceled → ${cancelResult.status}`);

    // 3. OTP — ვიხდით დაქენსელებულ ორდერზე
    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ OTP: ${otp}`);
    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle');
    try {
      await closePaymentSuccess(page, context);
    } catch {
      await context.close().catch(() => {});
    }

    // 4. ტრანზაქცია — auto refund-ს ველოდებით (async)
    const tx = await this.waitForRefundedTransaction(deviceToken, config.amount, lastTxIdBefore);
    const balanceAfter = await this.getBalance(deviceToken);
    const changed = Math.round((balanceAfter - balanceBefore) * 100) / 100;

    console.log(`\n📊 Auto refund — დაქენსელებულ ორდერზე გადახდა · ${config.amount} GEL`);
    console.log(`   ტრანზაქცია: status=${tx?.status ?? '-'} · refundedAmount=${tx?.refundedAmount ?? '-'} (უნდა იყოს REFUNDED · ${config.amount})`);
    console.log(`   ბალანსი: იყო ${balanceBefore} → დარჩა ${balanceAfter} GEL (ცვლილება ${changed}, უნდა იყოს 0)`);

    assertCondition(
      OP_TX,
      !!tx,
      `merchant-ის ტრანზაქციებში ვერ მოიძებნა ${config.amount} GEL-ის ტრანზაქცია`,
      `ტრანზაქცია initialAmount=${config.amount}`,
      { integratorOrderId }
    );
    assertField(OP_TX, tx, 'status', 'REFUNDED');
    assertField(OP_TX, tx, 'refundedAmount', config.amount);

    // 5. ბალანსი — ჩარიცხვა + auto refund → უცვლელი
    assertCondition(
      OP_BALANCE,
      Math.abs(changed) < 0.001,
      `auto refund-ის შემდეგ ბალანსი შეიცვალა (${changed} GEL)`,
      'ბალანსი უცვლელი — დაქენსელებულ ორდერზე გადახდილი თანხა უკან უნდა დაბრუნდეს',
      { balanceBefore, balanceAfter, changed }
    );
    console.log('   ✅ auto refund შესრულდა, ბალანსი უცვლელია');
  }

  /** ბალანსი GEL (merchant-balance) */
  private async getBalance(token: string): Promise<number> {
    const response = await this.request.get(
      'https://gateway.dev.keepz.me/payment-service/api/v1/merchant-balance',
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const gel = (data.value || []).find((b: any) => b.currency === 'GEL');
    return gel ? gel.amount : 0;
  }

  /** merchant-ის ბოლო ტრანზაქციები (device token) */
  private async getTransactions(token: string): Promise<any[]> {
    const response = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=0&limit=10',
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { sentOrReceived: 'ALL', senderInfo: '', recipientInfo: '' },
      }
    );
    return (await response.json()).value?.transactionsPage?.content || [];
  }

  /** ტესტის შემდეგ შექმნილ ტრანზაქციებში ვეძებთ ჩვენს (initialAmount) — ~60წმ ვაპოლინგებთ სანამ REFUNDED გახდება */
  private async waitForRefundedTransaction(token: string, amount: number, lastTxIdBefore?: string): Promise<any> {
    let tx: any;
    for (let i = 0; i < 20; i++) {
      const transactions = await this.getTransactions(token);
      const idx = transactions.findIndex((t: any) => t.id === lastTxIdBefore);
      const newTxs = idx === -1 ? transactions : transactions.slice(0, idx);
      tx = newTxs.find((t: any) => t.initialAmount === amount);
      if (tx?.status === 'REFUNDED') break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return tx;
  }
}
