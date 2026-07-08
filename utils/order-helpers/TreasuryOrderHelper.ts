import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerify, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { TransactionChecker } from '../transactionChecker';
import { CARDS } from '../../config/cards.config';
import { INTEGRATORS } from '../../config/integrators.config';

type CardType = 'TBC' | 'BOG';

interface TreasuryOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  cardType: CardType;
  ibanToCheck?: string;
  orderProperties?: any;
}

export class TreasuryOrderHelper {
  private request: APIRequestContext;
  private readonly BASE_URL = 'https://gateway.dev.keepz.me';

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayOrder(config: TreasuryOrderConfig) {
    const authPage = new AuthPage(this.request);
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის მონაცემები
    const orderData: any = {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType || 'BRANCH',
      integratorId: config.integratorId,
      integratorOrderId: crypto.randomUUID(),
    };

    if (config.validUntil) {
      orderData.validUntil = config.validUntil;
    }

    orderData.orderProperties = config.orderProperties || {};

    // Encrypt (Treasury keys)
    const encryptResp = await this.request.post(`${this.BASE_URL}/payment-service/api/v1/test/encryptAES`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      data: { data: orderData, publicKey: INTEGRATORS.TREASURY.PUBLIC_KEY },
    });
    const encryptData = await encryptResp.json();
    const { encryptedData, encryptedKeys } = encryptData.value;

    // Create Order
    const createResp = await this.request.post(`${this.BASE_URL}/ecommerce-service/api/integrator/order`, {
      headers: { 'Content-Type': 'application/json' },
      data: { identifier: config.integratorId, encryptedData, aes: true, encryptedKeys },
    });
    if (!createResp.ok()) {
      const errBody = await createResp.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(errBody);
      } catch {
        /* not JSON */
      }

      console.error('\n❌ Treasury Order Creation FAILED');
      console.error(`   🔧 Status: ${createResp.status()}`);
      if (parsed) {
        console.error(`   ⚠️  Message: ${parsed.message}`);
        console.error(`   🔢 statusCode: ${parsed.statusCode}`);
      } else {
        console.error(`   📥 Body: ${errBody}`);
      }
      console.error('');

      throw new Error(
        `Treasury order creation failed: ${createResp.status()} - ${parsed ? parsed.message : errBody}`
      );
    }
    const orderResp = await createResp.json();

    // Decrypt (Treasury keys)
    const decryptResp = await this.request.post(`${this.BASE_URL}/payment-service/api/v1/test/decryptAES`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      data: {
        encryptedAESProperties: orderResp.encryptedKeys,
        encryptedData: orderResp.encryptedData,
        privateKey: INTEGRATORS.TREASURY.PRIVATE_KEY,
      },
    });
    const decryptData = await decryptResp.json();
    const innerJson = JSON.parse(decryptData.value);
    const paymentUrl = innerJson.urlForQR;

    console.log('✅ Treasury Order Created');

    // ბრაუზერის გახსნა
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
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

    // Transaction status შემოწმება
    if (config.ibanToCheck) {
      const txChecker = new TransactionChecker(this.request);
      const result = await txChecker.checkTransactionStatus(config.ibanToCheck);

      if (result.distributionStatus === 'SUCCESS') {
        console.log('✅ Test PASSED: Treasury transaction confirmed');
      } else {
        console.log(`ℹ️ Transaction status: ${result.distributionStatus}`);
      }
    }
  }

  private async fillTBCCard(page: any, gmail: GmailHelper) {
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ TBC OTP: ${otp}`);

    await fillOTPAndVerifyTBC(page, otp);
  }

  private async fillBOGCard(page: any, gmail: GmailHelper) {
    await page.locator('#cardNumber').fill(CARDS.BOG.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.BOG.expiry);
    await page.locator('#cvc2').fill(CARDS.BOG.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'BOG');
    console.log(`✅ BOG OTP: ${otp}`);

    await fillOTPAndVerify(page, otp);
  }
}