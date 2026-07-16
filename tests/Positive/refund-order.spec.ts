import { test } from '@playwright/test';
import { RefundAdmin, RefundDevice } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================
//  Sender commission — merchant 591030202 (receiver c654e1d8)
//  device login/token: 591030202 | balance ეჭრება: full → amount + fee, partial → refundAmount
// ============================================================
test.describe('Refund — Sender commission (591030202)', () => {
  test('Partially Refunded INTEGRATOR', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.05,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030202',
    });
  });

  test('Full Refunded INTEGRATOR Sender', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.1,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030202',
    });
  });

  test('Partially Device', async ({ request }) => {
    const helper = new RefundDevice(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.05,
      phone: '591030202',
    });
  });

  test('Refunded Device', async ({ request }) => {
    const helper = new RefundDevice(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.1,
      phone: '591030202',
    });
  });
});

// ============================================================
//  Receiver commission — merchant 591030201 (receiver 292de25e)
//  device login/token: 591030201 | balance ეჭრება პირდაპირი გამოკლებით
// ============================================================
test.describe('Refund — Receiver commission (591030201)', () => {
  test('Partially Refunded INTEGRATOR — Receiver', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.05,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030201',
    });
  });

  test('Full Refunded INTEGRATOR — Receiver', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.1,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030201',
    });
  });

  test('Partially Device — Receiver', async ({ request }) => {
    const helper = new RefundDevice(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.05,
      phone: '591030201',
    });
  });

  test('Full Refunded Device — Receiver', async ({ request }) => {
    const helper = new RefundDevice(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.1,
      phone: '591030201',
    });
  });
});

// ============================================================
//  ADMIN refund (admin panel endpoint — ტრანზაქციის id-ზე)
//  refundVia: 'ADMIN' | full → amount:null, partial → refundAmount
//  sender: 591030202 (c654e1d8) · receiver: 591030201 (292de25e)
// ============================================================
test.describe('Refund — ADMIN', () => {
  test('Partially Refunded ADMIN — Sender', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.05,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030202',
      refundVia: 'ADMIN',
    });
  });

  test('Full Refunded ADMIN — Sender', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.1,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030202',
      refundVia: 'ADMIN',
    });
  });

  test('Partially Refunded ADMIN — Receiver', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.05,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030201',
      refundVia: 'ADMIN',
    });
  });

  test('Full Refunded ADMIN — Receiver', async ({ request }) => {
    const helper = new RefundAdmin(request);
    await helper.createAndPayOrder({
      amount: 0.1,
      receiverId: '292de25e-c01e-47c8-8e4f-8823aba25fc0',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      refundAmount: 0.1,
      ibanToCheck: 'GE29TB7197445064300124',
      balancePhone: '591030201',
      refundVia: 'ADMIN',
    });
  });
});
