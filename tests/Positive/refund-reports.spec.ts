import { test, request as playwrightRequest } from '@playwright/test';
import { RefundReportsHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Refund Reports Module (KD-2164) — ადმინკის refund report-ი.
//   IN_BALANCE   — refund merchant-ის ბალანსიდან მოიჭრა
//   OVER_BALANCE — ბალანსზე არ ჰქონდა / არ ეყო → Keepz-ის ხარჯზე
//
// merchant 599000555 (stromae refund report) — მხოლოდ refund report-ის ტესტებისთვის.
// receiver fa14f6c6, STANDARD flow, SENDER
const MERCHANT = {
  merchantId: '6f99d426-6042-4b27-addb-33e6fc188c3e',
  receiverId: 'fa14f6c6-a3a4-4563-8eb0-2e4859fa70b9',
  integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
  phone: '599000555',
};
const IBAN = 'GE29TB7197445064300124'; // cash-out — Over Balance-ის წინ ბალანსის განულებისთვის
// merchant-ის შექმნილი გადახდის ლინკი (პროდუქტი, თანხა 0.2 GEL, მოქმედებს 2028-მდე)
const PAYMENT_LINK = 'https://www.web.appdev.keepz.me/pay?qrType=CUSTOM&receiverType=BRANCH&receiverId=fa14f6c6-a3a4-4563-8eb0-2e4859fa70b9&productId=a5c58233-5a98-4849-be90-de1cbddefc7a&lng=ka';

// Over Balance — გადახდები → refund (თითო ვალუტაზე full + partial)
const OVER_BALANCE_REFUNDS = [
  { amount: 0.1, currency: 'GEL' as const },                    // full
  { amount: 0.2, currency: 'GEL' as const, refundAmount: 0.1 }, // partial
  { amount: 0.1, currency: 'USD' as const },                    // full
  { amount: 0.2, currency: 'USD' as const, refundAmount: 0.1 }, // partial
  { amount: 0.1, currency: 'EUR' as const },                    // full
  { amount: 0.2, currency: 'EUR' as const, refundAmount: 0.1 }, // partial
];

// In Balance — ბალანსის შევსება თითო ვალუტაზე (refund-ის გარეშე)
const BALANCE_TOP_UPS = [
  { amount: 0.2, currency: 'GEL' as const },
  { amount: 0.2, currency: 'USD' as const },
  { amount: 0.2, currency: 'EUR' as const },
];
// In Balance — გადახდები → refund (თითო ვალუტაზე partial + full)
const IN_BALANCE_REFUNDS = [
  { amount: 0.2, currency: 'GEL' as const, refundAmount: 0.1 }, // partial
  { amount: 0.1, currency: 'GEL' as const },                    // full
  { amount: 0.2, currency: 'USD' as const, refundAmount: 0.1 }, // partial
  { amount: 0.1, currency: 'USD' as const },                    // full
  { amount: 0.2, currency: 'EUR' as const, refundAmount: 0.1 }, // partial
  { amount: 0.1, currency: 'EUR' as const },                    // full
];

// Add money — top-up-ები (ბალანსის შევსება) → თითოეულის refund (თითო ვალუტაზე full + partial)
const ADD_MONEY_REFUNDS = [
  { amount: 0.1, currency: 'GEL' as const },                    // full
  { amount: 0.2, currency: 'GEL' as const, refundAmount: 0.1 }, // partial
  { amount: 0.1, currency: 'USD' as const },                    // full
  { amount: 0.2, currency: 'USD' as const, refundAmount: 0.1 }, // partial
  { amount: 0.1, currency: 'EUR' as const },                    // full
  { amount: 0.2, currency: 'EUR' as const, refundAmount: 0.1 }, // partial
];

test.describe('Refund Reports Module', () => {
  // ---------- ინტეგრატორი ----------

  test('Refund Reports Module - ინტეგრატორი refund - Over Balance - full და partial', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkOverBalanceRefunds({
      ...MERCHANT, refundVia: 'INTEGRATOR', iban: IBAN, refunds: OVER_BALANCE_REFUNDS,
    });
  });

  test('Refund Reports Module - ინტეგრატორი refund - In Balance - partial და full რეფანდი', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkInBalanceRefunds({
      ...MERCHANT, refundVia: 'INTEGRATOR', balanceTopUpPayments: BALANCE_TOP_UPS, refunds: IN_BALANCE_REFUNDS,
    });
  });

  // ---------- მერჩანტი ----------

  test('Refund Reports Module - მერჩანტი refund - Over Balance - full და partial', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkOverBalanceRefunds({
      ...MERCHANT, refundVia: 'MERCHANT', iban: IBAN, refunds: OVER_BALANCE_REFUNDS,
    });
  });

  test('Refund Reports Module - მერჩანტი refund - In Balance - partial და full რეფანდი', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkInBalanceRefunds({
      ...MERCHANT, refundVia: 'MERCHANT', balanceTopUpPayments: BALANCE_TOP_UPS, refunds: IN_BALANCE_REFUNDS,
    });
  });

  // ---------- ადმინი ----------

  test('Refund Reports Module - ადმინი refund - Over Balance - full და partial', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkOverBalanceRefunds({
      ...MERCHANT, refundVia: 'ADMIN', iban: IBAN, refunds: OVER_BALANCE_REFUNDS,
    });
  });

  test('Refund Reports Module - ადმინი refund - In Balance - partial და full რეფანდი', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkInBalanceRefunds({
      ...MERCHANT, refundVia: 'ADMIN', balanceTopUpPayments: BALANCE_TOP_UPS, refunds: IN_BALANCE_REFUNDS,
    });
  });

  // ---------- ერთი თვის ფილტრი ----------

  // report-ი თვის დასაწყისიდან დღემდე (from = 1 რიცხვი, to = დღეს) — თვის ჯამი ზუსტად ჩვენი refund-ით უნდა გაიზარდოს
  // + Excel (preview): ტესტამდე და ბოლოს გადმოვწერთ — სტრიქონი + ჯამები = იყო + ჩვენი
  test('Refund Reports Module - ერთი თვის ჩანაწერი', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkOverBalanceRefunds({
      ...MERCHANT, refundVia: 'INTEGRATOR', iban: IBAN, period: 'MONTH', checkExcel: true,
      refunds: [{ amount: 0.1, currency: 'GEL' }], // full
    });
  });

  // ---------- ერთი დღის ფილტრი ----------

  // report-ი მხოლოდ დღევანდელი დღით (from = to = დღეს) — დღის ჯამი ზუსტად ჩვენი refund-ებით უნდა გაიზარდოს
  // + Excel (preview): 2 refund — Excel-მა ორივე სწორად უნდა შეკრიბოს
  test('Refund Reports Module - ერთი დღის ჩანაწერი', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkOverBalanceRefunds({
      ...MERCHANT, refundVia: 'INTEGRATOR', iban: IBAN, period: 'DAY', checkExcel: true,
      refunds: [
        { amount: 0.1, currency: 'GEL' },                    // full
        { amount: 0.2, currency: 'GEL', refundAmount: 0.1 }, // partial
      ],
    });
  });

  // ---------- Send report (მეილი) ----------

  // report-ს ვაგზავნით მეილზე → მეილი მოვიდა → დანართის Excel = preview Excel = summary (მიმდინარე თვე)
  test('Refund Reports Module - მეილზე მოსული Excel', async ({ request }) => {
    test.setTimeout(300000);
    await new RefundReportsHelper(request).checkSendReport({
      merchantId: MERCHANT.merchantId, recipient: process.env.GMAIL_USER!, period: 'MONTH',
    });
  });

  // ---------- merchant-ის payment link ----------

  // merchant-ის შექმნილი გადახდის ლინკი (ფიქსირებული თანხა 0.2 GEL) · Over Balance · ადმინი refund:
  // 1-ლი გადახდა → full refund · 2-ე გადახდა → partial refund 0.1
  test('Refund Reports Module - payment link - ადმინი refund - Over Balance (full + partial)', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkPaymentLinkRefunds({
      ...MERCHANT, refundVia: 'ADMIN', iban: IBAN, paymentLink: PAYMENT_LINK, amount: 0.2, currency: 'GEL',
      refunds: [
        {},                    // full
        { refundAmount: 0.1 }, // partial
      ],
    });
  });

  // ---------- TBC Open Banking ----------

  // OB refund ჯერ Initiated-ია და Success-ს წუთებში აღწევს — ტესტი ~4 წთ ელოდება, მერე report-ს ადარებს
  test('Refund Reports Module - ინტეგრატორი refund - TBC Open Banking - Over Balance', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkOverBalanceRefunds({
      ...MERCHANT, refundVia: 'INTEGRATOR', iban: IBAN,
      refunds: [{ amount: 0.1, currency: 'GEL', payWith: 'OB_TBC' }], // full
    });
  });

  // ---------- add money (top-up) ----------

  test('Refund Reports Module - add money - მერჩანტი refund - partial და full', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkAddMoneyRefunds({
      ...MERCHANT, refundVia: 'MERCHANT', refunds: ADD_MONEY_REFUNDS,
    });
  });

  test('Refund Reports Module - add money - ადმინი refund - partial და full', async ({ request }) => {
    test.setTimeout(1800000);
    await new RefundReportsHelper(request).checkAddMoneyRefunds({
      ...MERCHANT, refundVia: 'ADMIN', refunds: ADD_MONEY_REFUNDS,
    });
  });
});

// ყოველი ტესტის შემდეგ ბალანსს ვანულებთ (cash-out) — ტესტი რომც ჩავარდეს, ბალანსზე თანხა არ დარჩეს
test.afterEach(async ({ request }) => {
  await new RefundReportsHelper(request).cashOutAllBalance(MERCHANT.phone, MERCHANT.merchantId, IBAN);
});

// ტესტების შემდეგ merchant-ს საწყისი distributionFlow (STANDARD) ვუბრუნებთ — ტესტი რომც ჩავარდეს
test.afterAll(async () => {
  const ctx = await playwrightRequest.newContext();
  try {
    await new RefundReportsHelper(ctx).updateMerchantFlow('STANDARD');
    console.log('✅ Restored: merchant distributionFlow=STANDARD');
  } finally {
    await ctx.dispose();
  }
});
