import { test } from '@playwright/test';
import { AddMoneyNegativeHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Balance Top-up (KD-2355) — ნეგატიური ქეისები. merchant 591078180, group 278:
//   STANDARD (ბარათი) GEL: min 0.05 / max 3000 · დღიური ლიმიტი GEL 5000

const PHONE = '591078180';

// ============================================================
//  WEB — გადახდის გვერდზე ვამოწმებთ (ბრაუზერი): add-money ლინკი იქმნება, ვხსნით, ვირჩევთ ბარათს
//  და ვამოწმებთ ერორს / წარუმატებელ გადახდას (ბალანსი არ უნდა დაირიცხოს)
// ============================================================

test('Add money  —  max ლიმიტზე მეტი - ვების გადახდის გვერდზე ვამოწმებთ', async ({ request }) => {
  test.setTimeout(120000);
  await new AddMoneyNegativeHelper(request).expectPageAmountRangeError({
    amount: 3001,
    phone: PHONE,
  });
});

test('Add money  — არასწორი CVV', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyNegativeHelper(request).payWithWrongCvv({
    amount: 0.13,
    phone: PHONE,
  });
});

test('Add money — acquiring fail - არასაკმარისი ბალანსი', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyNegativeHelper(request).payWithInsufficientFunds({
    amount: 70,
    phone: PHONE,
  });
});

// merchant-ის payment link-ით (პროდუქტი, 0.1 GEL) გადახდა — ეს add money არ არის: ბალანსი არ უნდა გაიზარდოს
test('Add money — payment link-ით გადახდა', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyNegativeHelper(request).payPaymentLinkBalanceNotCredited({
    paymentLink: 'https://www.web.appdev.keepz.me/pay?qrType=CUSTOM&receiverType=BRANCH&receiverId=db1bb73d-30cf-4718-ad2b-bc25cd13b09c&productId=987f208a-6e9e-448c-9233-d393557f8ace',
    amount: 0.1,
    phone: PHONE,
  });
});

// ============================================================
//  API — მხოლოდ add-money endpoint-ს ვამოწმებთ (ბრაუზერი არ სჭირდება).
//  ამ ქეისებზე ბექი მაშინვე აბრუნებს ერორს და payment link არ გენერირდება
//  (მაგ. currencyCode პატარა ასოებით „gel", ცარიელი, amount 0 / უარყოფითი / დიაპაზონზე მეტი),
//  ამიტომ ვებზე შესამოწმებელი არაფერია — ვადარებთ endpoint-ის ერორის პასუხს.
// ============================================================

// ⚠️ ამჟამად ბაგია — endpoint 5001-ზეც payment link-ს აბრუნებს (დეველოპერი ასწორებს).
// test.fail() — ჩავარდნა მოსალოდნელია, ტესტი მწვანედ ჩანს. როცა გასწორდება, ტესტი წითლად გადავა → test.fail() მოვხსნათ.
test('Add money endpoint - თანხა დღიურ ლიმიტზე მეტი', async ({ request }) => {
  test.fail(true, 'ბაგი: add-money დღიურ ლიმიტზე მეტ თანხაზე payment link-ს აბრუნებს (დეველოპერი ასწორებს)');
  await new AddMoneyNegativeHelper(request).expectAddMoneyRejected({
    amount: 5001,
    currencyCode: 'GEL',
    phone: PHONE,
    reason: 'დღიურ ლიმიტზე (5000) მეტი',
  });
});

test('GEL - add money - amount -5', async ({ request }) => {
  await new AddMoneyNegativeHelper(request).expectAddMoneyRejected({
    amount: -5,
    currencyCode: 'GEL',
    phone: PHONE,
    reason: 'უარყოფითი თანხა',
    expectedHttpStatus: 400,
    expectedError: { messageContains: 'must be greater than 0', statusCode: 2270, exceptionGroup: 1 },
  });
});

test('GEL - add money - amount 9999995 ', async ({ request }) => {
  await new AddMoneyNegativeHelper(request).expectAddMoneyRejected({
    amount: 9999995,
    currencyCode: 'GEL',
    phone: PHONE,
    reason: 'endpoint-ის დიაპაზონზე (0.01–50000) მეტი',
    expectedHttpStatus: 409,
    expectedError: { message: 'Amount should be in range: 0.01-50000.0', statusCode: 2030, exceptionGroup: 1 },
  });
});

test('GEL - add money - amount 0', async ({ request }) => {
  await new AddMoneyNegativeHelper(request).expectAddMoneyRejected({
    amount: 0,
    currencyCode: 'GEL',
    phone: PHONE,
    reason: 'ნულოვანი თანხა',
    expectedHttpStatus: 400,
    expectedError: { messageContains: 'must be greater than 0', statusCode: 2270, exceptionGroup: 1 },
  });
});

test('GEL - add money - currencyCode is empty', async ({ request }) => {
  await new AddMoneyNegativeHelper(request).expectAddMoneyRejected({
    amount: 0.13,
    currencyCode: '',
    phone: PHONE,
    reason: 'ცარიელი currencyCode',
    expectedHttpStatus: 400,
    expectedError: { message: 'Invalid request format', statusCode: 1003, exceptionGroup: 1 },
  });
});

test('GEL - add money - currencyCode is lowercase gel', async ({ request }) => {
  await new AddMoneyNegativeHelper(request).expectAddMoneyRejected({
    amount: 0.13,
    currencyCode: 'gel',
    phone: PHONE,
    reason: 'currencyCode პატარა ასოებით (gel)',
    expectedHttpStatus: 400,
    expectedError: { message: 'Invalid request format', statusCode: 1003, exceptionGroup: 1 },
  });
});
