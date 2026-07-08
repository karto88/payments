import { test } from '@playwright/test';
import { SavedCardHelper } from '../../utils/order-helpers/SavedCardHelper';
import { assertCondition } from '../../utils/assertions';

const OP = 'GET /integrator/card/order-id';

test('Saved Card', async ({ request }, testInfo) => {
  const helper = new SavedCardHelper(request);

  const cardData = await helper.createPayAndGetCardToken({
    amount: 0.1,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',
    cardType: 'TBC',
  });

  // სრული card data attachment-ში
  await testInfo.attach('card-data.json', {
    body: JSON.stringify(cardData, null, 2),
    contentType: 'application/json',
  });

  // პასუხი არ უნდა იყოს ცარიელი
  assertCondition(
    OP,
    !!cardData && Object.keys(cardData).length > 0,
    'card token endpoint-მა ცარიელი პასუხი დააბრუნა',
    'პასუხი უნდა შეიცავდეს ბარათის მონაცემებს (token-ის ჩათვლით)',
    cardData
  );

  // token-ის მსგავსი ველი უნდა არსებობდეს (token / cardToken / id)
  const hasToken =
    'cardToken' in cardData ||
    'token' in cardData ||
    'id' in cardData;

  assertCondition(
    OP,
    hasToken,
    'ბარათის token ველი ვერ მოიძებნა',
    'პასუხს უნდა ჰქონდეს token-ის მსგავსი ველი (cardToken / token / id)',
    cardData
  );

  console.log('✅ Test PASSED: card token/data დაბრუნდა');
});
