import { test } from '@playwright/test';
import { RsMerchantLienHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Merchant-ის ყადაღა — ნეგატიური: გაყინულ ფულს merchant ვერ გაიტანს (412 / 2501)
// merchant 599000555 "stromae refund report" — BALANCE flow (ფული ბალანსზე რჩება), RS რეგისტრაცია Approved
// ყადაღა ითვლება merchant-ის მიმდინარე ბალანსიდან (ყადაღა = ბალანსი − თავისუფალი) და ტესტის ბოლოს ყოველთვის იხსნება
// ამ ფაილში ფული არსად გადაირიცხება — ყველა გატანა უარყოფილია

test.describe('Merchant-ის ყადაღა — ❌ ნეგატიური', () => {
  test.describe.configure({ timeout: 180_000 });

  // ─── merchant ცდილობს გაყინული ფულის გატანას (cash-out IBAN-ზე) ───

  test('merchant-ის მთელი ბალანსი გაყინულია (თავისუფალი 0) → merchant ცდილობს 0.5 ₾-ის გატანას → უარი (2501), ბალანსი უცვლელი', async ({ request }) => {
    await new RsMerchantLienHelper(request).cashOutWithLien({ free: 0, cashOut: 0.5, expect: 'REJECTED' });
  });

  test('ზღვარი: merchant-ს თავისუფალი აქვს 0.05 ₾ → ცდილობს 0.06 ₾-ის გატანას (1 თეთრით მეტს) → უარი (2501)', async ({ request }) => {
    await new RsMerchantLienHelper(request).cashOutWithLien({ free: 0.05, cashOut: 0.06, expect: 'REJECTED' });
  });

  test('ყადაღა 1 ₾ (merchant-ის ბალანსი ~1 ₾ — თავისუფალი თითქმის 0) → merchant ცდილობს 0.5 ₾-ის გატანას → უარი (2501)', async ({ request }) => {
    await new RsMerchantLienHelper(request).cashOutFixedLien({ lien: 1, cashOut: 0.5, expect: 'REJECTED' });
  });

  test('merchant-ს თავისუფალი აქვს 0.3 ₾ (დანარჩენი გაყინულია) → ცდილობს 0.4 ₾-ის გატანას (თავისუფალზე მეტს, ბალანსზე ნაკლებს) → უარი (2501)', async ({ request }) => {
    await new RsMerchantLienHelper(request).cashOutWithLien({ free: 0.3, cashOut: 0.4, expect: 'REJECTED' });
  });

  // ─── დუბლიკატი ───

  test('RS იგივე ნომრით მეორედ აგზავნის ყადაღას merchant-ზე → უარი (code 21), ფული ორჯერ არ იყინება', async ({ request }) => {
    await new RsMerchantLienHelper(request).duplicateLien({ free: 0.3 });
  });

  // ─── add money ყადაღის დროს ───

  test('💳 ყადაღა merchant-ის ბალანსზე მეტია (აკლია) → add money 0.2 ₾ → ახალი ფული ყადაღას ავსებს → გატანა 0.1 ₾ → უარი (2501)', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenCashOut({ lien: 'short', topUp: 0.2, cashOut: 0.1 });
  });

  // ─── ადმინის refund ───

  test('💳 add money 0.2 ₾ → merchant-ის მთელი ბალანსი გაყინულია → ადმინი აკეთებს 0.1 ₾-ის refund-ს → გაყინული ფული refund-ში არ მიდის (Keepz-ის ხარჯზე), ბალანსი უცვლელი', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).adminRefundWithLien({ topUp: 0.2, refund: 0.1 });
  });

  // ─── merchant ცდილობს refund-ს ყადაღის დროს (refund-იც ბალანსიდან იჭრება) ───
  // 💳 თითო ტესტი ჯერ add money-ით (ბარათი + OTP) ახალ გადახდას ქმნის, რომ refund-ისთვის ტრანზაქცია იყოს

  test('💳 add money 0.2 ₾ → merchant-ის მთელი ბალანსი გაყინულია → merchant ცდილობს 0.1 ₾-ის refund-ს → უარი (2501), ბალანსი უცვლელი', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).refundWithLien({ topUp: 0.2, free: 0, refund: 0.1, expect: 'REJECTED' });
  });

  test('💳 ზღვარი: add money 0.2 ₾ → merchant-ს თავისუფალი აქვს 0.09 ₾ → refund 0.1 ₾ (1 თეთრით მეტი) → უარი (2501), ბალანსი უცვლელი', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).refundWithLien({ topUp: 0.2, free: 0.09, refund: 0.1, expect: 'REJECTED' });
  });

  test('💳 მიმღების საკომისიო: add money 0.2 ₾ (ერიცხება 0.19) → თავისუფალია მხოლოდ ჩარიცხული 0.19 ₾ → სრული refund 0.2 ₾ (საკომისიოც merchant-ს ეჭრება) → უარი (2501)', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).fullRefundWithReceiverCommission({ topUp: 0.2, free: 'credited' });
  });

  // ─── ინტეგრატორის refund ყადაღის დროს (სხვა endpoint: ecommerce /order/refund) ───

  test('💳 ინტეგრატორის ორდერით გადახდა 0.2 ₾ → merchant-ის მთელი ბალანსი გაყინულია → ინტეგრატორი აკეთებს refund-ს 0.1 ₾ → გაყინული ფული refund-ში არ მიდის, ბალანსი უცვლელი', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).integratorRefundWithLien({ pay: 0.2, free: 0, refund: 0.1, expect: 'BLOCKED' });
  });

  // ─── ფული შემოდის ყადაღის დროს → ჯერ ყადაღას ავსებს ───

  test('💳 ყადაღა merchant-ის ბალანსზე მეტია (აკლია) → ინტეგრატორის ორდერით გადახდა 0.2 ₾ → ახალი ფული ყადაღას ავსებს → გატანა 0.1 ₾ → უარი (2501)', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenCashOut({ lien: 'short', topUp: 0.2, cashOut: 0.1, via: 'ORDER' });
  });

  test('💳 ყადაღა merchant-ის ბალანსზე მეტია (აკლია) → merchant-ის payment link-ით გადახდა 0.2 ₾ → ახალი ფული ყადაღას ავსებს → გატანა 0.1 ₾ → უარი (2501)', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenCashOut({ lien: 'short', topUp: 0.2, cashOut: 0.1, via: 'LINK' });
  });

  test('💳 ყადაღა merchant-ის ბალანსზე მეტია (აკლია) → add money 0.2 ₾ → ახალი ფული ყადაღას ავსებს → refund 0.1 ₾ → უარი (2501)', async ({ request }) => {
    test.setTimeout(300_000);
    await new RsMerchantLienHelper(request).addMoneyDuringLienThenRefund({ lien: 'short', topUp: 0.2, refund: 0.1 });
  });

  // ─── merchant-ი, რომელიც ფულს ვერ ყინავს (გაიდი, HLD-06) ───

  test('merchant STANDARD flow-ზე (ფული პირდაპირ IBAN-ზე მიდის, ბალანსზე არ ჩერდება) → ყადაღა 0.5 ₾ → merchant-ზე არაფერი იყინება', async ({ request }) => {
    await new RsMerchantLienHelper(request).standardFlowCantHold();
  });

  // ─── ⏰ ავტომატური გატანა (DAILY ჯობი, dev-ზე ~10 წთ) — ფაილის ბოლოშია, რადგან ჯობს ველოდებით ───

  test('⏰ ავტომატური გატანა DAILY: merchant-ის მთელი ბალანსი გაყინულია (მაგ. ბალანსი 1, ყადაღა 1) → ჯობი არაფერს გაიტანს, ბალანსი უცვლელი', async ({ request }) => {
    test.setTimeout(15 * 60_000);
    await new RsMerchantLienHelper(request).autoCashOutWithLien({ free: 0, mode: 'DAILY' });
  });
});
