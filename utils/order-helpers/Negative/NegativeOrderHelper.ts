import { APIRequestContext, chromium } from '@playwright/test';
import { AuthPage } from '../../../pages/AuthPage';
import { AuthDevicePage } from '../../../pages/AuthDevicePage';
import { PaymentPage } from '../../../pages/PaymentPage';
import { CARDS } from '../../../config/cards.config';
import { assertCondition } from '../../assertions';

const OP = 'Negative — order/payment';

interface NegativeOrderConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
}

interface WrongCvvConfig extends NegativeOrderConfig {
  phone: string; // merchant device login — ბალანსის შესამოწმებლად (BALANCE flow-იანი)
}

/**
 * ნეგატიური ქეისების helper (ერთი, ორი მეთოდით):
 *   1. attemptOrder     — ორდერის შექმნა არასწორი input-ით → უნდა უარყოს (ბრაუზერის გარეშე)
 *   2. payWithWrongCvv  — არასწორი CVV-ით გადახდა → ბალანსი არ უნდა დაერიცხოს (ბრაუზერით)
 */
export class NegativeOrderHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * ორდერის შექმნა არასწორი input-ით.
   *   rejected: true  → ორდერი უარყო (error/throw) — ნეგატიური ქეისისთვის კარგია ✅
   *   rejected: false → ორდერი შეიქმნა (paymentUrl დაბრუნდა) — ცუდია ❌
   */
  async attemptOrder(config: NegativeOrderConfig): Promise<{ rejected: boolean; detail: string }> {
    const accessToken = await new AuthPage(this.request).authenticate();
    const paymentPage = new PaymentPage(this.request, null as any);

    try {
      const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
        amount: config.amount,
        receiverId: config.receiverId,
        receiverType: config.receiverType,
        integratorId: config.integratorId,
      });
      return {
        rejected: false,
        detail: `order შეიქმნა (paymentUrl: ${String(paymentUrl).slice(0, 50)}...)`,
      };
    } catch (e: any) {
      return { rejected: true, detail: String(e?.message || e).slice(0, 250) };
    }
  }

  /**
   * არასწორი CVV-ით გადახდა → გადახდა უნდა ჩავარდეს, merchant-ის ბალანსი **არ უნდა დაერიცხოს**
   * (BALANCE flow-ზე წარმატება დაარიცხავდა).
   */
  async payWithWrongCvv(config: WrongCvvConfig) {
    const deviceToken = await new AuthDevicePage(this.request).authenticate(config.phone);
    const balanceBefore = await this.getBalance(deviceToken);
    console.log(`✅ Balance before: ${balanceBefore} ₾`);

    const accessToken = await new AuthPage(this.request).authenticate();
    const paymentPage = new PaymentPage(this.request, null as any);
    const { paymentUrl } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
    });
    console.log('✅ Order Created');

    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome',
    });
    const page = await context.newPage();
    await page.goto(paymentUrl);
    await page.locator('button', { hasText: 'საბანკო ბარათი' }).click();
    await page.waitForTimeout(2000);
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill('000'); // ⚠️ არასწორი CVV (სწორია 581)
    await page.locator('#payment-submit').click();
    console.log('✅ Submitted — wrong CVV (000)');
    await page.waitForTimeout(10000); // ველოდებით უარყოფას
    await context.close();

    // ბალანსი არ უნდა დაერიცხოს — ~30წმ ვაპოლინგებთ, თუ შეიცვალა → ცუდია
    let balanceAfter = balanceBefore;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      balanceAfter = await this.getBalance(deviceToken);
      if (Math.abs(balanceAfter - balanceBefore) > 0.001) break;
    }
    const changed = Math.round((balanceAfter - balanceBefore) * 100) / 100;

    console.log(`\n📊 ბალანსი: იყო ${balanceBefore} ₾ → ${balanceAfter} ₾ (ცვლილება ${changed} ₾)`);
    assertCondition(
      OP,
      Math.abs(changed) < 0.001,
      `არასწორ CVV-ზე ბალანსი დაერიცხა (+${changed} ₾) — არ უნდა დარიცხულიყო`,
      'ბალანსი უცვლელი — არასწორი CVV-ით გადახდა უნდა ჩავარდეს',
      { balanceBefore, balanceAfter, changed }
    );
    console.log('✅ ბალანსი არ დაერიცხა — არასწორი CVV-ით გადახდა ჩავარდა');
  }

  private async getBalance(token: string): Promise<number> {
    const response = await this.request.get(
      'https://gateway.dev.keepz.me/payment-service/api/v1/merchant-balance',
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const gel = (data.value || []).find((b: any) => b.currency === 'GEL');
    return gel ? gel.amount : 0;
  }
}