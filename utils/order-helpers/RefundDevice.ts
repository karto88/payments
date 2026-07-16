import { APIRequestContext, chromium } from '@playwright/test';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC, closePaymentSuccess } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';
import { assertField, assertCondition } from '../assertions';

const OP = 'Device refund — transaction status';

interface DeviceRefundConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  refundAmount: number;
  phone?: string; // device login ნომერი (default 591078180 — sender commission; 591030201 — receiver commission)
}

export class RefundDevice {
  private request: APIRequestContext;
  private transactionId: number = 0;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayOrder(config: DeviceRefundConfig) {
    const paymentPage = new PaymentPage(this.request, null as any);

    // Gmail helper
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // Device ავტორიზაცია - ერთხელ (phone-ის მიხედვით: default 591078180 ან 591030201)
    const authDevice = new AuthDevicePage(this.request);
    const accessToken = await authDevice.authenticate(config.phone || '591078180');

    // ორდერის შექმნა
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      validUntil: config.validUntil,
    });

    console.log('✅ 1. Order Created');

    // ბრაუზერის გახსნა
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
    });

    const page = await context.newPage();
    await page.goto(paymentUrl);

    // საბანკო ბარათი
    await page.locator('button', { hasText: 'საბანკო ბარათი' }).click();
    await page.waitForTimeout(2000);

    // TBC ბარათის შევსება
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    // OTP
    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ 2. OTP Sent: ${otp}`);

    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle');

    console.log('✅ 3. Payment Successful');

    // Success modal დახურვა
    await closePaymentSuccess(page, context);

    // 5 წამი დაყოვნება
    await new Promise(resolve => setTimeout(resolve, 5000));

    // ტრანზაქციის წამოღება - იმავე token-ით
    const transactions = await this.getTransactionsWithToken(accessToken, 0, 5);

    // პირველი ტრანზაქცია (ID + საკომისიოები) — commission side ტრანზაქციიდანვე ვადგენთ
    const tx = transactions[0];
    this.transactionId = tx.id;
    const senderFee = tx.senderCommissionAmount || 0;
    const receiverFee = tx.receiverCommissionAmount || 0;
    const isReceiverCommission = receiverFee > 0;
    console.log(
      `✅ 4. Transaction ID: ${this.transactionId} (senderFee: ${senderFee}, receiverFee: ${receiverFee})`
    );

    // ბალანსი refund-ის წინ
    const balanceBefore = await this.getBalance(accessToken);

    // Refund API call
    console.log(`\n🔄 5. Refunding: ${config.refundAmount} GEL`);
    await this.refundTransaction(accessToken, config);

    // Verify refund status
    await this.verifyRefund(accessToken, config);

    // ბალანსი refund-ის შემდეგ + სწორად ჩამოჭრის შემოწმება
    const balanceAfter = await this.getBalance(accessToken);
    this.verifyBalanceDeduction(config, { senderFee, receiverFee, isReceiverCommission }, balanceBefore, balanceAfter);
  }

  /**
   * GEL ბალანსის წამოღება (device/API token-ით)
   */
  private async getBalance(token: string): Promise<number> {
    const response = await this.request.get(
      'https://gateway.dev.keepz.me/payment-service/api/v1/merchant-balance',
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const gel = (data.value || []).find((b: any) => b.currency === 'GEL');
    return gel ? gel.amount : 0;
  }

  /**
   * ბალანსიდან სწორად ჩამოჭრის შემოწმება (commission-side-aware, ტრანზაქციიდან):
   *   SENDER commission:   full → amount + senderFee | partial → refundAmount
   *   RECEIVER commission: full → amount            | partial → refundAmount   (best-guess, დასაზუსტებელი observe-ით)
   */
  private verifyBalanceDeduction(
    config: DeviceRefundConfig,
    fees: { senderFee: number; receiverFee: number; isReceiverCommission: boolean },
    balanceBefore: number,
    balanceAfter: number
  ) {
    const { senderFee, receiverFee, isReceiverCommission } = fees;
    const isFull = config.refundAmount === config.amount;
    const actualDeduction = Math.round((balanceBefore - balanceAfter) * 100) / 100;

    let expectedDeduction: number;
    let formula: string;

    if (isReceiverCommission) {
      // receiver commission (პირდაპირი) — refund-ზე ჩამოჭრა
      expectedDeduction = isFull ? config.amount : config.refundAmount;
      formula = isFull
        ? `full → amount = ${config.amount}`
        : `partial → refundAmount = ${config.refundAmount}`;
    } else {
      // sender commission — full = amount + fee; partial = refundAmount
      expectedDeduction = isFull ? config.amount + senderFee : config.refundAmount;
      formula = isFull
        ? `full → amount + fee = ${config.amount} + ${senderFee}`
        : `partial → refundAmount = ${config.refundAmount} (fee გარეშე)`;
    }

    const expectedRounded = Math.round(expectedDeduction * 100) / 100;
    const side = isReceiverCommission ? 'RECEIVER' : 'SENDER';
    const refundLabel = isFull ? 'FULL' : 'PARTIAL';
    const ok = Math.abs(actualDeduction - expectedRounded) < 0.001;

    console.log(`\n📊 მოსალოდნელი შედეგი — Device refund (${refundLabel}) · ${side} commission`);
    console.log(`   დაბრუნდა: ${config.refundAmount} ₾`);
    console.log(`   ბალანსს უნდა მოაკლდეს: ${expectedRounded} ₾ (${formula})`);
    console.log(`   ბალანსი: იყო ${balanceBefore} ₾ → გახდა ${balanceAfter} ₾ (მოაკლდა ${actualDeduction} ₾)`);
    console.log(ok
      ? `   ✅ ბალანსი სწორად შემცირდა`
      : `   ❌ ბალანსი არასწორად შეიცვალა — მოაკლდა ${actualDeduction} ₾, უნდა ${expectedRounded} ₾`);

    assertCondition(
      OP,
      ok,
      `ბალანსიდან არასწორად ჩამოიჭრა (ჩამოიჭრა ${actualDeduction}, უნდა ${expectedRounded})`,
      formula,
      { balanceBefore, balanceAfter, actualDeduction, senderFee, receiverFee }
    );
  }

  private async getTransactionsWithToken(token: string, page: number, limit: number) {
    const response = await this.request.post(
      `https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=${page}&limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        data: {
          sentOrReceived: 'ALL',
          senderInfo: '',
          recipientInfo: ''
        }
      }
    );

    const data = await response.json();
    return data.value?.transactionsPage?.content || [];
  }

  private async refundTransaction(token: string, config: DeviceRefundConfig) {
    // Refund request
    const response = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/refund',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        data: {
          amount: config.refundAmount,
          genericTransactionId: this.transactionId
        }
      }
    );

    console.log(`   Refund response status: ${response.status()}`);

    if (!response.ok()) {
      const errorBody = await response.text();
      throw new Error(`Refund failed: ${response.status()} - ${errorBody}`);
    }

    // თუ response ცარიელია (204 No Content) - ეს ნორმალურია
    const responseText = await response.text();
    if (!responseText) {
      console.log('✅ Refund API call successful (no response body)');
      return null;
    }

    return JSON.parse(responseText);
  }

  private async verifyRefund(token: string, config: DeviceRefundConfig) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log(`\n🔍 Verifying Transaction ID: ${this.transactionId}`);

    // ტრანზაქციების წამოღება - იმავე token-ით
    const transactions = await this.getTransactionsWithToken(token, 0, 20);

    const transaction = transactions.find((t: any) => t.id === this.transactionId);

    // full refund → REFUNDED; partial → PARTIALLY_REFUNDED
    const expectedStatus = config.refundAmount === config.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    // ნამდვილი შემოწმება — არასწორ სტატუსზე ტესტი უნდა ჩავარდეს (assertions.ts)
    assertField(OP, transaction || {}, 'status', expectedStatus);

    console.log(`✅ 6. Refund Verified (${transaction.status})`);
  }
}
