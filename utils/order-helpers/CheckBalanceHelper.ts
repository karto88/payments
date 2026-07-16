import { APIRequestContext } from '@playwright/test';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { AdminAuthPage } from '../../pages/AdminAuthPage';
import { DefaultOrderHelper } from './DefaultOrderHelper';
import { assertCondition } from '../assertions';

const OP = 'Balance reflection (standard payment)';

// merchant 591030201 (stromae 2) payload template — merchant/update-ისთვის (PUT + blob)
const MERCHANT_591030201: any = {"installmentPermission":true,"isInitialDefault":null,"isAcquiringDefault":null,"isDistributorDefault":null,"initialCurrencies":null,"distributorCurrency":null,"acquiringCurrency":null,"descriptionFlow":null,"softPosMerchantDetailsId":null,"dashboardCurrency":"GEL","comment":null,"SDA":false,"distributionFlow":"BALANCE","delayDistributeTime":null,"commissionType":"RECEIVER","personalNumber":"423423222","fieldOfActivity1":"","registrationDate":"","email":"keepz00221@mailinator.com","geoMask":true,"iban":"GE29TB7197445064300124","name":"stromae - RECEIVER","databaseId":"37c9b1b0-c8c8-4f33-aef1-13083e86a694","status":"ACTIVE","isVerified":false,"phoneNumber":"591030201","countryCode":"995","merchantType":"MERCHANT","printing":false,"transactionAction":true,"documentNames":[],"completionDate":"2026-07-13T22:42:50","createdAt":"2026-07-13T22:42:50","masterBranchId":"292de25e-c01e-47c8-8e4f-8823aba25fc0","isMock":false,"merchantBranding":{"headerColor":"#170738","buttonColor":"#6C63FF","buttonTextColor":"#FFFFFF","titleColor":"#FFFFFF"},"paymentForbiddenInApp":false,"verificationInfo":{"tppay":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"nuvei":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"keepz":{"signingRequired":false,"merchantSigned":null,"signatureLink":null}},"isActive":true,"removeProfileImage":false,"phoneNumberDetails":{"phoneNumber":"591030201","countryCode":"995"},"merchantId":"37c9b1b0-c8c8-4f33-aef1-13083e86a694","saleId":"17","marketplaceId":null,"accountManagerId":"720","merchantGroupId":"278","documentsToRemove":null,"monthlyIncome":null,"officialName":"stromae (2)","officialLastName":null,"salesBranchId":null,"scheduleFrequency":null,"sectorId":null,"industryId":null,"details":{"actualAddress":null,"sdaVerified":false,"pep":null,"registrationCountry":null,"objectAddress":null,"ownerFirstName":null,"ownerLastName":null,"contactFirstName":null,"contactLastName":null,"contactPhoneNumber":null,"subMerchantUrl":null,"sdaDetails":{"userGender":null,"dateOfExpiry":"","dateOfIssue":"","birthDate":"","documentStatus":null,"legalAddress":""}}};

// group 278 ("group karto") payload template — /api/group-ისთვის (POST + JSON body).
// merchant 591030201 ამ ჯგუფშია. STANDARD → GEL commission-ს ვცვლით PERCENTAGE ↔ FIXED-ზე.
// base = PERCENTAGE (live), updateGroupRateType-ი ცვლის rateType + isFixed-ს (0.03 / 0.1 რჩება).
const GROUP_278: any = {"groupName":"group karto","receiverCommission":null,"senderCommission":null,"maxAmountPerTransaction":null,"minAmountPerTransaction":null,"status":"ACTIVE","ratingEnabled":true,"descriptionRequired":false,"receiverCashbackEnabled":false,"tipEnabled":true,"foreignCardsBlocked":true,"embassyEnabled":false,"planPrice":18000,"tipCommissionPercent":null,"monthlyLimit":{"EUR":100000,"USD":100000,"GEL":100000},"dailyLimit":{"EUR":5000,"USD":5000,"GEL":5000},"isLocked":null,"isMock":false,"userType":"BUSINESS","id":"278","treasuryEnabled":false,"terminalType":"NON_GANVADEBA_MERCHANTS_WITH_CREDO_IBAN_21068_5","tipCommissionType":null,"acquiringTypes":[9,1,2,25,23,3,12,22,28,17,4,18,20,10,24,8],"values":{"OB":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":1500,"minAmountPerTransaction":0.05},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":1500,"minAmountPerTransaction":0.05},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":0,"senderCommission":0.1,"start":0,"isFixed":false}],"maxAmountPerTransaction":50000,"minAmountPerTransaction":0.05}},"STANDARD":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":3000,"minAmountPerTransaction":0.05},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":3000,"minAmountPerTransaction":0.05},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":0.03,"senderCommission":0.1,"start":0,"isFixed":false}],"maxAmountPerTransaction":3000,"minAmountPerTransaction":0.05}},"GOOGLE_PAY":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":1000,"minAmountPerTransaction":0.05},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":1000,"minAmountPerTransaction":0.05},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":0.3,"senderCommission":0.2,"start":0,"isFixed":false}],"maxAmountPerTransaction":3000,"minAmountPerTransaction":0.05}},"APPLE_PAY":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":1000,"minAmountPerTransaction":0.05},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":1000,"minAmountPerTransaction":0.05},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":3,"senderCommission":3,"start":0,"isFixed":false}],"maxAmountPerTransaction":3000,"minAmountPerTransaction":0.05}},"INSTALLMENT":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":2000,"minAmountPerTransaction":0.05},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":2000,"minAmountPerTransaction":0.05},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":5,"senderCommission":5,"start":0,"isFixed":false}],"maxAmountPerTransaction":12000,"minAmountPerTransaction":0.05}},"CRYPTO":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":500,"minAmountPerTransaction":0.05},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":500,"minAmountPerTransaction":0.05},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":1,"senderCommission":9,"start":0,"isFixed":false}],"maxAmountPerTransaction":3000,"minAmountPerTransaction":0.05}},"POS":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":500,"minAmountPerTransaction":0.05},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":500,"minAmountPerTransaction":0.05},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":300,"minAmountPerTransaction":0.05}},"WALLET":{"EUR":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":2000,"minAmountPerTransaction":0.01},"USD":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":2000,"minAmountPerTransaction":0.01},"GEL":{"commissions":[{"rateType":"PERCENTAGE","maxAmountPerTransaction":null,"minAmountPerTransaction":null,"receiverCommission":2.5,"senderCommission":2.5,"start":0,"isFixed":false}],"maxAmountPerTransaction":2000,"minAmountPerTransaction":0.01}}}};

interface CheckBalanceConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  cardType: 'TBC' | 'BOG';
  phone?: string; // merchant-ის device login (balance-ის შესამოწმებლად): default 591078180 | 591030201
  distributionFlow?: 'BALANCE' | 'STANDARD'; // merchant-ს დავუყენებთ update-ით (default BALANCE)
  commissionType?: 'RECEIVER' | 'SENDER';    // merchant-ს დავუყენებთ update-ით
  standardRateType?: 'PERCENTAGE' | 'FIXED'; // group-ის STANDARD GEL commission (update-ით); default PERCENTAGE
  currency?: 'GEL' | 'USD' | 'EUR'; // გადახდის/ბალანსის ვალუტა (default GEL)
}

/**
 * ბალანსის ასახვის ჩეკი — standard გადახდა (DefaultOrderHelper) და ვამოწმებთ
 * merchant-ის ბალანსზე სწორად აისახა თუ არა თანხა.
 * (merchant-ს უნდა ჰქონდეს distributionFlow: BALANCE — მაშინ თანხა ბალანსზე აისახება.)
 *
 * ასახული თანხა (commission-side-aware):
 *   receiver commission → amount − receiverCommission (მერჩანტს ნაკლები ერიცხება)
 *   sender commission   → amount (გადამხდელი იხდის საკომისიოს ზემოდან, მერჩანტი სრულს იღებს)
 */
export class CheckBalanceHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async checkBalanceReflection(config: CheckBalanceConfig) {
    const phone = config.phone || '591078180';
    const rateType = config.standardRateType || 'PERCENTAGE';
    const cur = config.currency || 'GEL';

    // group-ის STANDARD GEL commission — PERCENTAGE / FIXED (თუ მითითებულია)
    if (config.standardRateType) {
      await this.updateGroupRateType(config.standardRateType);
      console.log(`✅ Group updated: STANDARD GEL rateType=${config.standardRateType}`);
    }

    // merchant-ს დავუყენოთ distributionFlow / commissionType (თუ მითითებულია)
    if (config.distributionFlow || config.commissionType) {
      await this.updateMerchant({
        ...(config.distributionFlow ? { distributionFlow: config.distributionFlow } : {}),
        ...(config.commissionType ? { commissionType: config.commissionType } : {}),
      });
      console.log(`✅ Merchant updated: distributionFlow=${config.distributionFlow ?? '-'}, commissionType=${config.commissionType ?? '-'}`);
    }

    if (config.standardRateType || config.distributionFlow || config.commissionType) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // ცვლილება დაჯდეს
    }

    // ბალანსი გადახდის წინ (ვალუტის მიხედვით)
    const deviceToken = await new AuthDevicePage(this.request).authenticate(phone);
    const balanceBefore = await this.getBalance(deviceToken, cur);
    console.log(`✅ Balance before: ${balanceBefore} ${cur}`);

    // standard გადახდა (reuse DefaultOrderHelper) — currency-ის ჩათვლით
    await new DefaultOrderHelper(this.request).createAndPayOrder({
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      cardType: config.cardType,
      currency: config.currency,
    });

    // ჩვენი გადახდის ტრანზაქცია (commission-ისთვის — payer + merchant მხარეები)
    const tx = await this.getLatestTransaction(deviceToken);
    const receiverFee = tx?.receiverCommissionAmount || 0;
    const senderFee = tx?.senderCommissionAmount || 0;
    const isReceiverCommission = receiverFee > 0;

    // merchant-ს რა უნდა დაერიცხოს (credit) + payer-მა რეალურად რამდენი გადაიხადა
    const expectedCredit = isReceiverCommission ? config.amount - receiverFee : config.amount;
    const payerPaid = isReceiverCommission ? config.amount : config.amount + senderFee;

    // ბალანსი გადახდის შემდეგ (async ასახვას ველოდებით, ვალუტის მიხედვით)
    const balanceAfter = await this.getBalanceAfterSettle(deviceToken, balanceBefore, cur);
    const actualCredit = Math.round((balanceAfter - balanceBefore) * 100) / 100;
    const expectedRounded = Math.round(expectedCredit * 100) / 100;
    const payerPaidRounded = Math.round(payerPaid * 100) / 100;

    // ადამიანური აღწერა — ვინ რამდენი გადაიხადა / ვის რამდენი დაერიცხა
    const side = isReceiverCommission ? 'RECEIVER' : 'SENDER';
    const feeWord = rateType === 'FIXED' ? 'ფიქსირებული საკომისიო' : 'საკომისიო';
    const payerText = isReceiverCommission
      ? `იუზერმა გადაიხადა: ${config.amount} ${cur} (${feeWord} ${receiverFee} ${cur})`
      : `იუზერმა გადაიხადა: ${config.amount} + ${senderFee} (${feeWord}) = ${payerPaidRounded} ${cur}`;
    const creditText = isReceiverCommission
      ? `merchant-ს დაერიცხა: amount − ${feeWord} = ${config.amount} − ${receiverFee} = ${expectedRounded} ${cur}`
      : `merchant-ს დაერიცხა: სრული amount = ${expectedRounded} ${cur}`;

    console.log(`\n📊 მოსალოდნელი შედეგი — ${side} commission · ${cur} · distributionFlow: BALANCE`);
    console.log(`   ${payerText}`);
    console.log(`   ${creditText}`);
    console.log(`   ბალანსი: იყო ${balanceBefore} ${cur} → გახდა ${balanceAfter} ${cur} (დაემატა ${actualCredit} ${cur})`);

    const ok = Math.abs(actualCredit - expectedRounded) < 0.001;
    console.log(
      ok
        ? `   ✅ ბალანსი წარმატებულად შეივსო (${cur})`
        : `   ❌ ბალანსი ვერ შეივსო სწორად — დაემატა ${actualCredit} ${cur}, უნდა დამატებოდა ${expectedRounded} ${cur}`
    );

    assertCondition(
      OP,
      ok,
      `${side} commission: ბალანსზე არასწორად აისახა — დაემატა ${actualCredit} ₾, უნდა დამატებოდა ${expectedRounded} ₾`,
      `${payerText}; ${creditText}`,
      { commissionSide: side, payerPaid: payerPaidRounded, balanceBefore, balanceAfter, added: actualCredit, expected: expectedRounded, senderFee, receiverFee }
    );
  }

  /**
   * merchant-ის განახლება — distributionFlow / commissionType (PUT + multipart blob).
   * (POST 500-ს იძლევა — endpoint PUT-ია; merchantData = blob, application/json.)
   * public — spec-ის afterAll-იც იძახებს distributionFlow-ის STANDARD-ზე restore-ისთვის.
   */
  async updateMerchant(overrides: { distributionFlow?: string; commissionType?: string }) {
    const adminToken = await new AdminAuthPage(this.request).authenticate();
    const payload = { ...MERCHANT_591030201, ...overrides };

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

  /**
   * group 278-ის STANDARD → GEL commission-ის rate type — PERCENTAGE / FIXED
   * (POST /api/group, admin token, სრული JSON body). values/მნიშვნელობები (0.03 / 0.1) რჩება,
   * იცვლება მხოლოდ rateType + isFixed. public — spec-ის afterAll-იც იძახებს restore-ისთვის.
   */
  async updateGroupRateType(rateType: 'PERCENTAGE' | 'FIXED') {
    const adminToken = await new AdminAuthPage(this.request).authenticate();
    const payload = JSON.parse(JSON.stringify(GROUP_278)); // deep clone
    const gel = payload.values.STANDARD.GEL.commissions[0];
    gel.rateType = rateType;
    gel.isFixed = rateType === 'FIXED';

    const res = await this.request.post(
      'https://newadmin.dev.keepz.me/api/group',
      {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        data: payload,
      }
    );

    if (!res.ok()) {
      throw new Error(`Group update failed: ${res.status()} - ${await res.text()}`);
    }
  }

  /** ბალანსი მითითებულ ვალუტაზე (merchant-balance) — default GEL */
  private async getBalance(token: string, currency: string = 'GEL'): Promise<number> {
    const response = await this.request.get(
      'https://gateway.dev.keepz.me/payment-service/api/v1/merchant-balance',
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const entry = (data.value || []).find((b: any) => b.currency === currency);
    return entry ? entry.amount : 0;
  }

  /** უახლესი ტრანზაქცია (device token) — ჩვენი გადახდა */
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

  /** ბალანსს ვაპოლინგებთ სანამ balanceBefore-ისგან შეიცვლება (ასახვა async-ია), ვალუტის მიხედვით */
  private async getBalanceAfterSettle(token: string, balanceBefore: number, currency: string = 'GEL'): Promise<number> {
    let latest = balanceBefore;
    for (let i = 0; i < 15; i++) {
      latest = await this.getBalance(token, currency);
      if (Math.abs(latest - balanceBefore) > 0.001) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return latest;
  }
}
