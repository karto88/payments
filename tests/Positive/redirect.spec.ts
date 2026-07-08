import { test } from '@playwright/test';
import { RedirectHelper } from '../../utils/order-helpers/RedirectHelper';
import { assertCondition } from '../../utils/assertions';

const SUCCESS_URL = 'https://lingolandedu.com/en/english-english-dictionary/successful';
const FAIL_URL = 'https://www.istockphoto.com/photos/fail';

test.describe('Success Redirect', () => {
  // 1️⃣ SUCCESS — TBC ბარათი → წარმატებული → successRedirectUri
  test('success redirect', async ({ request }) => {
    const helper = new RedirectHelper(request);

    const finalUrl = await helper.createAndPay({
      amount: 0.1,
      receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      successRedirectUri: SUCCESS_URL,
      failRedirectUri: FAIL_URL,
      cardType: 'TBC',
    });

    assertCondition(
      'Success Redirect',
      finalUrl.includes('lingolandedu.com'),
      'წარმატებული გადახდის შემდეგ browser არ გადავიდა successRedirectUri-ზე',
      `URL უნდა შეიცავდეს: ${SUCCESS_URL}`,
      { finalUrl }
    );

    console.log('✅ successRedirectUri is successful');
  });

  // 2️⃣ FAIL — CREDO ბარათი (ფული არ აქვს) → ჩავარდნა → failRedirectUri
  test('fail redirect', async ({ request }) => {
    const helper = new RedirectHelper(request);

    const finalUrl = await helper.createAndPay({
      amount: 0.1,
      receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      successRedirectUri: SUCCESS_URL,
      failRedirectUri: FAIL_URL,
      cardType: 'CREDO',
    });

    assertCondition(
      'Fail Redirect',
      finalUrl.includes('istockphoto.com'),
      'ჩავარდნილი გადახდის შემდეგ browser არ გადავიდა failRedirectUri-ზე',
      `URL უნდა შეიცავდეს: ${FAIL_URL}`,
      { finalUrl }
    );

    console.log('✅ failRedirectUri is successful');
  });
});
