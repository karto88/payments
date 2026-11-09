import { APIRequestContext } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { assertCondition, assertKeysPresent } from '../assertions';

const OP = 'GET /integrator/order/list';

// სიაში მხოლოდ ეს სტატუსები ბრუნდება (FAILED / CANCELLED / EXPIRED / PENDING — არა)
const ALLOWED_STATUSES = [
  'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUND_REQUESTED',
  'REFUNDED_BY_INTEGRATOR', 'REFUNDED_BY_OPERATOR', 'REFUNDED_BY_KEEPZ',
];
const FULLY_REFUNDED = ['REFUND_REQUESTED', 'REFUNDED_BY_INTEGRATOR', 'REFUNDED_BY_OPERATOR', 'REFUNDED_BY_KEEPZ'];

interface OrderListConfig {
  integratorId: string;
  from: string;      // "yyyy-MM-dd HH:mm:ss" (თბილისის დრო)
  to: string;
  branchId?: string; // არ არის → ყველა ფილიალი
}

/**
 * Get Order List — ინტეგრატორის დასრულებული / დარეფანდებული ორდერები პერიოდში + ჯამები.
 * კრიპტაცია იგივეა რაც order/status-ზე (encryptAES → GET → decryptAES), იხ. PaymentPage.getOrderList.
 */
export class OrderListHelper {
  constructor(private request: APIRequestContext) {}

  /** სიის წამოღება → ველები + სტატუსები + რაოდენობები orders-ს ემთხვევა */
  async checkOrderList(config: OrderListConfig) {
    const accessToken = await new AuthPage(this.request).authenticate();
    const paymentPage = new PaymentPage(this.request, null as any);

    const filter = { from: config.from, to: config.to, ...(config.branchId ? { branchId: config.branchId } : {}) };
    const list = await paymentPage.getOrderList(accessToken, config.integratorId, filter);
    return this.verifyList(list, config);
  }

  /** გაშიფრული სიის შემოწმება — checkOrderList-იც და GepaOrderListHelper-იც ამას იყენებს */
  verifyList(list: any, config: OrderListConfig, env = '') {
    const orders: any[] = list.orders || [];

    console.log(`📋 Order list${env} — ${config.from} → ${config.to}${config.branchId ? ` · branch ${config.branchId}` : ''}`);
    console.log(`   ორდერები: ${orders.length} · sumAmount ${list.sumAmount} · refundedAmount ${list.refundedAmount}`);
    console.log(`   SUCCESS ${list.transactionQuantity} · refunded ${list.refundedTransactionQuantity} · partially refunded ${list.partiallyRefundedTransactionQuantity}`);

    // ჯამების ველები
    assertKeysPresent(OP, list, ['sumAmount', 'refundedAmount', 'transactionQuantity',
      'refundedTransactionQuantity', 'partiallyRefundedTransactionQuantity', 'orders']);

    // ყოველ ორდერს ყველა ველი აქვს და სტატუსი დაშვებულია
    for (const order of orders) {
      assertKeysPresent(OP, order, ['integratorOrderId', 'receiverId', 'amount', 'refundedAmount', 'status', 'orderTime']);
    }
    const wrongStatus = orders.filter((o) => !ALLOWED_STATUSES.includes(o.status));
    assertCondition(OP, !wrongStatus.length,
      `სიაში არის დაუშვებელი სტატუსის ორდერი: ${wrongStatus.map((o) => `${o.integratorOrderId} (${o.status})`).join(', ')}`,
      `მხოლოდ ${ALLOWED_STATUSES.join(' / ')}`, wrongStatus);

    // რაოდენობები = orders-ში დათვლილი
    const count = (statuses: string[]) => orders.filter((o) => statuses.includes(o.status)).length;
    const expected = {
      transactionQuantity: count(['SUCCESS']),
      refundedTransactionQuantity: count(FULLY_REFUNDED),
      partiallyRefundedTransactionQuantity: count(['PARTIALLY_REFUNDED']),
    };
    for (const [field, value] of Object.entries(expected)) {
      assertCondition(OP, Number(list[field]) === value, `${field}: მოვიდა ${list[field]}, orders-ში დაითვალა ${value}`,
        `${field} = ${value}`, { [field]: list[field], ordersCount: orders.length });
    }

    return list;
  }
}
