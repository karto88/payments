import { test, APIRequestContext } from '@playwright/test';
import { NegativeOrderHelper } from '../../utils/order-helpers';
import { assertCondition } from '../../utils/assertions';
import * as dotenv from 'dotenv';

dotenv.config();

// ნეგატიური ქეისები — ორდერის შექმნა არასწორი input-ით უნდა უარყოფილიყოს (ბრაუზერი არ სჭირდება).
// merchant 591030201 (receiver 292de25e). API-ს ვალიდური დიაპაზონი: amount 0.01–50000.
const OP = 'Negative — order creation';
const RECEIVER_ID = '292de25e-c01e-47c8-8e4f-8823aba25fc0';
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';

async function expectRejected(
  request: APIRequestContext,
  config: { amount: number; receiverId: string; receiverType?: string; integratorId: string }
) {
  const { rejected, detail } = await new NegativeOrderHelper(request).attemptOrder(config);
  console.log(rejected ? `✅ ორდერი უარყო: ${detail}` : `❌ ორდერი შეიქმნა (არ უნდა შექმნილიყო): ${detail}`);
  assertCondition(
    OP,
    rejected,
    `ორდერი უნდა უარყოფილიყო, მაგრამ შეიქმნა — ${detail}`,
    'order creation უნდა ჩავარდეს (error)',
    { rejected, detail }
  );
}

test.describe('ორდერის შექმნა — ნეგატიური ქეისები', () => {
  test('ორდერის შექმნა — მინიმუმზე ნაკლები თანხით (0.005) უნდა უარყოს', async ({ request }) => {
    await expectRejected(request, { amount: 0.005, receiverId: RECEIVER_ID, receiverType: 'BRANCH', integratorId: INTEGRATOR_ID });
  });

  test('ორდერის შექმნა — ნულოვანი თანხით (0) უნდა უარყოს', async ({ request }) => {
    await expectRejected(request, { amount: 0, receiverId: RECEIVER_ID, receiverType: 'BRANCH', integratorId: INTEGRATOR_ID });
  });

  test('ორდერის შექმნა — უარყოფითი თანხით (-1) უნდა უარყოს', async ({ request }) => {
    await expectRejected(request, { amount: -1, receiverId: RECEIVER_ID, receiverType: 'BRANCH', integratorId: INTEGRATOR_ID });
  });

  test('ორდერის შექმნა — მაქსიმუმზე მეტი თანხით (999999) უნდა უარყოს', async ({ request }) => {
    await expectRejected(request, { amount: 999999, receiverId: RECEIVER_ID, receiverType: 'BRANCH', integratorId: INTEGRATOR_ID });
  });

  test('ორდერის შექმნა — არასწორი receiverId-ით უნდა უარყოს', async ({ request }) => {
    await expectRejected(request, { amount: 0.1, receiverId: '00000000-0000-0000-0000-000000000000', receiverType: 'BRANCH', integratorId: INTEGRATOR_ID });
  });

  test('ორდერის შექმნა — არასწორი integratorId-ით უნდა უარყოს', async ({ request }) => {
    await expectRejected(request, { amount: 0.1, receiverId: RECEIVER_ID, receiverType: 'BRANCH', integratorId: '00000000-0000-0000-0000-000000000000' });
  });
});