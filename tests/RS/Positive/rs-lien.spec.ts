import { test } from '@playwright/test';
import { RsLienHelper } from '../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// ყადაღის ტესტი — პოზიტიური: ყადაღა იდება / იხსნება / ნაწილდება wallet-ებზე, თავისუფალი ფული გადის
// RS (dev-ზე სიმულატორი) ბიზნესის ident-ზე დებს ყადაღას → ფული იყინება ბიზნესის wallet-ზე
// წესი: გაყინულ ფულს (held) ვერავინ შეეხება — მხოლოდ თავისუფალი ნაწილი (ბალანსი − გაყინული) შეიძლება გავიდეს
// ⚠️ wallet-ები STANDARD-ია (რეალური გადარიცხვები) → ბალანსი არასდროს > 1 ₾, გადარიცხვა < 1 ₾
// 💸 "wallet გადარიცხავს" — რეალური გადარიცხვა IBAN-ზე (გაშვება: --grep "wallet გადარიცხავს")

test.describe('ყადაღის ტესტი — ✅ პოზიტიური', () => {
  test.describe.configure({ timeout: 180_000 });

  // ─── wallet გადარიცხავს თავისუფალ ფულს ───

  test('ბიზნესს ჰყავს 1 wallet: ბალანსი 1 ₾, ყადაღა 0.5 ₾ (თავისუფალია 0.5 ₾) → wallet გადარიცხავს 0.3 ₾-ს → გადის, გაყინული 0.5 ₾ ხელუხლებელია', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.3, expect: 'OK' });
  });

  test('ზღვარი: ბალანსი 1 ₾, ყადაღა 0.5 ₾ → wallet გადარიცხავს ზუსტად თავისუფალ 0.5 ₾-ს → გადის, თავისუფალი ხდება 0', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.5, expect: 'OK' });
  });

  test('ადმინი ყადაღის დროს: ბალანსი 1 ₾, ყადაღა 0.7 ₾ (თავისუფალია 0.3 ₾) → ადმინი ბალანსიდან ჩამოჭრის 0.3 ₾-ს → გადის, გაყინული 0.7 ₾ რჩება', async ({ request }) => {
    await new RsLienHelper(request).adminDebit({ balance: 1, lien: 0.7, debit: 0.3, expect: 'OK' });
  });

  // ─── საკომისიო: თავისუფალი თანხა ფარავს გადარიცხვა + საკომისიოს ───

  test('ზღვარი, საკომისიო 0.05 ₾: ბალანსი 1 ₾, ყადაღა 0.9 ₾ (თავისუფალია 0.1 ₾) → wallet გადარიცხავს 0.05 ₾-ს (+ საკომისიო = ზუსტად 0.1 ₾) → გადის, ბალანსი 0.9 ₾, გაყინული 0.9 ₾ ხელუხლებელია', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.9, transfer: 0.05, expect: 'OK', commission: { type: 'FIXED', value: 0.05 } });
  });

  test('საკომისიო 10%: ბალანსი 1 ₾, ყადაღა 0.9 ₾ (თავისუფალია 0.1 ₾) → wallet გადარიცხავს 0.09 ₾-ს (+ 10% = 0.009 → 0.01 ₾) → გადის, ბალანსი 0.9 ₾, გაყინული ხელუხლებელია', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.9, transfer: 0.09, expect: 'OK', commission: { type: 'PERCENTAGE', value: 10 } });
  });

  // ─── ყადაღის სტატუსი / ახალი ფული ───

  test('ბალანსი 0 ₾ → ყადაღა 0.5 ₾ → ყადაღა მიღებულია, მაგრამ გასაყინი არაფერია (Pending — ელოდება ფულს)', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 0, lien: 0.5, transfer: 0.1, expect: 'REJECTED' });
  });

  // 🐞 KD-2616 — ყადაღა არ ახლდება (რჩება Partially restricted 0.5)
  test('ყადაღა ფულზე მეტია: ბალანსი 0.5 ₾, ყადაღა 1 ₾ → ადმინი ავსებს ბალანსს 0.5 ₾-ით → ახალი ფულიც იყინება, wallet ვერ გადარიცხავს 0.1 ₾-ს, ყადაღა მთლიანად დაფარულია (Fully restricted)', async ({ request }) => {
    await new RsLienHelper(request).topUpFillsHold({ balance: 0.5, lien: 1, topUp: 0.5, transfer: 0.1 });
  });

  // 🐞 KD-2616
  test('ნაწილობრივი შევსება: ბალანსი 0.5 ₾, ყადაღა 1 ₾ → ადმინი ავსებს ბალანსს 0.4 ₾-ით → გაყინულია 0.9 ₾, აკლია 0.10 ₾ (ისევ Partially restricted), დარჩენილი ვალი 1 ₾', async ({ request }) => {
    await new RsLienHelper(request).topUpFillsHold({ balance: 0.5, lien: 1, topUp: 0.4, transfer: 0.1 });
  });

  // 🐞 KD-2616
  test('ცარიელი wallet: ბალანსი 0 ₾, ყადაღა 1 ₾ (Pending) → ადმინი ავსებს ბალანსს 0.4 ₾-ით → გაყინულია 0.4 ₾, აკლია 0.60 ₾ (Partially restricted), დარჩენილი ვალი 1 ₾', async ({ request }) => {
    await new RsLienHelper(request).topUpFillsHold({ balance: 0, lien: 1, topUp: 0.4, transfer: 0.1 });
  });

  // ─── მოხსნა ───

  test('RS-მა შეცდომით 0.5 ₾-იანი ყადაღა გამოაგზავნა → ხსნის მას → იმავე ბიზნესზე აგზავნის ახალს 1 ₾-ზე → ძველი Withdrawn, გაყინულია მხოლოდ 1 ₾ (ორმაგად არა)', async ({ request }) => {
    await new RsLienHelper(request).replaceLien({ balance: 1, wrong: 0.5, correct: 1 });
  });

  test('RS ხსნის ყადაღას: ბალანსი 1 ₾, ყადაღა 1 ₾ → მოხსნა (Withdrawn) → ფული თავისუფლდება → wallet გადარიცხავს 0.5 ₾-ს → გადის', async ({ request }) => {
    await new RsLienHelper(request).withdrawThenTransfer({ balance: 1, lien: 1, transfer: 0.5 });
  });

  test('RS ხსნის ნაწილობრივ გაყინულ ყადაღას: ბალანსი 0.5 ₾, ყადაღა 1 ₾ (Partially restricted) → მოხსნა → Withdrawn, მთელი 0.5 ₾ თავისუფლდება', async ({ request }) => {
    await new RsLienHelper(request).withdrawPartial({ balance: 0.5, lien: 1 });
  });

  test('ერთ wallet-ზე 2 ყადაღა: ბალანსი 1 ₾, ყადაღები 0.3 ₾ + 0.4 ₾ → გაყინულია 0.7 ₾ → RS ხსნის პირველს → გაყინული რჩება 0.4 ₾ → პირველის მოხსნა მეორედ არაფერს ცვლის', async ({ request }) => {
    await new RsLienHelper(request).twoLiensOneWithdrawn({ balance: 1, liens: [0.3, 0.4] });
  });

  test('ყადაღის მოხსნის შემდეგ wallet-ის ბიზნესიდან მოხსნა (Unlink) → გადის', async ({ request }) => {
    await new RsLienHelper(request).unlinkAfterWithdraw({ balance: 1, lien: 1 });
  });

  // ─── რეგისტრაცია ჯერ არ არის Approved ───

  test('რეგისტრაცია გაგზავნილია და ელოდება RS-ის დადასტურებას (Pending) → მოდის ყადაღა 0.5 ₾ → რეგისტრაცია ხდება Approved, ყადაღა იდება', async ({ request }) => {
    await new RsLienHelper(request).lienApprovesRegistration('submitted', { balance: 1, lien: 0.5 });
  });

  test('რეგისტრაცია შექმნილია, მაგრამ RS-ში არ გაგზავნილა (Not submitted) → მოდის ყადაღა 0.5 ₾ → რეგისტრაცია ხდება Approved, ყადაღა იდება', async ({ request }) => {
    await new RsLienHelper(request).lienApprovesRegistration('notSubmitted', { balance: 1, lien: 0.5 });
  });

  // ─── ბიზნესს 2 wallet ───

  test('ბიზნესს 2 wallet: A — 0.3 ₾, B — 0.6 ₾ → ყადაღა 0.5 ₾ → იყინება მხოლოდ B (ჯერ ყველაზე დიდი ბალანსი), A თავისუფალია', async ({ request }) => {
    await new RsLienHelper(request).twoWallets({ a: 0.3, b: 0.6, lien: 0.5, expectHeld: [0, 0.5] });
  });

  test('ბიზნესს 2 wallet: A — 0.3 ₾, B — 0.6 ₾ → ყადაღა 1 ₾ (ჯამზე მეტი) → ორივე მთლიანად იყინება, აკლია 0.1 ₾ (Partially restricted)', async ({ request }) => {
    await new RsLienHelper(request).twoWallets({ a: 0.3, b: 0.6, lien: 1, expectHeld: [0.3, 0.6] });
  });

  test('ბიზნესს ჰყავს A wallet 0.5 ₾, ყადაღა 1 ₾ (A მთლიანად გაყინულია) → ემატება B wallet (1 ₾) → A ცდილობს 0.3 ₾-ის გადარიცხვას → უარი → ადმინი აჭერს Reallocate → იყინება B, A თავისუფლდება', async ({ request }) => {
    await new RsLienHelper(request).secondWalletAfterLien({ a: 0.5, b: 1, lien: 1, transfer: 0.3, reallocate: 'admin' });
  });

  test('ბიზნესს ჰყავს wallet A (0.5 ₾), ყადაღა 1 ₾ → ემატება wallet B (1 ₾) → ადმინი აჭერს Reallocate → A თავისუფლდება → wallet გადარიცხავს A-დან 0.3 ₾-ს → გადის', async ({ request }) => {
    await new RsLienHelper(request).secondWalletAfterLien({ a: 0.5, b: 1, lien: 1, transfer: 0.3, reallocate: 'admin', transferAfter: 0.3 });
  });

  // ⏱ ~17 წთ — docs: დაკლებული თანხა თავიდან მოწმდება ყოველ 15 წუთში
  test('ბიზნესს ჰყავს wallet A (0.5 ₾), ყადაღა 1 ₾ (აკლია 0.5 ₾) → ემატება wallet B (1 ₾) → Reallocate-ის გარეშე, 15 წუთში სისტემა თვითონ ანაწილებს: იყინება B (1 ₾), A თავისუფლდება', async ({ request }) => {
    test.setTimeout(20 * 60_000);
    await new RsLienHelper(request).secondWalletAfterLien({ a: 0.5, b: 1, lien: 1, transfer: 0.3, reallocate: 'auto' });
  });

  // ─── ყადაღა მხოლოდ ლარს ეხება (გაიდი, HLD-05) ───

  test('wallet-ს მხოლოდ დოლარი აქვს (1 $) → ყადაღა 0.5 ₾ → არაფერი იყინება, ყადაღა Pending (ელოდება ლარს)', async ({ request }) => {
    await new RsLienHelper(request).otherCurrency('usdOnly', { gel: 0, usd: 1, lien: 0.5 });
  });

  test('wallet-ს აქვს 0.5 ₾ და 1 $ → ყადაღა 0.5 ₾ (ლარი მთლიანად გაყინულია) → wallet გადარიცხავს 0.1 $-ს → გადის, დოლარი ყადაღას არ ეხება', async ({ request }) => {
    await new RsLienHelper(request).otherCurrency('usdTransfer', { gel: 0.5, usd: 1, lien: 0.5, transfer: 0.1 });
  });

  // ─── wallet, რომელიც ფულს ვერ ყინავს (გაიდი, HLD-06): unlimited — რეალური ფული არ აქვს ───

  test('wallet შეუზღუდავი ბალანსით (unlimited) → ყადაღა 0.5 ₾ → არაფერი იყინება, ყადაღა Pending ("wallet-ს ფულის გაყინვა არ შეუძლია")', async ({ request }) => {
    await new RsLienHelper(request).unlimitedWallet({ lien: 0.5 });
  });

  // ─── wallet / ბიზნესის ცვლილება ყადაღის დროს (გაიდი, HLD-13 / ENR-06) ───
  // ⚠️ wallet-ის წაშლა (DELETE /api/distributor-hub-client/{id}) → 500 — ამიტომ ვამოწმებთ გამორთვას (status false)

  test('ყადაღის დროს wallet-ს გამორთავენ (status false) → გაყინული ფული გაყინული რჩება, ყადაღა უცვლელი', async ({ request }) => {
    await new RsLienHelper(request).deactivatedWalletKeepsHold({ balance: 1, lien: 0.5 });
  });

  test('ყადაღის დროს ადმინი ცვლის ბიზნესის სახელს (Edit business) → ყადაღა და გაყინული ფული ადგილზე რჩება', async ({ request }) => {
    await new RsLienHelper(request).businessEditKeepsLien({ balance: 1, lien: 0.5 });
  });

  // ─── რეგისტრაციამდე wallet-ი არ იბლოკება (გაიდი, BLK-01: ბლოკი მხოლოდ log-შია, enforce=false) ───

  test('ბიზნესი RS-ში ჯერ არ არის დადასტურებული (Not submitted), ყადაღა არ ადევს → wallet გადარიცხავს 0.1 ₾-ს → გადის', async ({ request }) => {
    await new RsLienHelper(request).transferBeforeApproval({ balance: 1, transfer: 0.1 });
  });

  // ─── Foreign ბიზნესი: RS-ი იცნობს ალტერნატიული პირადი ნომრით (personIdAlt) ───

  test('Foreign ბიზნესი (1 ₾) → RS აგზავნის ყადაღას 0.5 ₾ ალტერნატიული პირადი ნომრით → wallet-ზე იყინება 0.5 ₾', async ({ request }) => {
    await new RsLienHelper(request).foreignLien({ balance: 1, lien: 0.5 });
  });

  // ─── RS ეკითხება "ეს გადამხდელი ჩვენი კლიენტია?" (CheckPayer) ───

  test('RS ეკითხება ჩვენს ბიზნესზე (Approved + wallet) → ვპასუხობთ "ჩვენი კლიენტია" (შეცდომის გარეშე)', async ({ request }) => {
    await new RsLienHelper(request).checkPayer('ours');
  });

  // ─── გადარიცხვა და ყადაღა ერთდროულად (გაიდი, HLD-12) ───

  test('wallet გადარიცხავს მთელ ბალანსს (0.3 ₾) ზუსტად იმ მომენტში, როცა ყადაღა მოდის → ან გადარიცხვა უარყოფილია, ან გასაყინი აღარაფერია; გაყინული არასდროს აღემატება ბალანსს', async ({ request }) => {
    await new RsLienHelper(request).raceTransferAndLien({ balance: 0.3, lien: 0.3 });
  });
});
