import { test } from '@playwright/test';
import { RefundAdmin, RefundDevice } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

test('Partially Refunded Admin', async ({ request }) => {
  const helper = new RefundAdmin(request);

  await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    
    refundAmount: 0.05,
    ibanToCheck: 'GE62BG0000000610917722',
  });
});

test('Refunded Admin', async ({ request }) => {
  const helper = new RefundAdmin(request);

  await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    
    
    refundAmount: 0.1,
    ibanToCheck: 'GE62BG0000000610917722',
  });
});


// ---------------------------------------------------

//              რეფანდი აპიდან

// -----------------------------------------------------

test('Partially Device', async ({ request }) => {
  const helper = new RefundDevice(request);

  await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    
    refundAmount: 0.05
  });
});

test('Refunded Device', async ({ request }) => {
  const helper = new RefundDevice(request);

  await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',

    
    refundAmount: 0.1
  });
});

