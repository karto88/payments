import { test } from '@playwright/test';
import { AutoRefundHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Auto refund — ორდერს ვხსნით, OTP-მდე მივდივართ, გადახდამდე ვაქენსელებთ და მერე ვიხდით დაქენსელებულზე.
// გადახდა ავტომატურად უნდა დარეფანდდეს. merchant 591030203 (receiver 3196dbb0) — ყოველთვის BALANCE flow,
// ამიტომ ბალანსზე ვამოწმებთ: ჩარიცხვა + auto refund → ბალანსი უცვლელი.
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';
const RECEIVER_ID = '3196dbb0-c7b6-4d68-ad59-1232d5fd87b6';
const PHONE = '591030203';

test('Auto refund — დაქენსელებულ ორდერზე გადახდა - GEL', async ({ request }) => {
  test.setTimeout(240000);
  await new AutoRefundHelper(request).cancelPayAndCheckAutoRefund({
    amount: 0.17,
    receiverId: RECEIVER_ID,
    receiverType: 'BRANCH',
    integratorId: INTEGRATOR_ID,
    phone: PHONE,
  });
});
