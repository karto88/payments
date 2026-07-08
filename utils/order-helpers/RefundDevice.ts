import { APIRequestContext, chromium } from '@playwright/test';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC, closePaymentSuccess } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';

interface DeviceRefundConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  refundAmount: number;
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

    // Device ავტორიზაცია - ერთხელ
    const authDevice = new AuthDevicePage(this.request);
    const accessToken = await authDevice.authenticate();

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

    // პირველი ტრანზაქციის ID
    this.transactionId = transactions[0].id;
    console.log(`✅ 4. Transaction ID: ${this.transactionId}`);

    // Refund API call
    console.log(`\n🔄 5. Refunding: ${config.refundAmount} GEL`);
    await this.refundTransaction(accessToken, config);

    // Verify refund
    await this.verifyRefund(accessToken, config);
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

    if (!transaction) {
      console.log(`❌ Transaction ID ${this.transactionId} not found\n`);
      return;
    }

    const expectedStatus = config.refundAmount === config.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    console.log(`   Transaction ID: ${transaction.id}`);
    console.log(`   Current Status: ${transaction.status}`);
    console.log(`   Expected Status: ${expectedStatus}`);

    if (transaction.status === expectedStatus) {
      console.log(`✅ 6. Refund Verified (${transaction.status})\n`);
    } else {
      console.log(`❌ 6. Refund verification failed\n`);
    }
  }
}
