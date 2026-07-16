import { test } from '@playwright/test';
import { DirectLinkHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

test('BOG directLinkProvider - Distributor BOG - MCard', async ({ request }) => {
  const helper = new DirectLinkHelper(request);

  await helper.createAndPayDirectLink({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',
    provider: 'BOG',
  });
});

test('TBC directLinkProvider - Distributor TBC Visa', async ({ request }) => {
  const helper = new DirectLinkHelper(request);

  await helper.createAndPayDirectLink({
    amount: 0.1,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',
    provider: 'TBC',
  });
});
