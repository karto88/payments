import { test } from '@playwright/test';
import { OpenBankingHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

test('BOG Open Banking', async ({ request }) => {
  const helper = new OpenBankingHelper(request);

  await helper.createAndPayOpenBanking({
    amount: 0.1,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',

    provider: 'BOG',
  });
});

test('TBC Open Banking', async ({ request }) => {
  const helper = new OpenBankingHelper(request);

  await helper.createAndPayOpenBanking({
    amount: 0.1,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',
    
    provider: 'TBC',
  });
});
