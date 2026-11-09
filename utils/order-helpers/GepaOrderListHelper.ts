import { APIRequestContext, chromium } from '@playwright/test';
import * as crypto from 'crypto';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { closePaymentSuccess, fillOTPAndVerifyTBC } from '../PaymentFlowHelper';
import { OrderListHelper } from './OrderListHelper';
import { assertCondition } from '../assertions';
import { CARDS } from '../../config/cards.config';

const OP = 'GET /integrator/order/list (branchId)';

interface GepaOrderListConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
}

/**
 * GEPA order list — branchId ფილტრი:
 *   1. ორდერის შექმნა — ჩვეულებრივი ორდერი + branchId (ყოველ ჯერზე ახალი random UUID, integratorOrderId-სგან ცალკე)
 *   2. გადახდა — სტანდარტული card-fill + OTP flow (როგორც DefaultOrderHelper)
 *   3. GET order list იმავე branchId-ით → სიაში მხოლოდ ჩვენი ერთი ორდერი
 */
export class GepaOrderListHelper {
  constructor(private request: APIRequestContext) {}

  async createPayAndCheckList(config: GepaOrderListConfig) {
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const accessToken = await authPage.authenticate();

    // ორდერის შექმნა — branchId ცალკე random UUID
    const branchId = crypto.randomUUID();
    const from = this.now();
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      branchId,
    });
    console.log(`✅ Order Created — ${integratorOrderId} · branchId ${branchId}`);

    // გადახდა (TBC)
    const context = await chromium.launchPersistentContext('./playwright-card-data', {
      headless: false,
      channel: 'chrome'
    });
    const page = await context.newPage();
    await page.goto(paymentUrl);
    await page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ }).click();
    await page.waitForTimeout(2000);
    await this.fillTBCCard(page, gmail);
    await page.waitForLoadState('networkidle');
    await closePaymentSuccess(page, context);

    // სიის წამოღება იმავე branchId-ით (SUCCESS სიაში შეიძლება ცოტა დაგვიანებით გამოჩნდეს)
    const filter = { from, to: `${from.slice(0, 10)} 23:59:59`, branchId };
    let list: any;
    for (let i = 0; i < 6; i++) {
      list = await paymentPage.getOrderList(accessToken, config.integratorId, filter);
      if (list.orders?.length) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    new OrderListHelper(this.request).verifyList(list, { integratorId: config.integratorId, ...filter });

    // სიაში ზუსტად ჩვენი ერთი ორდერი
    const orders: any[] = list.orders || [];
    const order = orders[0];
    assertCondition(OP, orders.length === 1 && order.integratorOrderId === integratorOrderId,
      `branchId-ით მოვიდა ${orders.length} ორდერი (${orders.map((o) => o.integratorOrderId).join(', ') || 'ცარიელი'})`,
      `მხოლოდ 1 ორდერი — ${integratorOrderId}`, list);
    assertCondition(OP, Number(order.amount) === config.amount && order.status === 'SUCCESS',
      `ორდერი: amount ${order.amount}, status ${order.status}`,
      `amount ${config.amount}, status SUCCESS`, order);
    assertCondition(OP, Number(list.sumAmount) === config.amount && Number(list.transactionQuantity) === 1,
      `ჯამები: sumAmount ${list.sumAmount}, transactionQuantity ${list.transactionQuantity}`,
      `sumAmount ${config.amount}, transactionQuantity 1`, list);
  }

  /** "yyyy-MM-dd HH:mm:ss" — თბილისის დრო */
  private now() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tbilisi' });
  }

  private async fillTBCCard(page: any, gmail: GmailHelper) {
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);

    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    await fillOTPAndVerifyTBC(page, otp);
  }
}
