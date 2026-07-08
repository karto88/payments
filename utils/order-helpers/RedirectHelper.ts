import { APIRequestContext, chromium, Page } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC, fillOTPAndVerify, dismissSuccessModals } from '../PaymentFlowHelper';
import { CARDS } from '../../config/cards.config';
import { assertCondition } from '../assertions';

type CardType = 'TBC' | 'BOG' | 'CREDO';

interface RedirectConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  successRedirectUri: string;
  failRedirectUri: string;
  cardType: CardType; // TBC/BOG → success, CREDO (ფული არ აქვს) → fail
}

export class RedirectHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * ორდერის შექმნა + გადახდა + redirect-ის მოლოდინი.
   * აბრუნებს ბოლო URL-ს (სადაც redirect მოხდა).
   */
  async createAndPay(config: RedirectConfig): Promise<string> {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა ორივე redirect URI-ით
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      successRedirectUri: config.successRedirectUri,
      failRedirectUri: config.failRedirectUri,
    });

    // 1️⃣ ორდერის შექმნის შემდეგ payment link უნდა დაბრუნდეს (თუ არა → product bug)
    assertCondition(
      'Create Order',
      !!paymentUrl,
      'ორდერი შეიქმნა, მაგრამ payment link (urlForQR) არ დაბრუნდა',
      'ორდერს უნდა დაებრუნებინა payment link',
      { paymentUrl }
    );
    console.log('✅ Order Created — link returned');

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

    // ბარათის შევსება
    const card = CARDS[config.cardType];
    await page.locator('#cardNumber').fill(card.number);
    await page.locator('#cardExpirationDateCustom').fill(card.expiry);
    await page.locator('#cvc2').fill(card.cvv);
    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    // 2️⃣ OTP — მოვიდა თუ არა
    let otp: string;
    try {
      otp = await gmail.getLatestOTP(30, undefined, config.cardType);
      console.log(`✅ OTP SUCCESS: ${otp}`);
    } catch (e: any) {
      console.error(`❌ OTP ERROR: OTP ვერ მოვიდა — ${e.message}`);
      throw e; // infra (არა product bug) — Jira reporter OTP-ს ისედაც არ ჩათვლის ბაგად
    }

    if (config.cardType === 'CREDO') {
      // CREDO OTP form
      await page.waitForSelector('input[name="code"]', { timeout: 10000 });
      await page.locator('input[name="code"]').fill(otp);
      await page.locator('button[name="verify"]').click();
    } else if (config.cardType === 'TBC') {
      await fillOTPAndVerifyTBC(page, otp);
    } else {
      await fillOTPAndVerify(page, otp);
    }

    // success გვერდის modal → Skip → Done (redirect-ს ეს ტრიგერავს);
    // fail-ზე ეს ღილაკები არ იქნება — უბრალოდ გამოტოვდება
    await dismissSuccessModals(page);

    // redirect-ის მოლოდინი კონკრეტულ target-ზე (success ან fail URL)
    const finalUrl = await this.waitForRedirect(page, [
      config.successRedirectUri,
      config.failRedirectUri,
    ]);

    await page.waitForTimeout(2000);
    await context.close();
    return finalUrl;
  }

  /**
   * დაელოდე redirect-ს კონკრეტულ target host-ებზე.
   * (3DS OTP გვერდი acs2.ufc.ge-ა — ამიტომ "keepz-გარეთ" არ გამოდგება, host-ს ვამოწმებთ)
   */
  private async waitForRedirect(page: Page, targets: string[]): Promise<string> {
    const hosts = targets.map((t) => new URL(t).host); // lingolandedu.com, www.istockphoto.com
    const reached = (url: URL) => hosts.some((h) => url.host.includes(h) || url.href.includes(h));

    try {
      await page.waitForURL(reached, { timeout: 40000 });
      return page.url();
    } catch {
      // CREDO fail — error modal-ის OK ღილაკი, მერე redirect
      try {
        await page.locator('button:has-text("OK")').click({ timeout: 3000 });
      } catch {
        /* modal არ იყო */
      }
      await page.waitForURL(reached, { timeout: 40000 }).catch(() => {});
      return page.url();
    }
  }
}
