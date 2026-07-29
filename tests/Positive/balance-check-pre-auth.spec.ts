import { test, APIRequestContext } from '@playwright/test';
import { PreAuthBalanceHelper } from '../../utils/order-helpers';

// Pre-Auth balance hold — merchant 591030201 (292de25e), distributionFlow BALANCE.
// TO_BE_CONFIRMED-ის დროს ბალანსი არ უნდა დაირიცხოს; capture-ის შემდეგ — უნდა დაირიცხოს.
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';
const RECEIVER_ID = '3196dbb0-c7b6-4d68-ad59-1232d5fd87b6'; // BALANCE flow-იანი receiver
const PHONE = '591030203'; // ამ receiver-ის მფლობელი — ბალანსს აქ ვკითხულობთ

async function runPreAuthBalance(request: APIRequestContext, authAmount: number, completeAmount: number) {
  await new PreAuthBalanceHelper(request).checkPreAuthBalance({
    authAmount,
    completeAmount,
    receiverId: RECEIVER_ID,
    receiverType: 'BRANCH',
    integratorId: INTEGRATOR_ID,
    cardType: 'TBC',
    phone: PHONE,
  });
}

// ნაწილობრივი capture — ავტორიზება 0.19, ქომფლითი 0.11 (hold-ის დროს ბალანსი 0, capture-ის მერე +0.11−fee)
test('Pre-Auth balance — Partial complete', async ({ request }) => {
  test.setTimeout(300000);
  await runPreAuthBalance(request, 0.19, 0.11);
});

// სრული capture — ავტორიზება 0.14, ქომფლითი 0.14
test('Pre-Auth balance — Full complete', async ({ request }) => {
  test.setTimeout(300000);
  await runPreAuthBalance(request, 0.14, 0.14);
});
