import { test } from '@playwright/test';
import { TokenPaymentHelper } from '../../utils/order-helpers/TokenPaymentHelper';
import { assertCondition } from '../../utils/assertions';

const OP = 'POST /integrator/order (cardToken)';

test('Token Payment saved card', async ({ request }, testInfo) => {
  const helper = new TokenPaymentHelper(request);

  // ეტაპი 1 (SavedCardHelper-ით token) + ეტაპი 2 (createTokenPayment)
  const { result } = await helper.payWithSavedCard({
    amount: 0.05,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    receiverType: 'BRANCH',
    cardType: 'TBC',
  });

  // სრული payment result attachment-ში
  await testInfo.attach('token-payment-result.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });

  // პასუხი არ უნდა იყოს ცარიელი
  assertCondition(
    OP,
    !!result && Object.keys(result).length > 0,
    'token payment endpoint-მა ცარიელი პასუხი დააბრუნა',
    'პასუხი უნდა შეიცავდეს გადახდის შედეგს',
    result
  );

  // payment link (urlForQR) არ უნდა დაბრუნდეს — გადახდა მაშინვე ხდება
  assertCondition(
    OP,
    !('urlForQR' in result),
    'token payment-ს დაუბრუნდა urlForQR (payment link)',
    'urlForQR არ უნდა დაბრუნდეს — გადახდა token-ით მაშინვე ხდება',
    result
  );

  console.log('✅ Test PASSED: token payment შესრულდა');
});
