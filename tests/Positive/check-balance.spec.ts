import { test, request as playwrightRequest } from '@playwright/test';
import { CheckBalanceHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// ბალანსის ასახვის ჩეკი — merchant-ს distributionFlow: BALANCE აქვს, ამიტომ standard
// გადახდა ბალანსზე უნდა აისახოს (commission-side-aware თანხით).
// merchant 591030201 (receiver 292de25e) — group 278, STANDARD GEL commission PERCENTAGE ან FIXED.
// amount ყველგან 0.1 (გაივლის ორივე rate type-ზე).

const RECEIVER_ID = '292de25e-c01e-47c8-8e4f-8823aba25fc0';
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';
const PHONE = '591030201';

// ---- PERCENTAGE (group-ის STANDARD GEL default rate type) ----
test('Balance check — Receiver commission PERCENTAGE', async ({ request }) => {
  test.setTimeout(180000);
  await new CheckBalanceHelper(request).checkBalanceReflection({
    amount: 0.1,
    receiverId: RECEIVER_ID,
    receiverType: 'BRANCH',
    integratorId: INTEGRATOR_ID,
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'BALANCE',
    commissionType: 'RECEIVER',
    standardRateType: 'PERCENTAGE',
  });
});

// Sender commission — გადამხდელი იხდის საკომისიოს ზემოდან, ბალანსზე სრული amount აისახება
test('Balance check — Sender commission PERCENTAGE', async ({ request }) => {
  test.setTimeout(180000);
  await new CheckBalanceHelper(request).checkBalanceReflection({
    amount: 0.1,
    receiverId: RECEIVER_ID,
    receiverType: 'BRANCH',
    integratorId: INTEGRATOR_ID,
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'BALANCE',
    commissionType: 'SENDER',
    standardRateType: 'PERCENTAGE',
  });
});

// ---- FIXED (group-ის STANDARD GEL commission ფიქსირებულ თანხაზე) ----
test('Balance check — Receiver commission FIXED', async ({ request }) => {
  test.setTimeout(180000);
  await new CheckBalanceHelper(request).checkBalanceReflection({
    amount: 0.1,
    receiverId: RECEIVER_ID,
    receiverType: 'BRANCH',
    integratorId: INTEGRATOR_ID,
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'BALANCE',
    commissionType: 'RECEIVER',
    standardRateType: 'FIXED',
  });
});

test('Balance check — Sender commission FIXED', async ({ request }) => {
  test.setTimeout(180000);
  await new CheckBalanceHelper(request).checkBalanceReflection({
    amount: 0.1,
    receiverId: RECEIVER_ID,
    receiverType: 'BRANCH',
    integratorId: INTEGRATOR_ID,
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'BALANCE',
    commissionType: 'SENDER',
    standardRateType: 'FIXED',
  });
});

// ============================================================
//  USD / EUR ბალანსის ასახვა — merchant 591030203 (receiver 3196dbb0)
//  591030203 ყოველთვის BALANCE flow-ია → merchant/group update არ სჭირდება.
//  receiverId-ს ქარენსები ჩართული აქვს; order იქმნება currency/acquiring/distribution currency-ით.
// ============================================================
const MULTI_RECEIVER_ID = '3196dbb0-c7b6-4d68-ad59-1232d5fd87b6';
const MULTI_PHONE = '591030203';

test.describe('Balance check — Multi-currency (591030203)', () => {
  test('USD reflection', async ({ request }) => {
    test.setTimeout(180000);
    await new CheckBalanceHelper(request).checkBalanceReflection({
      amount: 0.04,
      receiverId: MULTI_RECEIVER_ID,
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      cardType: 'TBC',
      phone: MULTI_PHONE,
      currency: 'USD',
    });
  });

  test('EUR reflection', async ({ request }) => {
    test.setTimeout(180000);
    await new CheckBalanceHelper(request).checkBalanceReflection({
      amount: 0.04,
      receiverId: MULTI_RECEIVER_ID,
      receiverType: 'BRANCH',
      integratorId: INTEGRATOR_ID,
      cardType: 'TBC',
      phone: MULTI_PHONE,
      currency: 'EUR',
    });
  });
});

// ტესტების შემდეგ აუცილებლად დავაბრუნოთ საწყისი მდგომარეობა (ტესტი რომც ჩავარდეს):
//   - group STANDARD GEL rateType → PERCENTAGE (არ დარჩეს FIXED-ზე)
//   - merchant distributionFlow → STANDARD (არ დარჩეს BALANCE-ზე)
test.afterAll(async () => {
  const ctx = await playwrightRequest.newContext();
  try {
    const helper = new CheckBalanceHelper(ctx);
    await helper.updateGroupRateType('PERCENTAGE');
    await helper.updateMerchant({ distributionFlow: 'STANDARD' });
    console.log('✅ Restored: group rateType=PERCENTAGE, merchant distributionFlow=STANDARD');
  } finally {
    await ctx.dispose();
  }
});
