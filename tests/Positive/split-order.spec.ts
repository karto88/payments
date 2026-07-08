import { test } from '@playwright/test';
import { SplitPaymentHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

test('Split Order IBAN BRANCH', async ({ request }) => {
  const helper = new SplitPaymentHelper(request);

  await helper.createAndPaySplitOrder({
    amount: 0.40,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    splitDetails: [
      {
        receiverType: "BRANCH",
        receiverIdentifier: "db1bb73d-30cf-4718-ad2b-bc25cd13b09c",
        amount: 0.2
      },
      {
        receiverType: "IBAN",
        receiverIdentifier: "GE62BG0000000610917722",
        amount: 0.2
      }
    ],
    ibanToCheck: 'GE62BG0000000610917722'
  });
});

test('Split Order BRANCH + BRANCH', async ({ request }) => {
  const helper = new SplitPaymentHelper(request);

  await helper.createAndPaySplitOrder({
    amount: 0.40,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    splitDetails: [
      {
        receiverType: "BRANCH",
        receiverIdentifier: "db1bb73d-30cf-4718-ad2b-bc25cd13b09c",
        amount: 0.20
      },
      {
        receiverType: "BRANCH",
        receiverIdentifier: "a1b9a5c5-9f01-42ee-a6e3-8853297caf49",
        amount: 0.20
      }
    ],
    ibanToCheck: 'GE62BG0000000610917722'
  });
});


test('Split Order receiverType amount 0', async ({ request }) => {
  const helper = new SplitPaymentHelper(request);

  await helper.createAndPaySplitOrder({
    amount: 0.40,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    splitDetails: [
      {
        receiverType: "BRANCH",
        receiverIdentifier: "db1bb73d-30cf-4718-ad2b-bc25cd13b09c",
        amount: 0.40
      },
      {
        receiverType: "IBAN",
        receiverIdentifier: "GE62BG0000000610917722",
        amount: 0
      }
    ],
    ibanToCheck: 'GE62BG0000000610917722'
  });
});

test('Split Order receiver amount 0', async ({ request }) => {
  const helper = new SplitPaymentHelper(request);

  await helper.createAndPaySplitOrder({
    amount: 0.40,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    splitDetails: [
      {
        receiverType: "BRANCH",
        receiverIdentifier: "db1bb73d-30cf-4718-ad2b-bc25cd13b09c",
        amount: 0
      },
      {
        receiverType: "IBAN",
        receiverIdentifier: "GE62BG0000000610917722",
        amount: 0.40
      }
    ],
    ibanToCheck: 'GE62BG0000000610917722'
  });
});


