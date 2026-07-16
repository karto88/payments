import { test } from '@playwright/test';
import { DefaultOrderHelper, TIPPaymentHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

test('Card Payment TBC', async ({ request }) => {
  const helper = new DefaultOrderHelper(request);

  await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',

    cardType: 'TBC',
    ibanToCheck: 'GE62BG0000000610917722',
  });
});

test('Card Payment BOG', async ({ request }) => {
  const helper = new DefaultOrderHelper(request);

  await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',

    cardType: 'BOG',
    ibanToCheck: 'GE62BG0000000610917722',
  });
});

test('TIP Payment', async ({ request }) => {
  const helper = new TIPPaymentHelper(request);

  await helper.createAndPayTIPOrder({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',
    
  });
});
