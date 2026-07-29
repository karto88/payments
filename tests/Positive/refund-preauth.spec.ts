import { test, APIRequestContext, request as playwrightRequest } from '@playwright/test';
import { RefundPreAuthHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Pre-Auth refund — pre-auth + capture, მერე captured თანხის refund 3 არხით (INTEGRATOR/DEVICE/ADMIN).
// merchant 591078180 / receiver db1bb73d. ტესტები ორ commission type-ზე: SENDER და RECEIVER.
//   INTEGRATOR — full capture (auth === complete), order რომ დადასტურდეს.
//   full → refundAmount omit | partial → refundAmount. თითო authAmount უნიკალურია (tx-ის ამოსაცნობად).
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';
const RECEIVER_ID = 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c';
const PHONE = '591078180';

async function run(
  request: APIRequestContext,
  commissionType: 'SENDER' | 'RECEIVER',
  refundVia: 'INTEGRATOR' | 'DEVICE' | 'ADMIN',
  authAmount: number,
  completeAmount: number,
  refundAmount?: number
) {
  await new RefundPreAuthHelper(request).createPayCaptureAndRefund({
    authAmount,
    completeAmount,
    refundAmount,
    refundVia,
    receiverId: RECEIVER_ID,
    receiverType: 'BRANCH',
    integratorId: INTEGRATOR_ID,
    cardType: 'TBC',
    phone: PHONE,
    commissionType,
  });
}

// ============================================================
//  SENDER commission
// ============================================================
test.describe('Pre-Auth Refund — SENDER commission', () => {
  test('პრე-ავტორიციის ორდერზე FULL რეფანდი INTEGRATOR — საკომისიო SENDER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'SENDER', 'INTEGRATOR', 0.20, 0.20); // full capture, full refund
  });
  test('პრე-ავტორიციის ორდერზე Partial რეფანდი INTEGRATOR — საკომისიო SENDER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'SENDER', 'INTEGRATOR', 0.21, 0.21, 0.10); // full capture, partial refund
  });
  test('პრე-ავტორიციის ორდერზე FULL რეფანდი - მერჩანტი — საკომისიო SENDER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'SENDER', 'DEVICE', 0.22, 0.12); // capture 0.12, full refund
  });
  test('პრე-ავტორიციის ორდერზე Partial რეფანდი მერჩანტი — საკომისიო SENDER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'SENDER', 'DEVICE', 0.23, 0.13, 0.06);
  });
  test('პრე-ავტორიციის ორდერზე FULL რეფანდი - ADMIN — საკომისიო SENDER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'SENDER', 'ADMIN', 0.24, 0.14); // capture 0.14, full refund
  });
  test('პრე-ავტორიციის ორდერზე Partial რეფანდი ADMIN — საკომისიო SENDER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'SENDER', 'ADMIN', 0.25, 0.15, 0.07);
  });
});

// ============================================================
//  RECEIVER commission (იგივე ტესტები, merchant გადართული RECEIVER-ზე)
// ============================================================
test.describe('Pre-Auth Refund — RECEIVER commission', () => {
  test('პრე-ავტორიციის ორდერზე full რეფანდი INTEGRATOR — საკომისიო RECEIVER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'RECEIVER', 'INTEGRATOR', 0.26, 0.26); // full capture, full refund
  });
  test('პრე-ავტორიციის ორდერზე Partial რეფანდი INTEGRATOR — საკომისიო RECEIVER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'RECEIVER', 'INTEGRATOR', 0.27, 0.27, 0.13); // full capture, partial refund
  });
  test('პრე-ავტორიციის ორდერზე Full რეფანდი - მერჩანტი — საკომისიო RECEIVER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'RECEIVER', 'DEVICE', 0.28, 0.14); // capture 0.14, full refund
  });
  test('პრე-ავტორიციის ორდერზე Partial რეფანდი - მერჩანტი — საკომისიო RECEIVER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'RECEIVER', 'DEVICE', 0.29, 0.15, 0.07);
  });
  test('პრე-ავტორიციის ორდერზე Full რეფანდი - ADMIN — საკომისიო RECEIVER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'RECEIVER', 'ADMIN', 0.30, 0.16); // capture 0.16, full refund
  });
  test('პრე-ავტორიციის ორდერზე Partial რეფანდი - ADMIN — საკომისიო RECEIVER', async ({ request }) => {
    test.setTimeout(600000);
    await run(request, 'RECEIVER', 'ADMIN', 0.31, 0.17, 0.08);
  });
});

// ტესტების შემდეგ merchant დავაბრუნოთ SENDER commission-ზე (ტესტი რომც ჩავარდეს)
test.afterAll(async () => {
  const ctx = await playwrightRequest.newContext();
  try {
    await new RefundPreAuthHelper(ctx).updateMerchant({ commissionType: 'SENDER' });
    console.log('✅ Restored: merchant commissionType=SENDER');
  } finally {
    await ctx.dispose();
  }
});