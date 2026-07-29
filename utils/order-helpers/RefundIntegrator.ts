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
import { INTEGRATORS } from '../../config/integrators.config';
import { assertField, assertCondition } from '../assertions';

const OP = 'Integrator refund — verification';

interface IntegratorRefundConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  refundAmount?: number; // omit → FULL refund | present → PARTIAL
  ibanToCheck: string;
  balancePhone?: string; // merchant device login — ბალანსის შესამოწმებლად (591030202 / 591030201)
}

/**
 * INTEGRATOR refund — ecommerce refund encrypt/decrypt flow-ით (admin refund-ისგან სრულად ცალკე).
 * ნაბიჯები:
 *   1. ორდერი + გადახდა → integratorOrderId
 *   2. refund: encrypt(refund data) → POST /order/refund → decrypt (REFUND_REQUESTED)
 *   3. რეალური დადასტურება: admin ტრანზაქცია REFUNDED გახდა (IBAN-ით, poll)
 *      (REFUND_REQUESTED მხოლოდ მოთხოვნაა — რეალურ refund-ს ტრანზაქციის status ადასტურებს.)
 */
export class RefundIntegrator {
  private request: APIRequestContext;
  private integratorOrderId = '';

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayOrder(config: IntegratorRefundConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const accessToken = await authPage.authenticate();

    // 1. ორდერი
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
    });
    this.integratorOrderId = integratorOrderId;
    console.log('✅ 1. Order Created');

    // 2. გადახდა (TBC)
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome',
    });
    const page = await context.newPage();
    await page.goto(paymentUrl);

    await page.locator('button', { hasText: 'საბანკო ბარათი' }).click();
    await page.waitForTimeout(2000);
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);
    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ 2. OTP: ${otp}`);
    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle');
    await closePaymentSuccess(page, context);

    // 3. გადახდის status SUCCESS
    await new TransactionChecker(this.request).checkTransactionStatus(config.ibanToCheck);
    console.log('✅ 3. Payment Status Confirmed');

    // 4. ბალანსი refund-ის წინ (merchant device token-ით)
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.balancePhone || '591078180');
    const balanceBefore = await this.getBalance(deviceToken);

    // 5. INTEGRATOR refund — encrypt → POST → decrypt
    const isFull = config.refundAmount === undefined || config.refundAmount === config.amount;
    console.log(`\n🔄 5. Refunding (${isFull ? 'FULL' : `PARTIAL ${config.refundAmount}`})`);
    const refundResult = await this.refund(accessToken, config, isFull);

    assertCondition(
      OP,
      refundResult?.status === 'REFUND_REQUESTED' && !refundResult?.errorMessage,
      `refund ვერ მოთხოვნდა (status: ${refundResult?.status}, error: ${refundResult?.errorMessage})`,
      'status === REFUND_REQUESTED, errorMessage === null',
      refundResult
    );
    console.log(`✅ 6. Refund requested → ${refundResult.status}`);

    // 6. რეალური დადასტურება — ტრანზაქცია REFUNDED გახდა
    const tx = await this.verifyRefunded(config, isFull);

    // 7. ბალანსის ჩეკი — რამდენი ჰქონდა → რამდენი დარეფანდა → რამდენი დარჩა
    const balanceAfter = await this.getBalanceAfterSettle(deviceToken, balanceBefore);
    const deducted = Math.round((balanceBefore - balanceAfter) * 100) / 100;
    const refunded = Math.round((tx.initialRefundAmount || 0) * 100) / 100;

    console.log(`\n📊 ბალანსი: იყო ${balanceBefore} ₾ → დარჩა ${balanceAfter} ₾ (მოაკლდა ${deducted} ₾) | დარეფანდა ${refunded} ₾`);
    assertCondition(
      OP,
      Math.abs(deducted - refunded) < 0.001,
      `ბალანსი არასწორად შემცირდა — მოაკლდა ${deducted} ₾, დარეფანდა კი ${refunded} ₾`,
      `მოკლებული === დარეფანდილი (${refunded} ₾)`,
      { balanceBefore, balanceAfter, deducted, refunded }
    );
    console.log(`   ✅ ბალანსი სწორად შემცირდა — მოაკლდა ${deducted} ₾ = დარეფანდილი`);
  }

  /**
   * ნეგატიური ქეისი: partial refund (config.refundAmount, მაგ. 0.05) წარმატებით,
   * მერე FULL refund უნდა **დაერორდეს** (უკვე partially refunded-ია), და errored full-ის
   * შემდეგ ბალანსი **უცვლელი** უნდა დარჩეს (errored refund არაფერს ჭრის).
   */
  async partialThenFullBalanceUnchanged(config: IntegratorRefundConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const accessToken = await authPage.authenticate();

    // 1. ორდერი
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
    });
    this.integratorOrderId = integratorOrderId;
    console.log('✅ 1. Order Created');

    // 2. გადახდა (TBC)
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome',
    });
    const page = await context.newPage();
    await page.goto(paymentUrl);
    await page.locator('button', { hasText: 'საბანკო ბარათი' }).click();
    await page.waitForTimeout(2000);
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);
    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');
    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ 2. OTP: ${otp}`);
    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle');
    await closePaymentSuccess(page, context);

    // 3. გადახდის status SUCCESS
    await new TransactionChecker(this.request).checkTransactionStatus(config.ibanToCheck);
    console.log('✅ 3. Payment Status Confirmed');

    // 4. ბალანსი partial-ის წინ — ვაცდით დასტაბილურდეს (ძველი refund-settlement ჩაჯდეს, სუფთა baseline)
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.balancePhone || '591078180');
    const balanceBeforePartial = await this.getStableBalance(deviceToken);
    console.log(`✅ 4. Balance before partial (stable): ${balanceBeforePartial} ₾`);

    // 5. PARTIAL refund (config.refundAmount) — წარმატებით
    console.log(`\n🔄 Partial refund (${config.refundAmount})`);
    const partial = await this.refund(accessToken, config, false);
    assertCondition(
      OP,
      partial?.status === 'REFUND_REQUESTED' && !partial?.errorMessage,
      `partial refund ვერ მოთხოვნდა (status: ${partial?.status}, error: ${partial?.errorMessage})`,
      'partial → REFUND_REQUESTED',
      partial
    );
    await this.verifyRefunded(config, false); // PARTIALLY_REFUNDED
    const balanceAfterPartial = await this.getBalanceAfterSettle(deviceToken, balanceBeforePartial);
    console.log(`✅ Partial refunded → ბალანსი: ${balanceBeforePartial} → ${balanceAfterPartial} ₾`);

    // 6. FULL refund — request მიიღება (REFUND_REQUESTED), მაგრამ უკვე partially refunded-ია,
    //    ამიტომ რეალურად არ სრულდება (მომენტში შეიძლება მოეჭრას, მაგრამ ბალანსი უნდა დაბრუნდეს).
    console.log(`\n🔄 Full refund (partial-ის მერე)`);
    const full = await this.refund(accessToken, config, true); // isFull → amount არ იგზავნება
    console.log(`   full refund response → status: ${full?.status}, error: ${full?.errorMessage}`);

    // 7. FULL refund დაფეილდა (უკვე partially refunded-ია). გადახდის მომენტში თანხა დროებით
    //    შეიძლება მოაკლდეს, მაგრამ ჩავარდნის მერე უკან ბრუნდება — ამიტომ ბოლო (დასტაბილურებულ)
    //    შემოწმებაზე ბალანსი **ზუსტად ისეთივე** უნდა იყოს, როგორიც ფარშალის მერე იყო:
    //    არც უნდა მოემატოს, არც უნდა მოაკლდეს. ნებისმიერი სხვაობა = ბაგი.
    //    ⚠️ ვაცდით სანამ დასტაბილურდება (თანხა უკან დაბრუნდეს) — არა პირველ ცვლილებაზე.
    await new Promise((r) => setTimeout(r, 12000)); // refund ჩავარდეს და თანხა უკან დაბრუნდეს
    const balanceAfterFull = await this.getStableBalance(deviceToken);
    const changed = Math.round((balanceAfterFull - balanceAfterPartial) * 100) / 100;
    console.log(`\n📊 ბალანსი full(failed) refund-ის მერე (დასტაბილურებული): ${balanceAfterPartial} → ${balanceAfterFull} ₾`);
    assertCondition(
      OP,
      Math.abs(changed) < 0.001,
      `failed full refund-ის მერე ბალანსი შეიცვალა (${changed > 0 ? '+' : ''}${changed} ₾) — გახდა ${balanceAfterFull} ₾, ისევ ${balanceAfterPartial} ₾ უნდა ყოფილიყო`,
      `ბალანსი ზუსტად ${balanceAfterPartial} ₾ — failed refund-მა არც უნდა დაუმატოს, არც უნდა მოაკლოს`,
      { balanceAfterPartial, balanceAfterFull, changed }
    );
    console.log(`✅ ბალანსი ისევ ${balanceAfterPartial} ₾ — failed refund-ს ბალანსი არ შეუცვლია`);
  }

  /** refund: encrypt → POST /order/refund → decrypt (integrator private key-ით) */
  private async refund(accessToken: string, config: IntegratorRefundConfig, isFull: boolean): Promise<any> {
    const paymentPage = new PaymentPage(this.request, null as any);

    // full → amount არ იგზავნება (= სრული refund) | partial → amount
    const refundData: any = {
      integratorId: config.integratorId,
      integratorOrderId: this.integratorOrderId,
      refundInitiator: 'INTEGRATOR',
    };
    if (!isFull) refundData.amount = config.refundAmount;

    const encrypted = await (paymentPage as any).encryptOrderData(accessToken, refundData);

    const response = await this.request.post(
      `${API_CONFIG.ECOMMERCE.BASE_URL}${API_CONFIG.ECOMMERCE.ENDPOINTS.REFUND}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          identifier: config.integratorId,
          encryptedData: encrypted.encryptedData,
          aes: true,
          encryptedKeys: encrypted.encryptedKeys,
        },
      }
    );
    if (!response.ok()) {
      throw new Error(`Refund failed: ${response.status()} - ${await response.text()}`);
    }

    // decrypt refund response
    const respJson = await response.json();
    const dec = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/test/decryptAES',
      {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        data: {
          encryptedData: respJson.encryptedData,
          encryptedAESProperties: respJson.encryptedKeys,
          privateKey: INTEGRATORS.DEFAULT.PRIVATE_KEY,
        },
      }
    );
    const val = (await dec.json()).value;
    return typeof val === 'string' ? JSON.parse(val) : val;
  }

  /** admin ტრანზაქციებში ვპოულობთ ჩვენს tx-ს (IBAN-ით, უახლესი) და ვაპოლინგებთ სანამ REFUNDED გახდება */
  private async verifyRefunded(config: IntegratorRefundConfig, isFull: boolean) {
    const expectedRefundInfo = isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const adminToken = await new AdminAuthPage(this.request).authenticate();

    let tx: any;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const resp = await this.request.post(
        'https://newadmin.dev.keepz.me/api/transaction/filter',
        { headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, data: {} }
      );
      tx = (await resp.json()).value.content.find((t: any) => t.iban === config.ibanToCheck);
      if (tx && tx.refundInfo === expectedRefundInfo) break;
    }

    // მთავარი ჩეკი — ტრანზაქცია რეალურად REFUNDED გახდა (არა უბრალოდ REFUND_REQUESTED)
    assertField(OP, tx || {}, 'refundInfo', expectedRefundInfo);

    console.log(`\n📊 INTEGRATOR refund დადასტურდა (${isFull ? 'FULL' : 'PARTIAL'}):`);
    console.log(`   tx ${tx.id}: status ${tx.status} | refundInfo ${tx.refundInfo} | initialRefundAmount ${tx.initialRefundAmount} ₾`);
    console.log(`   ✅ ტრანზაქცია რეალურად ${expectedRefundInfo}`);

    return tx;
  }

  /** merchant-ის GEL ბალანსი (device token) */
  private async getBalance(token: string): Promise<number> {
    const response = await this.request.get(
      'https://gateway.dev.keepz.me/payment-service/api/v1/merchant-balance',
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const gel = (data.value || []).find((b: any) => b.currency === 'GEL');
    return gel ? gel.amount : 0;
  }

  /** ვაცდით სანამ ბალანსი დასტაბილურდება — ორი ზედიზედ წაკითხვა (4წმ) ტოლი (ძველი settlement ჩაჯდეს) */
  private async getStableBalance(token: string): Promise<number> {
    let prev = await this.getBalance(token);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const cur = await this.getBalance(token);
      if (Math.abs(cur - prev) < 0.001) return cur;
      prev = cur;
    }
    return prev;
  }

  /** ბალანსს ვაპოლინგებთ სანამ balanceBefore-ისგან შეიცვლება (async ასახვა) */
  private async getBalanceAfterSettle(token: string, balanceBefore: number): Promise<number> {
    let latest = balanceBefore;
    for (let i = 0; i < 15; i++) {
      latest = await this.getBalance(token);
      if (Math.abs(latest - balanceBefore) > 0.001) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return latest;
  }
}
