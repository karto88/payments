import { test } from '@playwright/test';
import { GepaOrderListHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// GEPA — ორდერი branchId-ით (random) → გადახდა → GET order list იმავე branchId-ით → მხოლოდ ეს ორდერი

test('GEPA order list', async ({ request }) => {
  await new GepaOrderListHelper(request).createPayAndCheckList({
    amount: 0.1,
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    receiverType: 'BRANCH',
  });
});
