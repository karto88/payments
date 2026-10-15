import { test, request as playwrightRequest } from '@playwright/test';
import { AddMoneyHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Balance Top-up (KD-2355) — merchant 591078180 თავად ავსებს wallet-ს (add money) და იხდის standard ბარათით ან Open Banking-ით.
// top-up არ უნდა იყოს დამოკიდებული merchant-ის distributionFlow-ზე → ყველა flow-ზე ბალანსი უნდა გაიზარდოს
// (before/after ბალანსი + operationType = TOP_UP). flow-ს admin-ით ვცვლით merchant/update-ით.

const PHONE = '591078180';

test('Add money — standard გადახდა distributionFlow STANDARD - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'STANDARD',
  });
});

test('Add money — standard გადახდა distributionFlow MANUAL - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'MANUAL',
  });
});

test('Add money — standard გადახდა distributionFlow TESTING - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'TESTING',
  });
});

test('Add money — standard გადახდა distributionFlow TREASURY - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'TREASURY',
  });
});

test('Add money — standard გადახდა distributionFlow DIRECT - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'DIRECT',
  });
});

test('Add money — standard გადახდა distributionFlow UCC - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'UCC',
  });
});

test('Add money — standard გადახდა distributionFlow DELAY - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'DELAY',
  });
});

test('Add money — standard გადახდა distributionFlow BALANCE - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'BALANCE',
  });
});

test('Add money — standard გადახდა distributionFlow HUB_TOP_UP - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    cardType: 'TBC',
    phone: PHONE,
    distributionFlow: 'HUB_TOP_UP',
  });
});

// ============================================================
//  Open Banking (ონლაინ ბანკი — BOG) — იგივე ყველა distributionFlow-ზე
// ============================================================

test('Add money — Open Banking BOG distributionFlow STANDARD - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'STANDARD',
  });
});

test('Add money — Open Banking BOG distributionFlow MANUAL - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'MANUAL',
  });
});

test('Add money — Open Banking BOG distributionFlow TESTING - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'TESTING',
  });
});

test('Add money — Open Banking BOG distributionFlow TREASURY - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'TREASURY',
  });
});

test('Add money — Open Banking BOG distributionFlow DIRECT - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'DIRECT',
  });
});

test('Add money — Open Banking BOG distributionFlow UCC - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'UCC',
  });
});

test('Add money — Open Banking BOG distributionFlow DELAY - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'DELAY',
  });
});

test('Add money — Open Banking BOG distributionFlow BALANCE - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'BALANCE',
  });
});

test('Add money — Open Banking BOG, distributionFlow HUB_TOP_UP - GEL', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.13,
    currencyCode: 'GEL',
    openBankingProvider: 'BOG',
    phone: PHONE,
    distributionFlow: 'HUB_TOP_UP',
  });
});

// ============================================================
//  USD / EUR — top-up არჩეულ სავალუტო ბალანსზე, კონვერტაციის გარეშე (standard ბარათი)
// ============================================================

test('Add money — standard გადახდა - USD', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.07,
    currencyCode: 'USD',
    cardType: 'TBC',
    phone: PHONE,
  });
});

test('Add money — standard გადახდა - EUR', async ({ request }) => {
  test.setTimeout(180000);
  await new AddMoneyHelper(request).addMoneyAndPay({
    amount: 0.07,
    currencyCode: 'EUR',
    cardType: 'TBC',
    phone: PHONE,
  });
});

// ტესტების შემდეგ merchant-ს საწყისი distributionFlow (STANDARD) ვუბრუნებთ — ტესტი რომც ჩავარდეს
test.afterAll(async () => {
  const ctx = await playwrightRequest.newContext();
  try {
    await new AddMoneyHelper(ctx).updateMerchant({ distributionFlow: 'STANDARD' });
    console.log('✅ Restored: merchant distributionFlow=STANDARD');
  } finally {
    await ctx.dispose();
  }
});
