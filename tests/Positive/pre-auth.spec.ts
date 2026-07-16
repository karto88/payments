import { test, APIRequestContext } from '@playwright/test';
import { PreAuthHelper } from '../../utils/order-helpers';
import { assertField, assertCondition } from '../../utils/assertions';

const OP = 'Pre-Authorization transaction status';
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';
const RECEIVER_ID = 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49';

/**
 * Pre-Auth flow: ეტაპი 1 (payWithPreAuth order + TBC გადახდა → TO_BE_CONFIRMED),
 * ეტაპი 2 (complete → WAITING_FOR_SIGNATURE → ხელმოწერა → final).
 * ბოლოს: distributionAmount უნდა ემთხვეოდეს დაქომფლითებულ თანხას → გადახდა წარმატებულია.
 * @param authAmount უნიკალური auth თანხა (ტრანზაქციის ამოსაცნობად filter-ში)
 * @param completeAmount რამდენს ვაქომფლითებთ (partial < auth | full === auth)
 */
async function runPreAuth(request: APIRequestContext, authAmount: number, completeAmount: number) {
  const helper = new PreAuthHelper(request);

  // ეტაპი 1
  const { integratorOrderId, transactionId, status, accessToken } = await helper.createAndPayOrder({
    amount: authAmount,
    receiverId: RECEIVER_ID,
    integratorId: INTEGRATOR_ID,
    receiverType: 'BRANCH',
    cardType: 'TBC',
  });

  // pre-auth გადახდა → TO_BE_CONFIRMED (თანხა არ ნაწილდება სანამ complete არ მოხდება).
  // ⚠️ კრიტიკული: თუ TO_BE_CONFIRMED არ მოვიდა → pre-auth ჩვეულებრივ გადახდად გაიარა = ბაგი.
  assertCondition(
    OP,
    status === 'TO_BE_CONFIRMED',
    `pre-auth-მა ჩვეულებრივ გადახდად გაიარა — status "${status}" (≠ TO_BE_CONFIRMED). ეს ბაგია: pre-auth-ზე თანხა არ უნდა გადანაწილდეს complete-მდე.`,
    'status === TO_BE_CONFIRMED (თანხა complete-მდე არ ნაწილდება)',
    { status, integratorOrderId, transactionId }
  );
  console.log(`✅ Stage 1: pre-auth → STATUS IS - ${status} (order: ${integratorOrderId}, tx: ${transactionId})`);

  // ეტაპი 2 — complete
  const completed = await helper.completeOrder(accessToken, {
    integratorId: INTEGRATOR_ID,
    integratorOrderId,
    transactionId,
    completeAmount,
  });

  assertField(OP, { status: completed.afterCompleteStatus }, 'status', 'WAITING_FOR_SIGNATURE');

  const paymentOk = ['SUCCESS', 'PENDING', 'WAITING_FOR_SIGNATURE'].includes(completed.status);
  assertField(OP, { paymentSuccessful: paymentOk }, 'paymentSuccessful', true);

  console.log(`✅ Stage 2: complete(${completeAmount}) → after: ${completed.afterCompleteStatus} → final: ${completed.status} (tx: ${completed.transactionId})`);

  // ეტაპი 3 — distribution უნდა ემთხვეოდეს დაქომფლითებულ თანხას
  const dist = completed.distributionAmount;
  const distOk = Math.abs(dist - completeAmount) < 0.001;
  const kind = completeAmount === authAmount ? 'FULL' : 'PARTIAL';

  console.log(`\n📊 მოსალოდნელი შედეგი — Pre-Auth (${kind})`);
  console.log(`   ავტორიზებული: ${authAmount} | დავაქომფლითეთ: ${completeAmount}`);
  console.log(`   distribution (ტრანზაქციაში): ${dist}`);
  console.log(distOk
    ? `   ✅ პრე-ავტორიზაციით გადახდა წარმატებულია — distribution ემთხვევა დაქომფლითებულს (${completeAmount})`
    : `   ❌ distribution არ ემთხვევა — ${dist}, უნდა ${completeAmount}`);

  assertCondition(
    OP,
    distOk,
    `distribution არ ემთხვევა დაქომფლითებულს (distribution ${dist}, complete ${completeAmount})`,
    `distributionAmount === ${completeAmount}`,
    { distributionAmount: dist, completeAmount, authAmount }
  );
}

// ნაწილობრივი complete — ავტორიზება 0.17, ქომფლითი 0.1 (დანარჩენი გადამხდელს უბრუნდება)
test('Pre Authorization — Partial complete', async ({ request }) => {
  test.setTimeout(180000);
  await runPreAuth(request, 0.17, 0.1);
});

// სრული complete — ავტორიზება 0.16, ქომფლითი 0.16 (მთელი ავტორიზებული თანხა)
test('Pre Authorization — Full complete', async ({ request }) => {
  test.setTimeout(180000);
  await runPreAuth(request, 0.10, 0.10);
});
