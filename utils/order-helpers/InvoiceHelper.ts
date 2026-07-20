import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';
import { assertCondition } from '../assertions';

const OP = 'Invoice download (success page)';

interface InvoiceOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
}

/**
 * ქვითრის ჩეკი — გადახდის success გვერდზე ქვითრის გადმოწერა.
 * flow: DefaultOrderHelper-ის იგივე გადახდა (TBC ბარათი), მერე success გვერდზე:
 *   1) QR / download-keepz modal-ის ჩახურვა (#download-keepz-modal-close)
 *   2) ქვითრის ღილაკი (#success-download-invoice) → ახალი ტაბი იხსნება ქვითრით
 */
export class InvoiceHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createPayAndDownloadInvoice(config: InvoiceOrderConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
    });
    console.log('✅ Order Created');

    // ბრაუზერი
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome',
    });
    const page = await context.newPage();
    await page.goto(paymentUrl);
    console.log('✅ Payment page opened');

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
    console.log(`✅ OTP: ${otp}`);
    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle');

    // success გვერდი — 1) QR/download-keepz modal-ის ჩახურვა (რომ ქვითრის ღილაკი გამოჩნდეს)
    await page.waitForTimeout(3000);
    try {
      await page.locator('#download-keepz-modal-close').click({ timeout: 8000 });
      console.log('✅ QR modal ჩაიხურა');
      await page.waitForTimeout(1000);
    } catch {
      console.log('ℹ️ QR modal არ იყო');
    }

    // 2) ქვითრის გადმოწერა → ახალი ტაბი იხსნება ქვითრით
    const [invoicePage] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }),
      page.locator('#success-download-invoice').click(),
    ]);
    await invoicePage.waitForLoadState('domcontentloaded');
    const invoiceUrl = invoicePage.url();

    // ვამოწმებთ — ახალი ტაბი გაიხსნა ქვითრით
    assertCondition(
      OP,
      !!invoiceUrl && invoiceUrl !== 'about:blank',
      'ქვითრის ტაბი ვერ გაიხსნა',
      'success-download-invoice → ახალი ტაბი ქვითრით',
      { invoiceUrl }
    );

    console.log(`✅ ქვითარი გაიხსნა ახალ ტაბში: ${invoiceUrl}`);

    await context.close();
  }
}
