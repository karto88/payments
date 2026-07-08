import { test } from '@playwright/test';
import { GpsStatusHelper } from '../../utils/order-helpers/GpsStatusHelper';
import { assertKeysPresent, assertField } from '../../utils/assertions';

const OP = 'GET /order/status';

// status-ში მოსალოდნელი ყველა key
const EXPECTED_KEYS = [
  'integratorOrderId',
  'status',
  'report',
  'initialCurrency',
  'acquiringCurrency',
  'acquiringAmount',
  'transactionId',
];

test('GPS Status', async ({ request }, testInfo) => {
  const helper = new GpsStatusHelper(request);

  const status = await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    cardType: 'TBC',
  });

  // სრული status report-ში (attachment)
  await testInfo.attach('order-status.json', {
    body: JSON.stringify(status, null, 2),
    contentType: 'application/json',
  });

  // ყველა key უნდა არსებობდეს
  assertKeysPresent(OP, status, EXPECTED_KEYS);

  // status უნდა იყოს SUCCESS
  assertField(OP, status, 'status', 'SUCCESS');

  console.log('✅ Test PASSED: ყველა status key შემოწმდა');
});
