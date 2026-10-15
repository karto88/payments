import { test } from '@playwright/test';
import { RefundIntegrator } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// INTEGRATOR refund — ecommerce refund (encrypt → POST → decrypt), admin refund-ისგან ცალკე.
// full → refundAmount არ გადავცემთ (omit) | partial → refundAmount.
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';
const IBAN = 'GE29TB7197445064300124';

test.describe('Refund — INTEGRATOR (Sender 591030202)', () => {
  test('როცა ინტეგრატორი Partially Refunded აკეთებს — და Merchant საკომისიო არის Sender', async ({ request }) => {
    test.setTimeout(180000);
    await new RefundIntegrator(request).createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      refundAmount: 0.05, // partial
      ibanToCheck: IBAN,
      balancePhone: '591030202',
    });
  });

  test('როცა ინტეგრატორი Full Refunded აკეთებს —  და Merchant საკომისიო არის Sender', async ({ request }) => {
    test.setTimeout(180000);
    await new RefundIntegrator(request).createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      ibanToCheck: IBAN, // refundAmount omit → FULL
      balancePhone: '591030202',
    });
  });
});

test.describe('Refund — INTEGRATOR (Receiver 591030201)', () => {
  test('როცა ინტეგრატორი Partially Refunded აკეთებს — და Merchant საკომისიო არის Receiver', async ({ request }) => {
    test.setTimeout(180000);
    await new RefundIntegrator(request).createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      refundAmount: 0.05, // partial
      ibanToCheck: IBAN,
      balancePhone: '591030201',
    });
  });

  test('როცა ინტეგრატორი Full Refunded აკეთებს — და Merchant საკომისიო არის Receiver', async ({ request }) => {
    test.setTimeout(180000);
    await new RefundIntegrator(request).createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      ibanToCheck: IBAN, // refundAmount omit → FULL
      balancePhone: '591030201',
    });
  });
});

// ნეგატიური: ჯერ partial refund (0.05), მერე FULL refund — უკვე partially refunded-ია,
// ამიტომ full-ს net ეფექტი არ უნდა ჰქონდეს (ბალანსი ისევ after-partial-ზე უნდა დაბრუნდეს).
test.describe('Refund — INTEGRATOR (Partial → Full — ბალანსი უცვლელი)', () => {
  test('ინტეგრატორი - Partial refund-ის შემდეგ Full refund - ბარათით გადახდა', async ({ request }) => {
    test.setTimeout(180000);
    await new RefundIntegrator(request).partialThenFullBalanceUnchanged({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      refundAmount: 0.05, // ჯერ partial
      ibanToCheck: IBAN,
      balancePhone: '591030202',
    });
  });
});

// Over balance — ინტეგრატორი არეფანდებს merchant-ის ბალანსზე მეტ თანხას.
// merchant 591078180 (receiver db1bb73d, SENDER, STANDARD flow — გადახდა IBAN-ზე მიდის, ბალანსზე არა).
// ბალანსი 0.5-ზე ნაკლები უნდა იყოს. refund შესრულდება (REFUNDED), ბალანსი უცვლელი,
// ნაკლული თანხა ბალანსის დეტალებში over balance-ად ჩაიწერება.
test.describe('Refund — INTEGRATOR (591078180)', () => {
  test('refund ბალანსზე მეტი თანხით over balance - ბალანსი უცვლელი', async ({ request }) => {
    test.setTimeout(240000);
    await new RefundIntegrator(request).refundOverBalance({
      amount: 0.5,
      receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      ibanToCheck: IBAN, // refundAmount omit → FULL
      balancePhone: '591078180',
    });
  });
});
