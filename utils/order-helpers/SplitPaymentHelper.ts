import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { TransactionChecker } from '../transactionChecker';
import { CARDS } from '../../config/cards.config';
import { assertCondition, assertField } from '../assertions';

const OP = 'Split order — transactions status';

interface SplitDetail {
  receiverType: 'BRANCH' | 'IBAN';
  receiverIdentifier: string;
  amount: number;
}

interface SplitOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  validUntil?: string;
  splitDetails: SplitDetail[];
  ibanToCheck?: string;
}

export class SplitPaymentHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createAndPaySplitOrder(config: SplitOrderConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    // Gmail helper - წაშალოს ძველი OTP-ები
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    // ავტორიზაცია
    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      validUntil: config.validUntil,
      splitDetails: config.splitDetails,
    });

    console.log('✅ Order Created');

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

    // TBC ბარათის შევსება
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    // OTP მიღება და შევსება
    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ OTP: ${otp}`);

    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle');

    // Success modal დახურვა
    await closePaymentSuccess(page, context);

    // Split-ის შემოწმება — მშობელი + ყველა შვილი (SUCCESS ან PENDING მისაღებია, FAILED/WAITING არა)
    const txChecker = new TransactionChecker(this.request);
    const { parent, children } = await txChecker.getSplitStatuses(config.amount);

    // მშობელი უნდა არსებობდეს
    assertCondition(
      OP,
      !!parent,
      'split-ის მშობელი ტრანზაქცია ვერ მოიძებნა',
      `hasChildren მშობელი initialAmount=${config.amount}-ით`,
      { found: !!parent }
    );

    // ყველა შვილი უნდა არსებობდეს
    assertCondition(
      OP,
      children.length === config.splitDetails.length,
      `შვილების რაოდენობა: ${children.length}, უნდა ${config.splitDetails.length}`,
      `${config.splitDetails.length} შვილი ტრანზაქცია`,
      { childrenCount: children.length }
    );

    // მშობელი + ყველა შვილი — distributionStatus უნდა იყოს SUCCESS.
    // (getSplitStatuses უკვე ცდილობს status-update-ით SUCCESS-მდე მიყვანას.)
    assertField(`${OP} — parent (tx ${parent.id})`, parent, 'distributionStatus', 'SUCCESS');
    for (const child of children) {
      assertField(`${OP} — child (tx ${child.id})`, child, 'distributionStatus', 'SUCCESS');
    }

    // თანხის შემოწმება — თითო შვილს ზუსტად request-ის (splitDetails) თანხა უნდა დაუჯდეს
    const requestedAmounts = config.splitDetails.map((s) => s.amount).sort((a, b) => a - b);
    const childAmounts = children.map((c: any) => c.initialAmount).sort((a: number, b: number) => a - b);
    assertCondition(
      `${OP} — amounts`,
      requestedAmounts.length === childAmounts.length &&
        requestedAmounts.every((a, i) => Math.abs(a - childAmounts[i]) < 0.001),
      `ჩარიცხული თანხები არ ემთხვევა request-ს`,
      `თითო მხარეს request-ის თანხა: [${requestedAmounts.join(', ')}]`,
      { requested: requestedAmounts, actual: childAmounts }
    );

    // ლამაზი ლოგი — parent + შვილები, status + რამდენი დაერიცხა
    console.log(`\n✅ Split ორდერი გადახდილია:`);
    console.log(`   parent ${parent.id} = ${parent.distributionStatus}`);
    console.log(
      `   children ${children
        .map((c: any) => `${c.id} = ${c.distributionStatus} (${c.initialAmount} ლარი)`)
        .join(',  ')}`
    );

    return { parent, children };
  }
}
