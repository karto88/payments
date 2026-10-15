import { APIRequestContext, chromium } from '@playwright/test';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { AdminAuthPage } from '../../pages/AdminAuthPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerify, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';
import { assertCondition, assertField } from '../assertions';

const OP_ADD_MONEY = 'POST /wallet/add-money';
const OP_BALANCE = 'Balance Top-up (add money)';
const OP_TX = 'POST /generic-transaction/filter (Balance Top-up)';

// merchant 591078180 (stromae T) payload template — merchant/update-ისთვის (PUT + blob), საწყისი distributionFlow: STANDARD
const MERCHANT_591078180: any = {"installmentPermission":true,"isInitialDefault":null,"isAcquiringDefault":null,"isDistributorDefault":null,"initialCurrencies":null,"distributorCurrency":null,"acquiringCurrency":null,"descriptionFlow":null,"softPosMerchantDetailsId":null,"dashboardCurrency":"GEL","comment":"","SDA":false,"distributionFlow":"STANDARD","delayDistributeTime":null,"commissionType":"SENDER","personalNumber":"90000000141","fieldOfActivity1":"","registrationDate":"","email":"keepz0011111@mailinator.com","geoMask":false,"iban":"GE29TB7197445064300124","name":"stromae T","databaseId":"770660a9-e201-4b20-a681-86132befa418","rating":4.4,"merchantThumbnailImage":"https://wallet-keepz-dev-s3.s3.eu-central-1.amazonaws.com/sweeft-wallet/merchant_images/thumbnail-126fd24e-5950-4527-9b29-74d72de566ff.jpg","status":"ACTIVE","verificationDate":"2025-11-10T15:07:59","tinyUrlActivated":false,"sendInvoice":false,"isVerified":true,"phoneNumber":"591078180","countryCode":"995","merchantType":"MERCHANT","printing":false,"transactionAction":true,"documentNames":[],"completionDate":"2025-09-26T14:56:24","createdAt":"2025-09-26T14:56:24","masterBranchId":"db1bb73d-30cf-4718-ad2b-bc25cd13b09c","isLocked":false,"isMock":false,"merchantBranding":{"headerColor":"#170738","buttonColor":"#6C63FF","buttonTextColor":"#FFFFFF","titleColor":"#FFFFFF"},"paymentForbiddenInApp":true,"verificationInfo":{"tppay":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"nuvei":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"keepz":{"signingRequired":false,"merchantSigned":null,"signatureLink":null}},"isActive":true,"naprVerified":false,"naprVerificationDate":null,"removeProfileImage":false,"phoneNumberDetails":{"phoneNumber":"591078180","countryCode":"995"},"merchantId":"770660a9-e201-4b20-a681-86132befa418","saleId":"17","marketplaceId":"32","accountManagerId":"3","merchantGroupId":"278","documentsToRemove":null,"monthlyIncome":null,"officialName":"nike","officialLastName":null,"generalVerificationStatus":"TEMPORARY_VERIFIED","salesBranchId":null,"scheduleFrequency":null,"sectorId":null,"industryId":null,"details":{"actualAddress":null,"sdaVerified":false,"pep":null,"registrationCountry":null,"objectAddress":null,"ownerFirstName":null,"ownerLastName":null,"contactFirstName":null,"contactLastName":null,"contactPhoneNumber":null,"subMerchantUrl":null,"postalCode":null,"sdaDetails":{"userGender":null,"dateOfExpiry":"","dateOfIssue":"","birthDate":"","documentStatus":null,"legalAddress":""}}};

export type DistributionFlow =
  'STANDARD' | 'MANUAL' | 'TESTING' | 'TREASURY' | 'DIRECT' | 'UCC' | 'DELAY' | 'BALANCE' | 'HUB_TOP_UP';

interface AddMoneyConfig {
  amount: number;
  currencyCode: 'GEL' | 'USD' | 'EUR';
  cardType?: 'TBC' | 'BOG'; // standard ბარათით გადახდა (default TBC)
  openBankingProvider?: 'BOG' | 'TBC'; // თუ მითითებულია — ვიხდით Open Banking-ით (ონლაინ ბანკი) ბარათის ნაცვლად
  phone?: string; // merchant-ის device login — default 591078180
  distributionFlow?: DistributionFlow; // merchant-ს დავუყენებთ update-ით — top-up მაინც ბალანსზე უნდა აისახოს
}

/**
 * Balance Top-up (KD-2355) — merchant თავად ავსებს საკუთარ wallet-ს:
 *   0. (optional) merchant-ს distributionFlow-ს ვუცვლით — top-up მასზე არ უნდა იყოს დამოკიდებული
 *   1. merchant device login
 *   2. ბალანსი გადახდამდე
 *   3. POST /wallet/add-money → payment link
 *   4. link-ის გახსნა + გადახდა standard ბარათით ან Open Banking-ით (BOG / TBC)
 *   5. ბალანსი გაიზარდა სრული amount-ით (merchant SENDER commission-ზეა) — მთავარი შემოწმება
 *   6. ტრანზაქცია: operationType = TOP_UP, initialAmount = amount, საკომისიო sender მხარეს
 */
export class AddMoneyHelper {
  protected request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async addMoneyAndPay(config: AddMoneyConfig) {
    const phone = config.phone || '591078180';
    const cur = config.currencyCode;

    if (config.distributionFlow) {
      await this.updateMerchant({ distributionFlow: config.distributionFlow });
      console.log(`✅ Merchant updated: distributionFlow=${config.distributionFlow}`);
      await new Promise(resolve => setTimeout(resolve, 3000)); // ცვლილება დაჯდეს
    }

    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ავტორიზაცია (ერთხელ) + ბალანსი გადახდამდე
    const deviceToken = await new AuthDevicePage(this.request).authenticate(phone);
    const balanceBefore = await this.getBalance(deviceToken, cur);
    console.log(`✅ Balance before: ${balanceBefore} ${cur}`);

    // add money → payment link
    const paymentUrl = await this.addMoney(deviceToken, config.amount, cur);
    console.log(`✅ Payment URL: ${paymentUrl}`);

    if (config.openBankingProvider) {
      await this.payWithOpenBanking(paymentUrl, config.openBankingProvider, gmail);
    } else {
      await this.payWithCard(paymentUrl, config.cardType || 'TBC', gmail);
    }

    // ბალანსი გადახდის შემდეგ (ასახვა async-ია)
    const balanceAfter = await this.getBalanceAfterSettle(deviceToken, balanceBefore, cur);

    // ჩვენი top-up ტრანზაქცია (initialAmount = შეყვანილი თანხა)
    const tx = await this.findTopUpTransaction(deviceToken, config.amount, cur);
    assertCondition(
      OP_TX,
      !!tx,
      `ტრანზაქციების სიაში ვერ მოიძებნა ${config.amount} ${cur}-ის top-up ტრანზაქცია`,
      `ტრანზაქცია initialAmount=${config.amount}, currencyCode=${cur}`,
      { amount: config.amount, currencyCode: cur }
    );
    // merchant SENDER commission-ზეა → საკომისიოს გადამხდელი იხდის ზემოდან, ბალანსზე სრული amount უნდა აისახოს
    const senderFee = tx.senderCommissionAmount || 0;
    const receiverFee = tx.receiverCommissionAmount || 0;
    const payerPaid = Math.round((config.amount + senderFee) * 100) / 100;
    const expectedCredit = config.amount;
    const actualCredit = Math.round((balanceAfter - balanceBefore) * 100) / 100;

    const method = config.openBankingProvider ? `Open Banking ${config.openBankingProvider}` : `ბარათი ${config.cardType || 'TBC'}`;
    console.log(`\n📊 Add money — ${method} · distributionFlow ${config.distributionFlow ?? '-'} · SENDER commission · ${cur}`);
    console.log(`   საწყისი თანხა (initialAmount): ${tx.initialAmount} ${cur}`);
    console.log(`   საკომისიო: sender ${senderFee} ${cur}, receiver ${receiverFee} ${cur}`);
    console.log(`   იუზერმა გადაიხადა: ${config.amount} + ${senderFee} = ${payerPaid} ${cur}`);
    console.log(`   ბალანსი: იყო ${balanceBefore} → გახდა ${balanceAfter} ${cur} (დაემატა ${actualCredit}, უნდა დამატებოდა ${expectedCredit})`);
    console.log(`   ტრანზაქცია: operationType=${tx.operationType}, status=${tx.status}`);

    // 1. მთავარი — ბალანსზე ასახვა
    assertCondition(
      OP_BALANCE,
      Math.abs(actualCredit - expectedCredit) < 0.001,
      `distributionFlow=${config.distributionFlow ?? '-'}: ბალანსზე არასწორად აისახა — დაემატა ${actualCredit} ${cur}, უნდა დამატებოდა ${expectedCredit} ${cur}`,
      `SENDER commission → ბალანსზე სრული amount = ${expectedCredit} ${cur}`,
      { balanceBefore, balanceAfter, added: actualCredit, expected: expectedCredit, senderFee, receiverFee }
    );

    // 2. ტრანზაქცია — operationType, საწყისი თანხა, საკომისიო sender მხარეს
    assertField(OP_TX, tx, 'operationType', 'TOP_UP');
    assertField(OP_TX, tx, 'initialAmount', config.amount);
    assertCondition(
      OP_TX,
      senderFee > 0 && receiverFee === 0,
      `საკომისიო არასწორ მხარესაა — sender ${senderFee}, receiver ${receiverFee}`,
      'SENDER commission: senderCommissionAmount > 0 და receiverCommissionAmount = 0',
      tx
    );
    console.log('   ✅ ბალანსი აისახა, საკომისიო სწორად მოიწერა');
  }

  /**
   * merchant 591078180-ის განახლება — distributionFlow (PUT + multipart blob).
   * DELAY-ს სჭირდება delayDistributeTime (სხვა flow-ზე null).
   * public — spec-ის afterAll-იც იძახებს distributionFlow-ის STANDARD-ზე restore-ისთვის.
   */
  async updateMerchant(overrides: { distributionFlow: DistributionFlow }) {
    const adminToken = await new AdminAuthPage(this.request).authenticate();
    const payload = {
      ...MERCHANT_591078180,
      ...overrides,
      delayDistributeTime: overrides.distributionFlow === 'DELAY' ? 1 : null,
    };

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

  /** POST /wallet/add-money → payment link (value) */
  protected async addMoney(token: string, amount: number, currencyCode: string): Promise<string> {
    const response = await this.request.post(
      'https://walletportal.dev.keepz.me/api/v1/wallet/add-money',
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { amount, currencyCode },
      }
    );
    const data = await response.json().catch(() => ({}));

    assertCondition(
      OP_ADD_MONEY,
      response.ok() && typeof data.value === 'string' && data.value.startsWith('http'),
      `payment link არ დაბრუნდა (HTTP ${response.status()})`,
      'HTTP 200 და value = payment link',
      data
    );
    return data.value;
  }

  /** standard გადახდა — საბანკო ბარათი (persistent Chrome, როგორც DefaultOrderHelper) */
  private async payWithCard(paymentUrl: string, cardType: 'TBC' | 'BOG', gmail: GmailHelper) {
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
    });

    const page = await context.newPage();
    await page.goto(paymentUrl);
    console.log('✅ Payment page opened');

    await page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ }).click();
    await page.waitForTimeout(2000);

    if (cardType === 'TBC') {
      await this.fillTBCCard(page, gmail);
    } else {
      await this.fillBOGCard(page, gmail);
    }

    // ზოგ flow-ზე (მაგ. HUB_TOP_UP) წარმატების შემდეგ გვერდი თავისით იხურება — მაშინ success modal-ს აღარ ვხურავთ,
    // გადახდის შედეგს ქვემოთ ბალანსი + ტრანზაქცია ამოწმებს
    try {
      await page.waitForLoadState('networkidle');
      await closePaymentSuccess(page, context);
    } catch (e: any) {
      if (!page.isClosed() && !/closed/i.test(String(e?.message))) throw e;
      console.log('✅ Payment page closed itself after payment');
      await context.close().catch(() => {});
    }
  }

  /**
   * Open Banking გადახდა — Keepz გვერდზე „ონლაინ ბანკი" → ბანკის არჩევა → ბანკის login (როგორც OpenBankingHelper).
   * add-money body-ში provider არ გადაეცემა, ამიტომ ბანკს გადახდის გვერდზე ვირჩევთ.
   */
  private async payWithOpenBanking(paymentUrl: string, provider: 'BOG' | 'TBC', gmail: GmailHelper) {
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(paymentUrl);
    console.log('✅ Payment page opened');

    await page.locator('button', { hasText: /ონლაინ ბანკი|Online bank/ }).click();
    await page.waitForTimeout(2000);
    await page.locator('button', { hasText: provider === 'BOG' ? 'Bank of Georgia' : 'TBC bank' }).click();
    await page.waitForLoadState('networkidle');

    if (provider === 'BOG') {
      await this.automateBOG(page, context, gmail);
    } else {
      await this.automateTBC(page, context, gmail);
    }
  }

  private async automateBOG(page: any, context: any, gmail: GmailHelper) {
    // Username შევსება
    await page.click('bd-text-field#username');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.BOG_USERNAME!, { delay: 80 });

    // Password შევსება
    await page.click('bd-text-field#password');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.BOG_PASSWORD!, { delay: 80 });
    await page.waitForTimeout(500);

    await page.click('#kc-login');
    await page.waitForLoadState('networkidle');

    // OTP მიღება
    const otp = await gmail.getLatestOTP(30, undefined, 'BOG');
    console.log(`✅ OTP: ${otp}`);

    // OTP შევსება
    await page.locator('input#input').fill(otp);
    await page.waitForTimeout(500);

    await page.locator('bd-button#kc-login').click();
    await page.waitForLoadState('networkidle');

    // Profile არჩევა — ზოგჯერ BOG ამ ეტაპს გამოტოვებს და პირდაპირ Transfer გვერდს ხსნის
    const profileButton = page.locator('bd-button#kc-login');
    if (await profileButton.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
      await profileButton.click();
      await page.waitForLoadState('networkidle');
    }

    console.log('✅ BOG Login completed');

    // Account არჩევა
    await page.waitForTimeout(2000);
    await page.locator('bd-blank-input#input').click();
    await page.waitForTimeout(500);

    await page.getByText('GEL', { exact: false }).first().click();
    await page.waitForTimeout(1000);

    // COMPLETE — BOG Keepz გვერდის ენით იხსნება: „Complete" ან „დასრულება" (case-insensitive)
    await page.getByText(/^\s*(complete|დასრულება)\s*$/i).click();
    await page.waitForLoadState('networkidle');
    console.log('✅ Payment confirmed');

    await closePaymentSuccess(page, context);
  }

  private async automateTBC(page: any, context: any, gmail: GmailHelper) {
    await page.waitForSelector('#UserName', { timeout: 10000 });

    // Username შევსება
    await page.click('#UserName');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.TBC_USERNAME!, { delay: 80 });

    // Password შევსება
    await page.click('#Password');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.TBC_PASSWORD!, { delay: 80 });
    await page.waitForTimeout(500);

    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    // OTP მიღება
    const otp = await gmail.getLatestOTP(60);
    console.log(`✅ OTP: ${otp}`);

    // OTP შევსება
    await page.waitForSelector('input[name="OtpCode"]', { timeout: 10000 });
    await page.click('input[name="OtpCode"]');
    await page.waitForTimeout(300);
    await page.keyboard.type(otp, { delay: 80 });
    await page.waitForTimeout(500);

    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    console.log('✅ TBC Login completed');

    // Account არჩევა
    await page.waitForTimeout(2000);
    await page.click('button.dropdown-header');
    await page.waitForTimeout(500);

    await page.locator('button.dropdown-item').first().click();
    await page.waitForTimeout(1000);

    // Checkbox
    await page.locator('label.form-check-label.child').click();
    await page.waitForTimeout(500);

    // ვადასტურებ
    await page.locator('button#acceptPaymentButton').click();
    await page.waitForLoadState('networkidle');
    console.log('✅ Payment confirmed');

    await closePaymentSuccess(page, context);
  }

  protected async fillTBCCard(page: any, gmail: GmailHelper) {
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ OTP: ${otp}`);

    await fillOTPAndVerifyTBC(page, otp);
  }

  protected async fillBOGCard(page: any, gmail: GmailHelper) {
    await page.locator('#cardNumber').fill(CARDS.BOG.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.BOG.expiry);
    await page.locator('#cvc2').fill(CARDS.BOG.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'BOG');
    console.log(`✅ OTP: ${otp}`);

    await fillOTPAndVerify(page, otp);
  }

  /** ბალანსი მითითებულ ვალუტაზე (merchant-balance) */
  protected async getBalance(token: string, currency: string): Promise<number> {
    const response = await this.request.get(
      'https://gateway.dev.keepz.me/payment-service/api/v1/merchant-balance',
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const entry = (data.value || []).find((b: any) => b.currency === currency);
    return entry ? entry.amount : 0;
  }

  /** ბალანსს ვაპოლინგებთ სანამ balanceBefore-ისგან შეიცვლება (ასახვა async-ია) */
  private async getBalanceAfterSettle(token: string, balanceBefore: number, currency: string): Promise<number> {
    let latest = balanceBefore;
    for (let i = 0; i < 15; i++) {
      latest = await this.getBalance(token, currency);
      if (Math.abs(latest - balanceBefore) > 0.001) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return latest;
  }

  /** ბოლო ტრანზაქციებიდან ჩვენი top-up (initialAmount + currency-ით) */
  private async findTopUpTransaction(token: string, amount: number, currency: string): Promise<any> {
    const response = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=0&limit=5',
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { sentOrReceived: 'ALL', senderInfo: '', recipientInfo: '' },
      }
    );
    const content = (await response.json()).value?.transactionsPage?.content || [];
    return content.find((t: any) => t.initialAmount === amount && t.currencyCode === currency);
  }
}
