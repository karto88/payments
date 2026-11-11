import { test } from '@playwright/test';
import { RsMerchantLienHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Merchant-ის ყადაღა — პოზიტიური: თავისუფალი ფული გადის, მოხსნის შემდეგ ყველაფერი თავისუფლდება
// merchant 599000555 "stromae refund report" — BALANCE flow (ფული ბალანსზე რჩება), RS რეგისტრაცია Approved
// ყადაღა ითვლება merchant-ის მიმდინარე ბალანსიდან და ტესტის ბოლოს ყოველთვის იხსნება
// 💸 "merchant გაიტანს" — რეალური გატანა merchant-ის IBAN-ზე (GE29TB…0124), merchant-ის ბალანსი მცირდება

test.describe('Merchant-ის ყადაღა — ✅ პოზიტიური', () => {
  test.describe.configure({ timeout: 180_000 });

  // ─── merchant გაიტანს თავისუფალ ფულს ───

  test('ზღვარი: merchant-ს თავისუფალი აქვს 0.05 ₾ (დანარჩენი გაყინულია) → merchant გაიტანს ზუსტად 0.05 ₾-ს → გადის, გაყინული ხელუხლებელია', async ({ request }) => {
    await new RsMerchantLienHelper(request).cashOutWithLien({ free: 0.05, cashOut: 0.05, expect: 'OK' });
  });

  test('merchant-ს თავისუფალი აქვს 0.3 ₾ (დანარჩენი გაყინულია) → merchant გაიტანს 0.2 ₾-ს → გადის, გაყინული ხელუხლებელია', async ({ request }) => {
    await new RsMerchantLienHelper(request).cashOutWithLien({ free: 0.3, cashOut: 0.2, expect: 'OK' });
  });

  // ─── ყადაღის მოხსნა / 2 ყადაღა ───

  test('ყადაღა merchant-ის ბალანსზე მეტია (Partially restricted — გაყინულია მთელი ბალანსი) → RS ხსნის → მთელი ბალანსი თავისუფლდება', async ({ request }) => {
    await new RsMerchantLienHelper(request).withdrawPartialLien();
  });

  test('merchant-ზე 2 ყადაღა: 0.2 ₾ + 0.3 ₾ → გაყინულია 0.5 ₾ (ჯამზე მეტს ვერ გაიტანს) → RS ხსნის პირველს → მეორე 0.3 ₾ ისევ გაყინულია', async ({ request }) => {
    await new RsMerchantLienHelper(request).twoLiens({ first: 0.2, second: 0.3 });
  });

  // ─── add money ყადაღის დროს ───

  test('ყადაღა მთლიანად დაფარულია (= ბალანსი) → add money 0.2 ₾ (ახალი ფული თავისუფალია) → merchant გაიტანს 0.1 ₾-ს → გადის', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenCashOut({ lien: 'covered', topUp: 0.2, cashOut: 0.1 });
  });

  // ─── refund: full / partial ───

  test('add money 0.2 ₾ → ყადაღა ტოვებს თავისუფალს 0.5 ₾ → merchant აკეთებს ნაწილობრივ refund-ს 0.1 ₾ → გადის, გაყინული ხელუხლებელია', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).refundWithLien({ topUp: 0.2, free: 0.5, refund: 0.1, expect: 'OK' });
  });

  test('add money 0.2 ₾ → ყადაღა ტოვებს თავისუფალს 0.5 ₾ → merchant აკეთებს სრულ refund-ს 0.2 ₾ → გადის, გაყინული ხელუხლებელია', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).refundWithLien({ topUp: 0.2, free: 0.5, refund: 0.2, expect: 'OK' });
  });

  // ─── მოხსნა ───

  test('RS ხსნის merchant-ის ყადაღას (მთელი ბალანსი გაყინული იყო) → ფული თავისუფლდება → merchant გაიტანს 0.01 ₾-ს → გადის', async ({ request }) => {
    await new RsMerchantLienHelper(request).withdrawThenCashOut({ cashOut: 0.01 });
  });

  // ─── refund (refund-იც ბალანსიდან იჭრება) ───
  // 💳 თითო ტესტი ჯერ add money-ით (ბარათი + OTP) ახალ გადახდას ქმნის, რომ refund-ისთვის ტრანზაქცია იყოს

  test('add money 0.2 ₾ → ყადაღა მთელ ბალანსზე → RS ხსნის ყადაღას → merchant აკეთებს 0.1 ₾-ის refund-ს → გადის', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).withdrawThenRefund({ topUp: 0.2, refund: 0.1 });
  });

  test('ყადაღა მთლიანად დაფარულია (= ბალანსი) → add money 0.2 ₾ (ახალი ფული თავისუფალია) → merchant აკეთებს 0.1 ₾-ის refund-ს → გადის', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenRefund({ lien: 'covered', topUp: 0.2, refund: 0.1 });
  });

  // ─── refund-ის ზღვარი (merchant-ის refund-ს საკომისიო არ აქვს: 1.42 − 0.1 = 1.32) ───

  test('ზღვარი: add money 0.2 ₾ → merchant-ს თავისუფალი აქვს ზუსტად 0.1 ₾ → refund 0.1 ₾ → გადის (refund-ს საკომისიო არ აქვს), გაყინული ხელუხლებელია', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).refundWithLien({ topUp: 0.2, free: 0.1, refund: 0.1, expect: 'OK' });
  });

  test('მიმღების საკომისიო: add money 0.2 ₾ (ერიცხება 0.19) → თავისუფალია 0.2 ₾ → სრული refund 0.2 ₾ → გადის, merchant-ს ეჭრება მთელი 0.2 ₾ (საკომისიოც), გაყინული ხელუხლებელია', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).fullRefundWithReceiverCommission({ topUp: 0.2, free: 'payment' });
  });

  // ─── ინტეგრატორის refund (სხვა endpoint: ecommerce /order/refund) ───

  test('ინტეგრატორის ორდერით გადახდა 0.2 ₾ → ყადაღა ტოვებს თავისუფალს 0.5 ₾ → ინტეგრატორი აკეთებს refund-ს 0.1 ₾ → გადის, გაყინული ხელუხლებელია', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).integratorRefundWithLien({ pay: 0.2, free: 0.5, refund: 0.1, expect: 'OK' });
  });

  // ─── ფული შემოდის ყადაღის დროს (ინტეგრატორის ორდერი / payment link) ───

  test('ყადაღა მთლიანად დაფარულია (= ბალანსი) → ინტეგრატორის ორდერით გადახდა 0.2 ₾ (ახალი ფული თავისუფალია) → merchant გაიტანს 0.1 ₾-ს → გადის', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenCashOut({ lien: 'covered', topUp: 0.2, cashOut: 0.1, via: 'ORDER' });
  });

  test('ყადაღა მთლიანად დაფარულია (= ბალანსი) → merchant-ის payment link-ით გადახდა 0.2 ₾ (ახალი ფული თავისუფალია) → merchant გაიტანს 0.1 ₾-ს → გადის', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenCashOut({ lien: 'covered', topUp: 0.2, cashOut: 0.1, via: 'LINK' });
  });

  // ─── ⏰ ავტომატური გატანა (DAILY ჯობი, dev-ზე ~10 წთ) — ფაილის ბოლოშია, რადგან ჯობს ველოდებით ───

  test('ავტომატური გატანა DAILY: merchant-ს თავისუფალი აქვს 0.5 ₾, დანარჩენი გაყინულია (მაგ. ბალანსი 1.5, ყადაღა 1) → ჯობი გაიტანს მხოლოდ 0.5 ₾-ს, გაყინული ხელუხლებელია', async ({ request }) => {
    test.setTimeout(15 * 60_000);
    await new RsMerchantLienHelper(request).autoCashOutWithLien({ free: 0.5, mode: 'DAILY' });
  });

  test('სავტომატური გატანა DAILY: მთელი ბალანსი გაყინულია → RS ხსნის ყადაღას → ჯობი გაიტანს მთელ ბალანსს (ბალანსი 0) 💸', async ({ request }) => {
    test.setTimeout(15 * 60_000);
    await new RsMerchantLienHelper(request).autoCashOutAfterWithdraw({ mode: 'DAILY' });
  });
});
