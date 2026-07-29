import { APIRequestContext } from '@playwright/test';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { AdminAuthPage } from '../../pages/AdminAuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { PreAuthHelper } from './PreAuthHelper';
import { TransactionChecker } from '../transactionChecker';
import { API_CONFIG } from '../../config/api.config';
import { INTEGRATORS } from '../../config/integrators.config';
import { assertField, assertCondition } from '../assertions';

const OP = 'Pre-Auth refund — verification';

type RefundVia = 'INTEGRATOR' | 'DEVICE' | 'ADMIN';

// merchant 591078180 (stromae T, master branch db1bb73d) payload — merchant/update-ისთვის (PUT + blob).
// commissionType-ს ვცვლით SENDER ↔ RECEIVER (დანარჩენი უცვლელი).
const MERCHANT_591078180: any = {"installmentPermission":true,"isInitialDefault":null,"isAcquiringDefault":null,"isDistributorDefault":null,"initialCurrencies":null,"distributorCurrency":null,"acquiringCurrency":null,"descriptionFlow":null,"softPosMerchantDetailsId":null,"dashboardCurrency":"GEL","comment":"","SDA":false,"distributionFlow":"STANDARD","delayDistributeTime":null,"commissionType":"RECEIVER","personalNumber":"90000000141","fieldOfActivity1":"","registrationDate":"","email":"keepz0011111@mailinator.com","geoMask":false,"iban":"GE29TB7197445064300124","name":"stromae T","databaseId":"770660a9-e201-4b20-a681-86132befa418","rating":4.4,"merchantThumbnailImage":"https://wallet-keepz-dev-s3.s3.eu-central-1.amazonaws.com/sweeft-wallet/merchant_images/thumbnail-126fd24e-5950-4527-9b29-74d72de566ff.jpg","status":"ACTIVE","verificationDate":"2025-11-10T15:07:59","tinyUrlActivated":false,"sendInvoice":false,"isVerified":true,"phoneNumber":"591078180","countryCode":"995","merchantType":"MERCHANT","printing":false,"transactionAction":true,"documentNames":[],"completionDate":"2025-09-26T14:56:24","createdAt":"2025-09-26T14:56:24","masterBranchId":"db1bb73d-30cf-4718-ad2b-bc25cd13b09c","isLocked":false,"isMock":false,"merchantBranding":{"headerColor":"#170738","buttonColor":"#6C63FF","buttonTextColor":"#FFFFFF","titleColor":"#FFFFFF"},"paymentForbiddenInApp":true,"verificationInfo":{"tppay":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"nuvei":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"keepz":{"signingRequired":false,"merchantSigned":null,"signatureLink":null}},"isActive":true,"naprVerified":false,"naprVerificationDate":null,"removeProfileImage":false,"phoneNumberDetails":{"phoneNumber":"591078180","countryCode":"995"},"merchantId":"770660a9-e201-4b20-a681-86132befa418","saleId":"17","marketplaceId":"32","accountManagerId":"3","merchantGroupId":"278","documentsToRemove":null,"monthlyIncome":null,"officialName":"nike","officialLastName":null,"generalVerificationStatus":"TEMPORARY_VERIFIED","salesBranchId":null,"scheduleFrequency":null,"sectorId":null,"industryId":null,"details":{"actualAddress":null,"sdaVerified":false,"pep":null,"registrationCountry":null,"objectAddress":null,"ownerFirstName":null,"ownerLastName":null,"contactFirstName":null,"contactLastName":null,"contactPhoneNumber":null,"subMerchantUrl":null,"sdaDetails":{"userGender":null,"dateOfExpiry":"","dateOfIssue":"","birthDate":"","documentStatus":null,"legalAddress":""}}};

interface RefundPreAuthConfig {
  authAmount: number;      // pre-auth (hold) თანხა — უნიკალური (ტრანზაქციის ამოსაცნობად)
  completeAmount: number;  // capture-ის თანხა
  refundAmount?: number;   // omit → FULL | present → PARTIAL
  refundVia: RefundVia;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  cardType: 'TBC' | 'BOG';
  phone: string;           // merchant device login — DEVICE refund-ისთვის
  commissionType?: 'SENDER' | 'RECEIVER'; // merchant-ს დავუყენებთ გადახდის წინ (update-ით)
}

/**
 * Pre-Auth refund — მარტივი ლოგიკა:
 *   1. pre-auth გადახდა → TO_BE_CONFIRMED
 *   2. capture (complete)
 *   3. refund refundVia-ს მიხედვით (DEVICE / ADMIN / INTEGRATOR)
 *   4. verify — ტრანზაქცია REFUNDED (full) / PARTIALLY_REFUNDED (partial) + initialRefundAmount
 *      (ბალანსის ჩამოჭრას ტრანზაქცია ადასტურებს — refund source "In Balance"; balance endpoint
 *       TBC-ზე async/ნელია და ცალკეული ოპერაციის ეფექტს ვერ იჭერს ტესტის ფანჯარაში.)
 */
export class RefundPreAuthHelper {
  private request: APIRequestContext;
  private integratorOrderId = '';
  private transactionId = 0;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createPayCaptureAndRefund(config: RefundPreAuthConfig) {
    const isFull = config.refundAmount === undefined || config.refundAmount === config.completeAmount;

    // 0. merchant-ს commission type დავუყენოთ (თუ მითითებულია) — გადახდის წინ
    if (config.commissionType) {
      await this.updateMerchant({ commissionType: config.commissionType });
      console.log(`✅ 0. Merchant commissionType → ${config.commissionType}`);
      await new Promise((r) => setTimeout(r, 1500)); // ცვლილება დაჯდეს
    }

    // 1. pre-auth order + payment
    const preAuth = new PreAuthHelper(this.request);
    const { integratorOrderId, transactionId, status, accessToken } = await preAuth.createAndPayOrder({
      amount: config.authAmount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      cardType: config.cardType,
    });
    this.integratorOrderId = integratorOrderId;
    this.transactionId = transactionId;

    assertCondition(
      OP,
      status === 'TO_BE_CONFIRMED',
      `pre-auth-მა ჩვეულებრივ გადახდად გაიარა — status "${status}" (≠ TO_BE_CONFIRMED)`,
      'status === TO_BE_CONFIRMED',
      { status, integratorOrderId, transactionId }
    );
    console.log(`✅ 1. Pre-auth → ${status} (tx: ${transactionId})`);

    // გადახდის მერე პაუზა — order/გადახდა დაისეტლოს სანამ complete-ს გავაკეთებთ
    await new Promise((r) => setTimeout(r, 2000));

    // 2. capture
    const completed = await preAuth.completeOrder(accessToken, {
      integratorId: config.integratorId,
      integratorOrderId,
      transactionId,
      completeAmount: config.completeAmount,
    });
    console.log(`✅ 2. Captured(${config.completeAmount}) → ${completed.status}`);

    // INTEGRATOR refund order-ზე მუშაობს → order refundable უნდა გახდეს (DEVICE/ADMIN tx-ზე მუშაობს)
    if (config.refundVia === 'INTEGRATOR') {
      const orderStatus = await this.waitForOrderRefundable(accessToken, config.integratorId, integratorOrderId, transactionId);
      console.log(`✅ 3. Order refundable → ${orderStatus}`);
    }

    // 3. ბალანსი refund-ის წინ
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone);
    const balanceBefore = await this.getBalance(deviceToken);
    console.log(`✅ 3. Balance before refund: ${balanceBefore} ₾`);

    // 4. refund არხის მიხედვით
    console.log(`\n🔄 4. Refunding via ${config.refundVia} (${isFull ? 'FULL' : `PARTIAL ${config.refundAmount}`})`);
    if (config.refundVia === 'INTEGRATOR') {
      await this.refundIntegrator(accessToken, config, isFull);
    } else if (config.refundVia === 'DEVICE') {
      await this.refundDevice(config, isFull);
    } else {
      await this.refundAdmin(config, isFull);
    }

    // 5. verify — refundInfo + refund თანხა ჩაიწერა სწორად (returns senderFee)
    const senderFee = await this.verifyRefunded(config, isFull);

    // 6. ბალანსი სწორად ჩამოიჭრა — full → captured + senderFee | partial → refundAmount (საკომისიოს გარეშე)
    //    refund-ის მერე 3წმ ვაცდით (ბალანსი ეგრევე აკლდება) და ვკითხულობთ
    await new Promise((r) => setTimeout(r, 3000));
    const balanceAfter = await this.getBalance(deviceToken);
    const deducted = Math.round((balanceBefore - balanceAfter) * 100) / 100;
    const expectedDeduction = isFull
      ? Math.round((config.completeAmount + senderFee) * 100) / 100
      : (config.refundAmount as number);

    console.log(`\n📊 ბალანსი: იყო ${balanceBefore} ₾ → დარჩა ${balanceAfter} ₾ (მოაკლდა ${deducted} ₾) | უნდა მოკლებოდა ${expectedDeduction} ₾`);
    assertCondition(
      OP,
      Math.abs(deducted - expectedDeduction) < 0.001,
      `ბალანსი არასწორად ჩამოიჭრა — მოაკლდა ${deducted} ₾, უნდა ${expectedDeduction} ₾`,
      isFull
        ? `full → captured + senderFee = ${config.completeAmount} + ${senderFee} = ${expectedDeduction} ₾`
        : `partial → refundAmount = ${expectedDeduction} ₾ (საკომისიოს გარეშე)`,
      { balanceBefore, balanceAfter, deducted, expectedDeduction }
    );
    console.log(`   ✅ ბალანსი სწორად ჩამოიჭრა — მოაკლდა ${deducted} ₾`);
  }

  /** INTEGRATOR refund — encrypt → POST ecommerce order/refund → decrypt (REFUND_REQUESTED) */
  private async refundIntegrator(accessToken: string, config: RefundPreAuthConfig, isFull: boolean) {
    const paymentPage = new PaymentPage(this.request, null as any);

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
      throw new Error(`Integrator refund failed: ${response.status()} - ${await response.text()}`);
    }

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
    const result = typeof val === 'string' ? JSON.parse(val) : val;

    assertCondition(
      OP,
      result?.status === 'REFUND_REQUESTED' && !result?.errorMessage,
      `integrator refund ვერ მოთხოვნდა (status: ${result?.status}, error: ${result?.errorMessage})`,
      'status === REFUND_REQUESTED',
      result
    );
    console.log(`   ✅ Refund requested → ${result.status}`);
  }

  /** DEVICE refund — generic-transaction/refund (device token) */
  private async refundDevice(config: RefundPreAuthConfig, isFull: boolean) {
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone);
    const amount = isFull ? config.completeAmount : config.refundAmount;
    const response = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/refund',
      {
        headers: { 'Authorization': `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
        data: { amount, genericTransactionId: this.transactionId },
      }
    );
    if (!response.ok()) {
      throw new Error(`Device refund failed: ${response.status()} - ${await response.text()}`);
    }
    console.log(`   ✅ Device refund call successful (status ${response.status()})`);
  }

  /** ADMIN refund — PUT newadmin transaction/refund (full → amount:null, როგორც admin panel) */
  private async refundAdmin(config: RefundPreAuthConfig, isFull: boolean) {
    const adminToken = await new AdminAuthPage(this.request).authenticate();
    const response = await this.request.put(
      'https://newadmin.dev.keepz.me/api/transaction/refund',
      {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        data: { amount: isFull ? null : config.refundAmount, genericTransactionId: this.transactionId },
      }
    );
    if (!response.ok()) {
      throw new Error(`Admin refund failed: ${response.status()} - ${await response.text()}`);
    }
    console.log(`   ✅ Admin refund call successful (status ${response.status()})`);
  }

  /**
   * verify — ტრანზაქცია REFUNDED/PARTIALLY_REFUNDED + refund თანხა სწორია:
   *   full    → initialRefundAmount === captured (completeAmount) + საკომისიო
   *   partial → initialRefundAmount === refundAmount
   * (საკომისიოს device ტრანზაქციიდან ვიღებთ. balance-ს არ ვამოწმებთ — ამ იუზერს BALANCE flow არ აქვს.)
   */
  private async verifyRefunded(config: RefundPreAuthConfig, isFull: boolean): Promise<number> {
    const expected = isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const adminToken = await new AdminAuthPage(this.request).authenticate();

    let tx: any;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const resp = await this.request.post(
        'https://newadmin.dev.keepz.me/api/transaction/filter',
        { headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, data: {} }
      );
      tx = (await resp.json()).value.content.find((t: any) => t.id === this.transactionId);
      if (tx && tx.refundInfo === expected) break;
    }

    // 1. refund status
    assertField(OP, tx || {}, 'refundInfo', expected);

    // 2. refund თანხა — full → captured + senderFee (receiver-ზე senderFee=0 → captured) | partial → refundAmount
    const senderFee = await this.getSenderFee(config.phone);
    const actualRefund = Math.round((tx.initialRefundAmount || 0) * 100) / 100;
    const expectedRefund = isFull
      ? Math.round((config.completeAmount + senderFee) * 100) / 100
      : (config.refundAmount as number);

    console.log(`\n📊 refund დადასტურდა (${isFull ? 'FULL' : 'PARTIAL'}): tx ${tx.id} | refundInfo ${tx.refundInfo}`);
    console.log(isFull
      ? `   captured ${config.completeAmount} + senderFee ${senderFee} = ${expectedRefund} ₾ | initialRefundAmount ${actualRefund} ₾`
      : `   partial refundAmount = ${expectedRefund} ₾ | initialRefundAmount ${actualRefund} ₾`);
    assertCondition(
      OP,
      Math.abs(actualRefund - expectedRefund) < 0.001,
      `refund თანხა არასწორია — initialRefundAmount ${actualRefund} ₾, უნდა ${expectedRefund} ₾`,
      isFull ? `full → captured + senderFee = ${config.completeAmount} + ${senderFee} = ${expectedRefund} ₾` : `partial → refundAmount = ${expectedRefund} ₾`,
      { initialRefundAmount: actualRefund, captured: config.completeAmount, senderFee, expected: expectedRefund }
    );
    console.log(`   ✅ refund თანხა სწორია`);
    return senderFee;
  }

  /**
   * merchant-ის commissionType-ის განახლება (PUT + multipart blob) — SENDER / RECEIVER.
   * public — spec-ის afterAll-იც იძახებს საწყისი მდგომარეობის აღსადგენად.
   */
  async updateMerchant(overrides: { commissionType?: string; distributionFlow?: string }) {
    const adminToken = await new AdminAuthPage(this.request).authenticate();
    const payload = { ...MERCHANT_591078180, ...overrides };

    const res = await this.request.put(
      'https://newadmin.dev.keepz.me/api/v1/merchant/update',
      {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        multipart: {
          merchantData: { name: 'blob', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) },
        },
      }
    );

    if (!res.ok()) {
      throw new Error(`Merchant update failed: ${res.status()} - ${await res.text()}`);
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

  /**
   * ჩვენი ტრანზაქციის SENDER საკომისიო device ტრანზაქციიდან.
   * refund-ს მხოლოდ sender fee ემატება (payer-მა ზემოდან გადაიხადა):
   *   SENDER commission → senderFee > 0 → refund = captured + senderFee
   *   RECEIVER commission → senderFee = 0 → refund = captured (fee merchant-ს აკლდება, refund-ს არ ემატება)
   */
  private async getSenderFee(phone: string): Promise<number> {
    const deviceToken = await new AuthDevicePage(this.request).authenticate(phone);
    const response = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=0&limit=20',
      {
        headers: { 'Authorization': `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
        data: { sentOrReceived: 'ALL', senderInfo: '', recipientInfo: '' },
      }
    );
    const list = (await response.json()).value?.transactionsPage?.content || [];
    const dtx = list.find((t: any) => t.id === this.transactionId) || list[0];
    return Math.round((dtx?.senderCommissionAmount || 0) * 100) / 100;
  }

  /**
   * capture-ის შემდეგ order async დასტურდება — TBC-ს ხელმოწერა ნელია, ამიტომ ყოველ იტერაციაზე
   * ვაწერთ ხელს (update-status) და ვამოწმებთ getOrderStatus-ს სანამ refundable გახდება.
   */
  private async waitForOrderRefundable(
    accessToken: string,
    integratorId: string,
    integratorOrderId: string,
    transactionId: number
  ): Promise<string> {
    const paymentPage = new PaymentPage(this.request, null as any);
    const checker = new TransactionChecker(this.request);
    const notReady = ['TO_BE_CONFIRMED', 'WAITING_FOR_CONFIRM', 'WAITING_FOR_SIGNATURE', 'PENDING'];
    // update-status (ხელმოწერა) აჩქარებს order-ის დადასტურებას; ვიმეორებთ სანამ refundable გახდება
    let status = '';
    for (let i = 0; i < 30; i++) {
      try { await checker.signById(transactionId); } catch { /* ignore */ }
      const s = await paymentPage.getOrderStatus(accessToken, integratorId, integratorOrderId);
      status = s?.status ?? s?.orderStatus ?? '';
      if (status && !notReady.includes(status)) break;
      await new Promise((r) => setTimeout(r, 4000));
    }
    return status;
  }
}