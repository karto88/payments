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

    // ინვოისის შიგთავსი — blob type + size (ქვითარი PDF-ია)
    const invoice = await invoicePage.evaluate(async (url: string) => {
      const r = await fetch(url);
      const blob = await r.blob();
      return { type: blob.type, size: blob.size };
    }, invoiceUrl);

    // ვამოწმებთ — ახალ ტაბში გაიხსნა ვალიდური, არა-ცარიელი PDF ქვითარი
    assertCondition(
      OP,
      invoiceUrl.startsWith('blob:') && invoice.type === 'application/pdf' && invoice.size > 1000,
      `ქვითარი არავალიდურია (type: ${invoice.type}, size: ${invoice.size})`,
      'ახალი ტაბი blob PDF-ით (application/pdf, ზომა > 0)',
      { invoiceUrl, ...invoice }
    );

    console.log(`✅ ქვითარი გაიხსნა ახალ ტაბში — PDF, ${invoice.size} bytes`);

    // PDF-ის bytes → base64 (blob-იდან) → ტექსტი (pdf-parse)
    const base64 = await invoicePage.evaluate(async (url: string) => {
      const r = await fetch(url);
      const buf = await r.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }, invoiceUrl);
    const pdfBuffer = Buffer.from(base64, 'base64');

    const { PDFParse } = require('pdf-parse');
    const parsed = await new PDFParse({ data: pdfBuffer }).getText();
    const text: string = parsed.text || '';

    // ქვითრის დეტალების ამოღება
    const amount = text.match(/Transaction amount\s+([\d.]+\s*\w+)/i)?.[1];
    const status = text.match(/Status\s+(\w+)/i)?.[1];
    const txId = text.match(/Transaction ID\s+(\d+)/i)?.[1];
    const recipientIban = text.match(/Recipient IBAN\s+(\S+)/i)?.[1];
    const dateTime = text.match(/Transaction date\/time\s+([\d.]+\s+[\d:]+)/i)?.[1];

    console.log(`\n📊 ქვითრის დეტალები:`);
    console.log(`   თანხა:          ${amount}`);
    console.log(`   სტატუსი:        ${status}`);
    console.log(`   Transaction ID: ${txId}`);
    console.log(`   მიმღები IBAN:   ${recipientIban}`);
    console.log(`   თარიღი:         ${dateTime}`);

    // ვამოწმებთ — ქვითარში წერია წარმატებული გადახდის დეტალები
    assertCondition(
      OP,
      status === 'Successful' && !!amount && !!txId,
      `ქვითრის დეტალები არასრულია (status: ${status}, amount: ${amount}, txId: ${txId})`,
      'ქვითარში: Status Successful + Transaction amount + Transaction ID',
      { amount, status, txId, recipientIban, dateTime }
    );
    console.log(`✅ ქვითრის დეტალები სწორია — ${status}, ${amount} (tx ${txId})`);

    await context.close();
  }
}
