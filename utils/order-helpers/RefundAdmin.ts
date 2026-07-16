import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { AdminAuthPage } from '../../pages/AdminAuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC, closePaymentSuccess } from '../PaymentFlowHelper';
import { TransactionChecker } from '../transactionChecker';
import { CARDS } from '../../config/cards.config';
import { API_CONFIG } from '../../config/api.config';
import { assertField, assertCondition } from '../assertions';

const OP = 'Admin refund — verification';

interface RefundOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  refundAmount: number;
  ibanToCheck: string;
  balancePhone?: string; // ბალანსის/fee-ს device login ნომერი (default 591078180; 591030201 — receiver commission)
  refundVia?: 'INTEGRATOR' | 'ADMIN'; // refund-ის მხარე: INTEGRATOR (ecommerce, default) | ADMIN (admin panel endpoint, tx id-ზე)
}

export class RefundAdmin {
  private request: APIRequestContext;
  private integratorOrderId: string = '';

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayOrder(config: RefundOrderConfig) {
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

    // Save integratorOrderId for refund
    this.integratorOrderId = integratorOrderId;

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

    // Transaction status შემოწმება და განახლება
    const txChecker = new TransactionChecker(this.request);
    await txChecker.checkTransactionStatus(config.ibanToCheck);

    console.log('✅ 4. Payment Status Confirmed');

    // ბალანსი refund-ის წინ (merchant-ის device token-ით: default 591078180 ან 591030201)
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.balancePhone || '591078180');
    const balanceBefore = await this.getBalance(deviceToken);

    // Refund API call
    console.log(`\n🔄 5. Refunding: ${config.refundAmount} GEL`);
    await this.refundOrder(accessToken, config);

    // Refund verification — ვაცდით სანამ refund აისახება ტრანზაქციაში, ვიღებთ tx-ს
    const transaction = await this.verifyRefund(config);

    // ბალანსი refund-ის შემდეგ + შედარება
    const balanceAfter = await this.getBalanceAfterSettle(deviceToken, balanceBefore);
    this.verifyBalance(config, transaction, balanceBefore, balanceAfter);
  }

  /**
   * GEL ბალანსის წამოღება (merchant-balance)
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
   * ბალანსს ვაპოლინგებთ სანამ balanceBefore-ისგან შეიცვლება (admin refund async-ად აისახება),
   * ან timeout — მაშინ უცვლელი (insufficient balance-ის ქეისი).
   */
  private async getBalanceAfterSettle(token: string, balanceBefore: number): Promise<number> {
    let latest = balanceBefore;
    for (let i = 0; i < 15; i++) {
      latest = await this.getBalance(token);
      if (Math.abs(latest - balanceBefore) > 0.001) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return latest;
  }

  /**
   * ბალანსის შედარება — რამდენი მოაკლდა refund-ის შემდეგ:
   *   full refund    → acquiringAmount (sender: amount+fee | receiver: amount — commission-ს receiver ფარავს)
   *   partial refund → refundAmount
   *   insufficient   → 0 (ბალანსზე ნაკლები refund → არ აკლდება)
   */
  private verifyBalance(config: RefundOrderConfig, tx: any, balanceBefore: number, balanceAfter: number) {
    const isFull = config.refundAmount === config.amount;
    const requested = isFull ? (tx?.acquiringAmount ?? config.amount) : config.refundAmount;
    const insufficient = balanceBefore < requested;
    const expected = insufficient ? 0 : requested;

    const actual = Math.round((balanceBefore - balanceAfter) * 100) / 100;
    const expectedRounded = Math.round(expected * 100) / 100;
    const requestedRounded = Math.round(requested * 100) / 100;
    const label = isFull ? 'FULL' : 'PARTIAL';
    const ok = Math.abs(actual - expectedRounded) < 0.001;

    if (insufficient) {
      // არასაკმარისი ბალანსი — refund მაინც ხდება, მაგრამ ბალანსიდან არ აკლდება
      console.log(`\n📊 მოსალოდნელი შედეგი — Admin refund — არასაკმარისი ბალანსი`);
      console.log(`   დაბრუნდა: ${config.refundAmount} ₾ (refund მაინც მოხდა)`);
      console.log(`   ანგარიშზე იყო მხოლოდ ${balanceBefore} ₾, მოთხოვნილი refund ${requestedRounded} ₾ (${requestedRounded} > ${balanceBefore}) → ბალანსი არ უნდა შეიცვალოს`);
      console.log(`   ბალანსი: იყო ${balanceBefore} ₾ → გახდა ${balanceAfter} ₾ (მოაკლდა ${actual} ₾)`);
      console.log(ok
        ? `   ✅ ბალანსი უცვლელი — არასაკმარისი ბალანსის გამო არ მოაკლდა`
        : `   ❌ ბალანსი შეიცვალა — არ უნდა შეცვლილიყო (მოაკლდა ${actual} ₾)`);
    } else {
      console.log(`\n📊 მოსალოდნელი შედეგი — Admin refund (${label})`);
      console.log(`   დაბრუნდა: ${config.refundAmount} ₾`);
      console.log(`   ბალანსს უნდა მოაკლდეს: ${expectedRounded} ₾`);
      console.log(`   ბალანსი: იყო ${balanceBefore} ₾ → გახდა ${balanceAfter} ₾ (მოაკლდა ${actual} ₾)`);
      console.log(ok
        ? `   ✅ ბალანსი სწორად შემცირდა`
        : `   ❌ ბალანსი არასწორად შეიცვალა — მოაკლდა ${actual} ₾, უნდა ${expectedRounded} ₾`);
    }

    assertCondition(
      OP,
      ok,
      `ბალანსი არასწორად შეიცვალა (მოაკლდა ${actual}, უნდა ${expectedRounded})`,
      insufficient
        ? `არასაკმარისი ბალანსი (${balanceBefore} < ${requestedRounded}) → არ უნდა შეიცვალოს`
        : `უნდა მოკლებოდა ${expectedRounded}`,
      { balanceBefore, balanceAfter, actual, expected: expectedRounded, requested: requestedRounded, insufficient }
    );
  }

  /** refund-ის მხარის არჩევა: ADMIN panel (tx id) ან INTEGRATOR (ecommerce, encrypted) */
  private async refundOrder(accessToken: string, config: RefundOrderConfig) {
    if (config.refundVia === 'ADMIN') {
      await this.refundViaAdmin(config);
    } else {
      await this.refundViaIntegrator(accessToken, config);
    }
  }

  /**
   * ADMIN panel refund — genericTransactionId-ზე (admin token, device-ის გარეშე).
   * full refund → amount: null | partial → amount: refundAmount.
   */
  private async refundViaAdmin(config: RefundOrderConfig) {
    const adminToken = await new AdminAuthPage(this.request).authenticate();
    const isFull = config.refundAmount === config.amount;

    // ჩვენი ტრანზაქცია admin filter-ით (IBAN-ით, უახლესი) → genericTransactionId = tx.id
    const filterResp = await this.request.post(
      'https://newadmin.dev.keepz.me/api/transaction/filter',
      { headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, data: {} }
    );
    const tx = (await filterResp.json()).value.content.find((t: any) => t.iban === config.ibanToCheck);

    // ⚠️ refund არის PUT (POST → 500)
    const response = await this.request.put(
      'https://newadmin.dev.keepz.me/api/transaction/refund',
      {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        data: { amount: isFull ? null : config.refundAmount, genericTransactionId: tx?.id },
      }
    );

    if (!response.ok()) {
      throw new Error(`Admin refund failed: ${response.status()} - ${await response.text()}`);
    }
  }

  private async refundViaIntegrator(accessToken: string, config: RefundOrderConfig) {
    const paymentPage = new PaymentPage(this.request, null as any);

    // Step 1: Encrypt refund data
    const refundData = {
      integratorId: config.integratorId,
      integratorOrderId: this.integratorOrderId,
      refundInitiator: 'INTEGRATOR',
      amount: config.refundAmount,
    };

    const encrypted = await (paymentPage as any).encryptOrderData(accessToken, refundData);

    // Step 2: Call refund endpoint
    const response = await this.request.post(
      `${API_CONFIG.ECOMMERCE.BASE_URL}${API_CONFIG.ECOMMERCE.ENDPOINTS.REFUND}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          identifier: config.integratorId,
          encryptedData: encrypted.encryptedData,
          aes: true,
          encryptedKeys: encrypted.encryptedKeys,
        },
      }
    );

    if (!response.ok()) {
      const errorBody = await response.text();
      throw new Error(`Refund failed: ${response.status()} - ${errorBody}`);
    }
  }

  /**
   * Refund-ის ვერიფიკაცია ტრანზაქციიდან (balance-diff-ის ნაცვლად — უფრო საიმედო).
   * ვამოწმებთ: refundInfo (REFUNDED/PARTIALLY_REFUNDED) + initialRefundAmount === refundAmount.
   * ტრანზაქციას IBAN-ით ვპოულობთ (უახლესი ჩანაწერი მაგ IBAN-ზე). refund-ის აისახება
   * დაგვიანებით, ამიტომ ვაპოლინგებთ.
   */
  private async verifyRefund(config: RefundOrderConfig): Promise<any> {
    const adminToken = await new AdminAuthPage(this.request).authenticate();
    const isFull = config.refundAmount === config.amount;
    const expectedRefundInfo = isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    let transaction: any;
    let expectedRefunded = config.refundAmount;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const resp = await this.request.post(
        `${API_CONFIG.ADMIN.BASE_URL}${API_CONFIG.ADMIN.ENDPOINTS.TRANSACTION_FILTER}`,
        { headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, data: {} }
      );
      transaction = (await resp.json()).value.content.find((t: any) => t.iban === config.ibanToCheck);

      // full refund → სრული acquiringAmount ბრუნდება (sender: amount+fee), partial → refundAmount.
      // ველოდებით სანამ refund აისახება (initialRefundAmount === მოსალოდნელი)
      if (transaction) {
        expectedRefunded = isFull ? (transaction.acquiringAmount ?? config.amount) : config.refundAmount;
        if (Math.abs((transaction.initialRefundAmount || 0) - expectedRefunded) < 0.001) break;
      }
    }

    assertCondition(
      OP,
      !!transaction,
      'ტრანზაქცია ვერ მოიძებნა',
      `ტრანზაქცია IBAN ${config.ibanToCheck}-ზე`,
      { found: !!transaction }
    );

    // 1. რამდენი დარეფანდა — full → acquiringAmount (sender: amount+fee), partial → refundAmount
    assertField(OP, transaction, 'initialRefundAmount', expectedRefunded);

    // 2. refund status
    assertField(OP, transaction, 'refundInfo', expectedRefundInfo);

    console.log(`\n📊 შედეგი — ${expectedRefundInfo}`);
    console.log(`   tx ${transaction.id}: initialAmount ${transaction.initialAmount} ₾ | acquiringAmount ${transaction.acquiringAmount} ₾`);
    console.log(`   receiverCommission ${transaction.receiverCommissionPercent}% | senderCommission ${transaction.senderCommissionPercent}%`);
    console.log(`   დარეფანდა: ${transaction.initialRefundAmount} ₾  |  მოსალოდნელი: ${expectedRefunded} ₾  ✅`);

    return transaction;
  }
}
