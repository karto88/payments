import { chromium } from '@playwright/test';
import { AuthDevicePage } from '../../../pages/AuthDevicePage';
import { GmailHelper } from '../../GmailHelper';
import { CARDS } from '../../../config/cards.config';
import { assertCondition, assertField } from '../../assertions';
import { AddMoneyHelper } from '../AddMoneyHelper';

const OP_ADD_MONEY = 'POST /wallet/add-money (negative)';
const OP_PAGE = 'Add money — payment page (negative)';
const OP_FAILED = 'Add money — failed payment (negative)';
const OP_PAYMENT_LINK = 'Payment link — ბალანსი არ უნდა გაიზარდოს';

/**
 * Balance Top-up (KD-2355) — ნეგატიური ქეისები. reuse: AddMoneyHelper (add-money, ბალანსი, BOG ბარათი).
 *   1. expectPageAmountRangeError — მეთოდის max ლიმიტზე მეტი თანხა → გადახდის გვერდზე ერორი, ფორმა არ იხსნება
 *   2. expectAddMoneyRejected     — დღიურ ლიმიტზე მეტი თანხა → add-money endpoint-მა მაშინვე უნდა უარყოს
 *   3. payWithWrongCvv            — არასწორი CVV → გადახდა ჩავარდება, ბალანსი/ისტორია უცვლელი
 *   4. payWithInsufficientFunds   — BOG ბარათი, თანხა ანგარიშზე არ არის → acquiring FAIL, ბალანსი/ისტორია უცვლელი
 */
export class AddMoneyNegativeHelper extends AddMoneyHelper {
  /** 1. გადახდის გვერდზე „საბანკო ბარათი" → ერორი „თანხა უნდა იყოს დიაპაზონში", ბარათის ფორმა არ უნდა გაიხსნას */
  async expectPageAmountRangeError(config: { amount: number; phone?: string }) {
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone || '591078180');
    const paymentUrl = await this.addMoney(deviceToken, config.amount, 'GEL');
    console.log(`✅ Payment URL: ${paymentUrl}`);

    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    try {
      const page = await browser.newPage();
      await page.goto(paymentUrl);
      console.log('✅ Payment page opened');

      await page.waitForTimeout(2000); // გვერდი ჩანდეს დაკლიკებამდე
      await page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ }).click();
      console.log('✅ Clicked: Bank card (standard)');

      // ერორის მოდალი — სათაური (h2) + OK ღილაკი
      const modalTitle = page.locator('h2', { hasText: /თანხა უნდა იყოს დიაპაზონში|Amount should be in range/ });
      const modalShown = await modalTitle.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
      const modalText = modalShown ? (await modalTitle.innerText()).trim() : null;
      const cardFormOpened = (await page.locator('#cardNumber').count()) > 0;

      console.log(`\n📊 ${config.amount} GEL — ბარათის ლიმიტზე (3000) მეტი თანხა`);
      console.log(`   ერორის მოდალი: ${modalShown ? `„${modalText}" ✅` : 'არ გამოჩნდა ❌'}`);
      console.log(`   გადახდა: ${cardFormOpened ? 'ბარათის მონაცემების შესაყვანი გვერდი მაინც გაიხსნა ❌' : 'დაიბლოკა — ბარათის მონაცემების შესაყვან გვერდზე არ გადავიდა ✅'}`);
      assertCondition(
        OP_PAGE,
        modalShown && !cardFormOpened,
        `${config.amount} GEL — max ლიმიტზე მეტი თანხით ბარათით გადახდა არ დაიბლოკა`,
        'ერორის მოდალი „Amount should be in range" / „თანხა უნდა იყოს დიაპაზონში" და ბარათის ფორმა არ იხსნება',
        { amount: config.amount, modalShown, modalText, cardFormOpened, url: page.url() }
      );

      await page.waitForTimeout(3000); // მოდალი ეკრანზე ჩანდეს
      // OK ღილაკი h2-ის გვერდითაა; ტექსტი „Ok"-ია (ეკრანზე CSS uppercase-ით „OK" ჩანს)
      await modalTitle.locator('xpath=following-sibling::button').filter({ hasText: /^\s*ok\s*$/i }).click();
      // დახურვისას მოდალი DOM-ში რჩება — overlay იღებს opacity-0 კლასს (გამჭვირვალე ხდება)
      const overlay = modalTitle.locator('xpath=ancestor::div[contains(@class,"fixed")][1]');
      let modalClosed = false;
      for (let i = 0; i < 10 && !modalClosed; i++) {
        modalClosed = /\bopacity-0\b/.test((await overlay.getAttribute('class')) || '');
        if (!modalClosed) await page.waitForTimeout(500);
      }
      assertCondition(
        OP_PAGE,
        modalClosed,
        'OK-ზე დაჭერის შემდეგ ერორის მოდალი არ დაიხურა',
        'OK → მოდალი იხურება (overlay opacity-0)',
        { overlayClass: await overlay.getAttribute('class') }
      );
      console.log('✅ Modal closed (OK)');
    } finally {
      await browser.close();
    }
  }

  /**
   * 2. add-money endpoint-მა უნდა დააბრუნოს ერორი (არა 2xx, payment link არ უნდა დაბრუნდეს).
   * expectedError — თუ მითითებულია, response body ველ-ველ ედარება (message, statusCode, exceptionGroup).
   *   message — ზუსტი დამთხვევა; messageContains — გრძელი (Spring validation) message-ისთვის, ნაწილობრივი დამთხვევა.
   */
  async expectAddMoneyRejected(config: {
    amount: number;
    currencyCode: string;
    phone?: string;
    reason: string; // რატომ უნდა უარყოს — assert-ის ტექსტისთვის (მაგ. „დღიურ ლიმიტზე მეტი")
    expectedHttpStatus?: number;
    expectedError?: { message?: string; messageContains?: string; statusCode: number; exceptionGroup: number };
  }) {
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone || '591078180');
    const response = await this.request.post(
      'https://walletportal.dev.keepz.me/api/v1/wallet/add-money',
      {
        headers: { 'Authorization': `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
        data: { amount: config.amount, currencyCode: config.currencyCode },
      }
    );
    const body = await response.json().catch(async () => response.text());
    const rejected = !response.ok();

    // მოსალოდნელი vs მოვიდა — ველ-ველ (როგორც პოზიტიურ ტესტებში)
    const mark = (ok: boolean) => (ok ? '✅' : '❌');
    const status = response.status();
    console.log(`\n📊 add-money ${config.amount} ${config.currencyCode || '(ცარიელი)'} — ${config.reason}`);
    if (!rejected) {
      console.log(`   მოსალოდნელი: ერორი, payment link არ უნდა დაბრუნდეს · მოვიდა: HTTP ${status}, payment link ❌`);
    } else if (!config.expectedHttpStatus && !config.expectedError) {
      console.log(`   მოსალოდნელი: ერორი · მოვიდა: HTTP ${status} — ${JSON.stringify(body)} ✅`);
    }
    if (rejected && config.expectedHttpStatus) {
      console.log(`   HTTP status:    მოსალოდნელი ${config.expectedHttpStatus} · მოვიდა ${status} ${mark(status === config.expectedHttpStatus)}`);
    }
    if (rejected && config.expectedError) {
      const e = config.expectedError;
      if (e.message !== undefined) {
        console.log(`   message:        მოსალოდნელი „${e.message}" · მოვიდა „${body?.message}" ${mark(body?.message === e.message)}`);
      }
      if (e.messageContains !== undefined) {
        console.log(`   message:        მოსალოდნელი შეიცავდეს „${e.messageContains}" · ${String(body?.message ?? '').includes(e.messageContains) ? 'შეიცავს ✅' : `არ შეიცავს ❌ („${body?.message}")`}`);
      }
      console.log(`   statusCode:     მოსალოდნელი ${e.statusCode} · მოვიდა ${body?.statusCode} ${mark(body?.statusCode === e.statusCode)}`);
      console.log(`   exceptionGroup: მოსალოდნელი ${e.exceptionGroup} · მოვიდა ${body?.exceptionGroup} ${mark(body?.exceptionGroup === e.exceptionGroup)}`);
    }

    assertCondition(
      OP_ADD_MONEY,
      rejected,
      `${config.amount} ${config.currencyCode} — ${config.reason}, მაგრამ add-money-მ მიიღო და payment link დააბრუნა (HTTP ${response.status()})`,
      `add-money უნდა ჩავარდეს ერორით (${config.reason}), payment link არ უნდა დაბრუნდეს`,
      body
    );

    if (config.expectedHttpStatus) {
      assertCondition(
        OP_ADD_MONEY,
        response.status() === config.expectedHttpStatus,
        `HTTP status არ ემთხვევა — მოვიდა ${response.status()}`,
        `HTTP ${config.expectedHttpStatus}`,
        body
      );
    }
    if (config.expectedError) {
      if (config.expectedError.message !== undefined) {
        assertField(OP_ADD_MONEY, body, 'message', config.expectedError.message);
      }
      if (config.expectedError.messageContains !== undefined) {
        assertCondition(
          OP_ADD_MONEY,
          String(body?.message ?? '').includes(config.expectedError.messageContains),
          `message არ შეიცავს „${config.expectedError.messageContains}"`,
          `message შეიცავს „${config.expectedError.messageContains}"`,
          body
        );
      }
      assertField(OP_ADD_MONEY, body, 'statusCode', config.expectedError.statusCode);
      assertField(OP_ADD_MONEY, body, 'exceptionGroup', config.expectedError.exceptionGroup);
    }
    console.log('   ✅ add-money უარყო მოსალოდნელი ერორით');
  }

  /** 3. არასწორი CVV — TBC ბარათი, CVV 444 */
  async payWithWrongCvv(config: { amount: number; phone?: string }) {
    await this.expectFailedPaymentNotCredited(config, 'არასწორი CVV (444)', async (page) => {
      await page.locator('#cardNumber').fill(CARDS.TBC.number);
      await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
      await page.locator('#cvc2').fill('444'); // ⚠️ არასწორი CVV
      await page.locator('#payment-submit').click();
      console.log('✅ Submitted — wrong CVV (444)');
    });
  }

  /** 4. BOG ბარათი — ანგარიშზე თანხა არ არის → acquiring FAIL */
  async payWithInsufficientFunds(config: { amount: number; phone?: string }) {
    await this.expectFailedPaymentNotCredited(config, 'BOG ბარათი — არასაკმარისი თანხა', async (page, gmail) => {
      await this.fillBOGCard(page, gmail);
    });
  }

  /**
   * add money → წარუმატებელი გადახდა → ბალანსი არ უნდა გაიზარდოს და merchant-ის ისტორიაში
   * ახალი TOP_UP ტრანზაქცია არ უნდა გამოჩნდეს (Failed top-up ისტორიაში არ ჩანს).
   */
  private async expectFailedPaymentNotCredited(
    config: { amount: number; phone?: string },
    caseName: string,
    pay: (page: any, gmail: GmailHelper) => Promise<void>
  ) {
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone || '591078180');
    const balanceBefore = await this.getBalance(deviceToken, 'GEL');
    const lastTxIdBefore = (await this.getTransactions(deviceToken))[0]?.id;
    console.log(`✅ Balance before: ${balanceBefore} GEL`);

    const paymentUrl = await this.addMoney(deviceToken, config.amount, 'GEL');
    console.log(`✅ Payment URL: ${paymentUrl}`);

    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
    });
    try {
      const page = await context.newPage();
      await page.goto(paymentUrl);
      console.log('✅ Payment page opened');

      await page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ }).click();
      await page.waitForTimeout(2000);
      await pay(page, gmail);
      await page.waitForTimeout(10000); // ველოდებით უარყოფას
    } finally {
      await context.close();
    }

    // ბალანსი არ უნდა შეიცვალოს — ~30წმ ვაპოლინგებთ, თუ შეიცვალა → ცუდია
    let balanceAfter = balanceBefore;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      balanceAfter = await this.getBalance(deviceToken, 'GEL');
      if (Math.abs(balanceAfter - balanceBefore) > 0.001) break;
    }
    const changed = Math.round((balanceAfter - balanceBefore) * 100) / 100;

    // ისტორიაში ჩვენი წარუმატებელი top-up არ უნდა გამოჩნდეს
    const transactions = await this.getTransactions(deviceToken);
    const newIdx = transactions.findIndex((t: any) => t.id === lastTxIdBefore);
    const newTxs = newIdx === -1 ? transactions : transactions.slice(0, newIdx);
    const newTopUp = newTxs.find((t: any) => t.operationType === 'TOP_UP' && t.initialAmount === config.amount);

    console.log(`\n📊 Add money — ${caseName} · ${config.amount} GEL`);
    console.log(`   ბალანსი: იყო ${balanceBefore} → გახდა ${balanceAfter} GEL (ცვლილება ${changed})`);
    console.log(`   ისტორიაში ახალი TOP_UP: ${newTopUp ? `ჩანს ❌ (status=${newTopUp.status})` : 'არ ჩანს ✅'}`);

    assertCondition(
      OP_FAILED,
      Math.abs(changed) < 0.001,
      `${caseName}: წარუმატებელ გადახდაზე ბალანსი შეიცვალა (${changed} GEL)`,
      'ბალანსი უცვლელი — წარუმატებელი top-up არ უნდა დაირიცხოს',
      { balanceBefore, balanceAfter, changed }
    );
    assertCondition(
      OP_FAILED,
      !newTopUp,
      `${caseName}: წარუმატებელი top-up ჩანს merchant-ის ტრანზაქციების ისტორიაში`,
      'Failed top-up ისტორიაში არ უნდა ჩანდეს',
      newTopUp
    );
    console.log('   ✅ ბალანსი არ დაირიცხა, ისტორიაში არ ჩანს');
  }

  /**
   * merchant-ის payment link-ით (პროდუქტის ლინკი) ბარათით გადახდა — ეს ჩვეულებრივი გადახდაა და არა add money:
   * STANDARD flow-ზე თანხა IBAN-ზე მიდის → ბალანსი არ უნდა გაიზარდოს და ტრანზაქცია TOP_UP არ უნდა იყოს.
   */
  async payPaymentLinkBalanceNotCredited(config: { paymentLink: string; amount: number; phone?: string }) {
    await this.updateMerchant({ distributionFlow: 'STANDARD' });
    console.log('✅ Merchant updated: distributionFlow=STANDARD');

    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone || '591078180');
    const balanceBefore = await this.getBalance(deviceToken, 'GEL');
    const idsBefore = new Set((await this.getTransactions(deviceToken)).map((t: any) => t.id));
    console.log(`✅ Balance before: ${balanceBefore} GEL`);

    // ლინკით გადახდა (ბარათი)
    const context = await chromium.launchPersistentContext('./playwright-card-data', { headless: false, channel: 'chrome' });
    try {
      const page = await context.newPage();
      await page.goto(config.paymentLink);
      console.log('✅ Payment page opened');
      await page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ }).click();
      await page.waitForTimeout(2000);
      await this.fillTBCCard(page, gmail);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    } finally {
      await context.close().catch(() => {});
    }

    // ჩვენი გადახდა merchant-ის სიაში — ახალი ტრანზაქცია ამ თანხით (გადახდა მართლა მოხდა)
    let tx: any;
    for (let i = 0; i < 20 && !tx; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      tx = (await this.getTransactions(deviceToken)).find((t: any) => !idsBefore.has(t.id) && t.initialAmount === config.amount);
    }

    // ბალანსი არ უნდა შეიცვალოს — ~30წმ ვაპოლინგებთ, თუ შეიცვალა → ცუდია
    let balanceAfter = balanceBefore;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      balanceAfter = await this.getBalance(deviceToken, 'GEL');
      if (Math.abs(balanceAfter - balanceBefore) > 0.001) break;
    }
    const changed = Math.round((balanceAfter - balanceBefore) * 100) / 100;

    console.log(`\n📊 Payment link — ${config.amount} GEL (STANDARD flow)`);
    console.log(`   ტრანზაქცია: ${tx ? `tx ${tx.id} · operationType=${tx.operationType} · status=${tx.status}` : 'ვერ მოიძებნა ❌'} (TOP_UP არ უნდა იყოს)`);
    console.log(`   ბალანსი: იყო ${balanceBefore} → გახდა ${balanceAfter} GEL (ცვლილება ${changed}, უნდა იყოს 0)`);

    assertCondition(OP_PAYMENT_LINK, !!tx, `payment link-ით გადახდის ტრანზაქცია ვერ მოიძებნა (${config.amount} GEL)`,
      `ახალი ტრანზაქცია ${config.amount} GEL`, { paymentLink: config.paymentLink });
    assertCondition(OP_PAYMENT_LINK, tx.operationType !== 'TOP_UP', `payment link-ით გადახდა TOP_UP-ად ჩაიწერა (tx ${tx.id})`,
      'operationType ≠ TOP_UP — ეს ჩვეულებრივი გადახდაა და არა add money', tx);
    assertCondition(OP_PAYMENT_LINK, Math.abs(changed) < 0.001, `payment link-ით გადახდაზე ბალანსი გაიზარდა (${changed} GEL)`,
      'ბალანსი უცვლელი — STANDARD flow-ზე თანხა IBAN-ზე მიდის და არა ბალანსზე', { balanceBefore, balanceAfter, changed });
    console.log('   ✅ ბალანსი არ შეცვლილა, ტრანზაქცია TOP_UP არ არის');
  }

  /** merchant-ის ბოლო ტრანზაქციები (device token) */
  private async getTransactions(token: string): Promise<any[]> {
    const response = await this.request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=0&limit=10',
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { sentOrReceived: 'ALL', senderInfo: '', recipientInfo: '' },
      }
    );
    return (await response.json()).value?.transactionsPage?.content || [];
  }
}
