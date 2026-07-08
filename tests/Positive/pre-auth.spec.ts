import { test } from '@playwright/test';
import { PreAuthHelper } from '../../utils/order-helpers';
import { assertField } from '../../utils/assertions';

const OP = 'Pre-Authorization transaction status';

// უნიკალური თანხა pre-auth-ისთვის — ამით ვპოულობთ ტრანზაქციას filter-ში
const PRE_AUTH_AMOUNT = 0.17;
const COMPLETE_AMOUNT = 0.1;
const INTEGRATOR_ID = '76880b28-9033-4d48-b21f-37a9a36ec5dd';

test('Pre Authorization)', async ({ request }) => {
  // Stage 1 (payment+OTP) + Stage 2 (complete → ხელმოწერა → status)
  test.setTimeout(180000);
  const helper = new PreAuthHelper(request);

  // ეტაპი 1 — ორდერი payWithPreAuth: true-ით + TBC ბარათით გადახდა
  const { integratorOrderId, transactionId, status, accessToken } = await helper.createAndPayOrder({
    amount: PRE_AUTH_AMOUNT,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    integratorId: INTEGRATOR_ID,
    receiverType: 'BRANCH',
    
    cardType: 'TBC',
  });

  // pre-auth გადახდის მოსალოდნელი შედეგი — ტრანზაქცია უნდა ჩავარდეს TO_BE_CONFIRMED-ში
  // (თანხა არ ნაწილდება, სანამ ცალკე complete/capture endpoint არ დაინიცირდება)
  assertField(OP, { status }, 'status', 'TO_BE_CONFIRMED');

  console.log(
    `✅ Stage 1: pre-auth Transaction → STATUS IS - ${status} (order: ${integratorOrderId}, tx: ${transactionId})`
  );

  // ეტაპი 2 — ორდერის დაქომფლითება (0.1 → მიმღებს, დანარჩენი გადამხდელს უბრუნდება)
  const completed = await helper.completeOrder(accessToken, {
    integratorId: INTEGRATOR_ID,
    integratorOrderId,
    transactionId,
    completeAmount: COMPLETE_AMOUNT,
  });

  // ბიჯი 2 — complete-ის შემდეგ ტრანზაქცია უნდა იყოს ხელმოსაწერში (WAITING_FOR_SIGNATURE)
  assertField(OP, { status: completed.afterCompleteStatus }, 'status', 'WAITING_FOR_SIGNATURE');

  // ბიჯი 3 — ხელმოწერის შემდეგ საბოლოო status:
  //   SUCCESS → სრულად წარმატებული
  //   PENDING → გადახდა წარმატებულია, ტრანზაქცია მუშავდება
  //   WAITING_FOR_SIGNATURE → ჯერ ხელმოსაწერშია
  // სამივე მისაღებია (გადახდა წარმატებულია) — მხოლოდ ვლოგავთ საბოლოო status-ს.
  const paymentOk = ['SUCCESS', 'PENDING', 'WAITING_FOR_SIGNATURE'].includes(completed.status);
  assertField(
    OP,
    { paymentSuccessful: paymentOk },
    'paymentSuccessful',
    true
  );

  console.log(
    `✅ Stage 2: complete(${COMPLETE_AMOUNT}) → after complete: ${completed.afterCompleteStatus} → final: ${completed.status} (tx: ${completed.transactionId})`
  );
});
