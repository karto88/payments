import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess } from '../PaymentFlowHelper';

type OpenBankingProvider = 'BOG' | 'TBC';

interface OpenBankingOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  provider: OpenBankingProvider;
}

export class OpenBankingHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPayOpenBanking(config: OpenBankingOrderConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      validUntil: config.validUntil,
      openBankingLinkProvider: config.provider,
    });

    console.log(`\n✅ Order Created - ${config.provider} Open Banking`);

    // ბრაუზერის გახსნა
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(paymentUrl);

    // BOG ან TBC-ის მიხედვით automation
    if (config.provider === 'BOG') {
      await this.automateBOG(page, context);
    } else {
      await this.automateTBC(page, context);
    }
  }

  private async automateBOG(page: any, context: any) {
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);

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

    // Profile არჩევა
    await page.waitForTimeout(2000);
    await page.locator('bd-button#kc-login').click();
    await page.waitForLoadState('networkidle');

    console.log('✅ BOG Login completed');

    // Account არჩევა
    await page.waitForTimeout(2000);
    await page.locator('bd-blank-input#input').click();
    await page.waitForTimeout(500);

    await page.getByText('GEL', { exact: false }).first().click();
    await page.waitForTimeout(1000);

    // COMPLETE
    await page.getByText('COMPLETE').click();
    await page.waitForLoadState('networkidle');
    console.log('✅ Payment confirmed');

    await closePaymentSuccess(page, context);
  }

  private async automateTBC(page: any, context: any) {
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);

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
}
