import { test } from '@playwright/test';
import { RefundAdmin, RefundDevice } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';
const IBAN = 'GE29TB7197445064300124';
const SENDER_RECEIVER = 'c654e1d8-c54e-4a3a-b3c8-a63718e7654f'; // merchant 591030202
const RECEIVER_RECEIVER = '292de25e-c01e-47c8-8e4f-8823aba25fc0'; // merchant 591030201

// ============================================================
//  DEVICE refund — device token-ით (ბალანსი მაშინვე ეჭრება)
// ============================================================
test.describe('Refund — DEVICE (Sender 591030202)', () => {
  test('როცა მერჩანტი აკეთებს Partially Refund  - და საკომისიო არის Sender', async ({ request }) => {
    await new RefundDevice(request).createAndPayOrder({
      amount: 0.1, receiverId: SENDER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.05, phone: '591030202',
    });
  });

  test('როცა მერჩანტი აკეთებს Full Refund - Sender', async ({ request }) => {
    await new RefundDevice(request).createAndPayOrder({
      amount: 0.1, receiverId: SENDER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.1, phone: '591030202',
    });
  });
});

test.describe('Refund — DEVICE (Receiver 591030201)', () => {
  test('როცა მერჩანტი აკეთებს Partially Refund — და საკომისიო არის Receiver', async ({ request }) => {
    await new RefundDevice(request).createAndPayOrder({
      amount: 0.1, receiverId: RECEIVER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.05, phone: '591030201',
    });
  });

  test('როცა მერჩანტი აკეთებს Full Refund  — და საკომისიო არის Receiver', async ({ request }) => {
    await new RefundDevice(request).createAndPayOrder({
      amount: 0.1, receiverId: RECEIVER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.1, phone: '591030201',
    });
  });
});

// ============================================================
//  ADMIN refund — admin panel, ბალანსი + status
//  full → amount:null | partial → refundAmount
// ============================================================
test.describe('Refund — ADMIN', () => {
  test('როცა ადმინი აკეთებს Partially Refunded — და საკომისიო არის Sender', async ({ request }) => {
    await new RefundAdmin(request).createAndPayOrder({
      amount: 0.1, receiverId: SENDER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.05, ibanToCheck: IBAN, balancePhone: '591030202',
    });
  });

  test('როცა ადმინი აკეთებს Full Refunded — და საკომისიო არის Sender', async ({ request }) => {
    await new RefundAdmin(request).createAndPayOrder({
      amount: 0.1, receiverId: SENDER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.1, ibanToCheck: IBAN, balancePhone: '591030202',
    });
  });

  test('როცა ადმინი აკეთებს Partially Refunded — და საკომისიო არის Receiver', async ({ request }) => {
    await new RefundAdmin(request).createAndPayOrder({
      amount: 0.1, receiverId: RECEIVER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.05, ibanToCheck: IBAN, balancePhone: '591030201',
    });
  });

  test('როცა ადმინი აკეთებს Full Refunded — და საკომისიო არის Receiver', async ({ request }) => {
    await new RefundAdmin(request).createAndPayOrder({
      amount: 0.1, receiverId: RECEIVER_RECEIVER, receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID, refundAmount: 0.1, ibanToCheck: IBAN, balancePhone: '591030201',
    });
  });
});
