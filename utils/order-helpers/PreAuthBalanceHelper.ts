import { APIRequestContext } from '@playwright/test';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { PreAuthHelper } from './PreAuthHelper';
import { TransactionChecker } from '../transactionChecker';
import { assertCondition } from '../assertions';

const OP = 'Pre-Auth balance hold';

interface PreAuthBalanceConfig {
  authAmount: number;      // ავტორიზებული (hold) თანხა — უნიკალური (ტრანზაქციის ამოსაცნობად)
  completeAmount: number;  // capture-ის თანხა (partial < auth | full === auth)
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  cardType: 'TBC' | 'BOG';
  phone: string;           // merchant device login — ბალანსის შესამოწმებლად (591030201)
}

/**
 * Pre-Auth balance hold ჩეკი — ცალკე ჰელფერი (ძველ PreAuthHelper-ს არ ვცვლით, reuse).
 *
 * ლოგიკა:
 *   1. ბალანსი gadaxdis წინ (balanceBefore)
 *   2. pre-auth ორდერი + გადახდა (PreAuthHelper stage 1) → TO_BE_CONFIRMED
 *   3. ⚠️ CORE — სანამ TO_BE_CONFIRMED-ია, ბალანსი არ უნდა დაირიცხოს (თანხა დაჭერილია, არა captured)
 *   4. complete/capture (PreAuthHelper stage 2)
 *   5. capture-ის შემდეგ ბალანსი უნდა დაირიცხოს (commission-aware)
 */
export class PreAuthBalanceHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async checkPreAuthBalance(config: PreAuthBalanceConfig) {
    // 1. ბალანსი გადახდის წინ
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone);
    const balanceBefore = await this.getBalance(deviceToken);
    console.log(`✅ Balance before: ${balanceBefore} ₾`);

    // 2. stage 1 — pre-auth order + payment (reuse)
    const preAuth = new PreAuthHelper(this.request);
    const { integratorOrderId, transactionId, status, accessToken } = await preAuth.createAndPayOrder({
      amount: config.authAmount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      cardType: config.cardType,
    });

    // pre-auth გადახდა → TO_BE_CONFIRMED (თუ არა → ჩვეულებრივ გადახდად გაიარა = ბაგი)
    assertCondition(
      OP,
      status === 'TO_BE_CONFIRMED',
      `pre-auth-მა ჩვეულებრივ გადახდად გაიარა — status "${status}" (≠ TO_BE_CONFIRMED)`,
      'status === TO_BE_CONFIRMED (თანხა capture-მდე არ ნაწილდება)',
      { status, integratorOrderId, transactionId }
    );
    console.log(`✅ Stage 1: pre-auth → ${status} (tx: ${transactionId})`);

    // 3. ⚠️ CORE — TO_BE_CONFIRMED-ის დროს ბალანსი არ უნდა დაირიცხოს
    await new Promise((r) => setTimeout(r, 8000)); // დრო რომ (არ) აისახოს
    const balanceDuring = await this.getBalance(deviceToken);
    const heldDelta = Math.round((balanceDuring - balanceBefore) * 100) / 100;

    console.log(`\n📊 Pre-Auth hold — ბალანსი: იყო ${balanceBefore} ₾ → ${balanceDuring} ₾ (ცვლილება ${heldDelta} ₾)`);
    assertCondition(
      OP,
      Math.abs(heldDelta) < 0.001,
      `TO_BE_CONFIRMED-ის დროს ბალანსი დაირიცხა (+${heldDelta} ₾) — capture-მდე არ უნდა დარიცხულიყო`,
      'ბალანსი უცვლელი — თანხა დაჭერილია (hold), არა captured',
      { balanceBefore, balanceDuring, heldDelta }
    );
    console.log(`   ✅ ბალანსი არ დარიცხულა pre-auth hold-ის დროს (თანხა მხოლოდ დაჭერილია)`);

    // 4. stage 2 — complete/capture (reuse)
    const completed = await preAuth.completeOrder(accessToken, {
      integratorId: config.integratorId,
      integratorOrderId,
      transactionId,
      completeAmount: config.completeAmount,
    });
    console.log(`✅ Stage 2: complete(${config.completeAmount}) → ${completed.status}`);

    // ბალანსი ირიცხება მხოლოდ distributionStatus === SUCCESS-ზე — ვამოწმებთ/ვაწერთ ხელს სანამ SUCCESS
    await this.driveDistributionToSuccess(transactionId);

    // 5. capture-ის შემდეგ ბალანსი უნდა დაირიცხოს (commission-aware)
    const tx = await this.getLatestTransaction(deviceToken);
    const receiverFee = tx?.receiverCommissionAmount || 0;
    const senderFee = tx?.senderCommissionAmount || 0;
    const isReceiverCommission = receiverFee > 0;

    // receiver commission → completeAmount − fee | sender commission → completeAmount
    const expectedCredit = isReceiverCommission ? config.completeAmount - receiverFee : config.completeAmount;
    const expectedRounded = Math.round(expectedCredit * 100) / 100;

    const balanceAfter = await this.getBalanceAfterSettle(deviceToken, balanceBefore);
    const actualCredit = Math.round((balanceAfter - balanceBefore) * 100) / 100;
    const side = isReceiverCommission ? 'RECEIVER' : 'SENDER';

    console.log(`\n📊 მოსალოდნელი შედეგი — Pre-Auth capture (${side} commission)`);
    console.log(`   ავტორიზებული: ${config.authAmount} ₾ | დავაქომფლითეთ: ${config.completeAmount} ₾`);
    console.log(isReceiverCommission
      ? `   merchant-ს უნდა დაერიცხოს: ${config.completeAmount} − ${receiverFee} (საკომისიო) = ${expectedRounded} ₾`
      : `   merchant-ს უნდა დაერიცხოს: სრული ${expectedRounded} ₾ (საკომისიოს გადამხდელი ფარავs)`);
    console.log(`   ბალანსი: იყო ${balanceBefore} ₾ → გახდა ${balanceAfter} ₾ (დაემატა ${actualCredit} ₾)`);

    const ok = Math.abs(actualCredit - expectedRounded) < 0.001;
    console.log(ok
      ? `   ✅ capture-ის შემდეგ ბალანსი სწორად დაირიცხა`
      : `   ❌ ბალანსი არასწორად დაირიცხა — დაემატა ${actualCredit} ₾, უნდა ${expectedRounded} ₾`);

    assertCondition(
      OP,
      ok,
      `capture-ის შემდეგ ბალანსი არასწორად დაირიცხა — დაემატა ${actualCredit} ₾, უნდა ${expectedRounded} ₾`,
      `ბალანსს უნდა დაემატოს ${expectedRounded} ₾ (${side} commission)`,
      { balanceBefore, balanceAfter, actualCredit, expected: expectedRounded, senderFee, receiverFee }
    );
  }

  /**
   * capture-ის შემდეგ ტრანზაქციას ვამოწმებთ/ვაწერთ ხელს სანამ distributionStatus === SUCCESS.
   * ბალანსი მხოლოდ SUCCESS-ზე ირიცხება (WAITING_FOR_SIGNATURE / PENDING → update-status).
   */
  private async driveDistributionToSuccess(transactionId: number) {
    const checker = new TransactionChecker(this.request);
    for (let i = 0; i < 15; i++) {
      const s = await checker.getStatusById(transactionId, 0);
      if (s.distributionStatus === 'SUCCESS') break;
      await checker.signById(transactionId);
      await new Promise((r) => setTimeout(r, 3000));
    }
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

  /** უახლესი ტრანზაქცია (device token) — საკომისიოსთვის */
  private async getLatestTransaction(token: string): Promise<any> {
    const response = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=0&limit=5',
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { sentOrReceived: 'ALL', senderInfo: '', recipientInfo: '' },
      }
    );
    return ((await response.json()).value?.transactionsPage?.content || [])[0];
  }

  /** ბალანსს ვაპოლინგებთ სანამ balanceBefore-ისგან შეიცვლება (capture async აისახება) */
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
