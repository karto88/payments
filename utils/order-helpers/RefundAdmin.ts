import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { AdminAuthPage } from '../../pages/AdminAuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC, closePaymentSuccess } from '../PaymentFlowHelper';
import { TransactionChecker } from '../transactionChecker';
import { CARDS } from '../../config/cards.config';
import { API_CONFIG } from '../../config/api.config';

interface RefundOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  refundAmount: number;
  ibanToCheck: string;
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

    // Refund API call
    console.log(`\n🔄 5. Refunding: ${config.refundAmount} GEL`);
    await this.refundOrder(accessToken, config);

    // Refund verification
    await this.verifyRefund(config);
  }

  private async refundOrder(accessToken: string, config: RefundOrderConfig) {
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

  private async verifyRefund(config: RefundOrderConfig) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 წამი ველოდებით

    const adminAuth = new AdminAuthPage(this.request);
    const adminToken = await adminAuth.authenticate();

    const transactionResponse = await this.request.post(
      `${API_CONFIG.ADMIN.BASE_URL}${API_CONFIG.ADMIN.ENDPOINTS.TRANSACTION_FILTER}`,
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        data: {}
      }
    );

    const data = await transactionResponse.json();
    const transactions = data.value.content;
    const transaction = transactions.find((t: any) => t.iban === config.ibanToCheck);

    if (!transaction) {
      console.log('❌ Transaction not found\n');
      return;
    }

    // Check refundInfo
    const expectedRefundInfo = config.refundAmount === config.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    if (transaction.refundInfo === expectedRefundInfo) {
      console.log(`✅ 6. Refund Successful (${transaction.refundInfo})\n`);
    } else {
      console.log(`❌ Refund verification failed:`);
      console.log(`   Expected: ${expectedRefundInfo}`);
      console.log(`   Actual: ${transaction.refundInfo || 'NOT_SET'}\n`);
    }
  }
}
