import { test } from '@playwright/test';
import { RsLienHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// ყადაღის ტესტი — ნეგატიური: გაყინულ ფულს ვერავინ შეეხება, არავალიდური ყადაღა არ იდება
// RS (dev-ზე სიმულატორი) ბიზნესის ident-ზე დებს ყადაღას → ფული იყინება ბიზნესის wallet-ზე
// უარი: wallet-ის გადარიცხვა / ადმინის ჩამოჭრა → 400 / 5038; RS-ის შეკვეთა → items[].code (1, 6, 13, 21, 22)
// ⚠️ wallet-ები STANDARD-ია → ბალანსი არასდროს > 1 ₾ (ამ ფაილში ფული არსად გადაირიცხება — ყველა გადარიცხვა უარყოფილია)

test.describe('ყადაღის ტესტი — ❌ ნეგატიური', () => {
  test.describe.configure({ timeout: 180_000 });

  // ─── wallet ცდილობს გაყინული ფულის გადარიცხვას ───

  test('ბიზნესს ჰყავს 1 wallet: ბალანსი 1 ₾, ყადაღა 1 ₾ (მთლიანად გაყინულია) → wallet ცდილობს 0.5 ₾-ის გადარიცხვას → უარი, ბალანსი უცვლელი', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 1, transfer: 0.5, expect: 'REJECTED' });
  });

  test('ბიზნესს ჰყავს 1 wallet: ბალანსი 1 ₾, ყადაღა 0.5 ₾ (თავისუფალია 0.5 ₾) → wallet ცდილობს 0.6 ₾-ს (თავისუფალზე მეტს, ბალანსზე ნაკლებს) → უარი', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.6, expect: 'REJECTED' });
  });

  test('ზღვარი: ბალანსი 1 ₾, ყადაღა 0.5 ₾ → wallet ცდილობს 0.51 ₾-ს (თავისუფალზე 1 თეთრით მეტს) → უარი', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.51, expect: 'REJECTED' });
  });

  test('ყადაღა ფულზე მეტია: ბალანსი 0.5 ₾, ყადაღა 1 ₾ (ნაწილობრივ გაყინულია, თავისუფალი 0) → wallet ცდილობს 0.1 ₾-ს → უარი', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 0.5, lien: 1, transfer: 0.1, expect: 'REJECTED' });
  });

  // ─── საკომისიო: თავისუფალმა თანხამ უნდა დაფაროს გადარიცხვა + საკომისიო ───

  test('საკომისიო 0.05 ₾ (ფიქსირებული): ბალანსი 1 ₾, ყადაღა 0.9 ₾ (თავისუფალია 0.1 ₾) → wallet ცდილობს ზუსტად 0.1 ₾-ს (+ საკომისიო = 0.15 ₾) → უარი', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.9, transfer: 0.1, expect: 'REJECTED', commission: { type: 'FIXED', value: 0.05 } });
  });

  test('ზღვარი, საკომისიო 0.05 ₾: ბალანსი 1 ₾, ყადაღა 0.9 ₾ (თავისუფალია 0.1 ₾) → wallet ცდილობს 0.06 ₾-ს (+ საკომისიო = 0.11 ₾, 1 თეთრით მეტი) → უარი', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.9, transfer: 0.06, expect: 'REJECTED', commission: { type: 'FIXED', value: 0.05 } });
  });

  test('საკომისიო 10%: ბალანსი 1 ₾, ყადაღა 0.9 ₾ (თავისუფალია 0.1 ₾) → wallet ცდილობს ზუსტად 0.1 ₾-ს (+ 10% = 0.11 ₾) → უარი', async ({ request }) => {
    await new RsLienHelper(request).walletTransfer({ balance: 1, lien: 0.9, transfer: 0.1, expect: 'REJECTED', commission: { type: 'PERCENTAGE', value: 10 } });
  });

  // ─── ადმინი ცდილობს გაყინული ფულის ჩამოჭრას ───

  test('ადმინი ყადაღის დროს: ბალანსი 1 ₾, ყადაღა 0.7 ₾ (თავისუფალია 0.3 ₾) → ადმინი ბალანსიდან ჩამოჭრის 0.5 ₾-ს (თავისუფალზე მეტს) → უარი, ბალანსი უცვლელი', async ({ request }) => {
    await new RsLienHelper(request).adminDebit({ balance: 1, lien: 0.7, debit: 0.5, expect: 'REJECTED' });
  });

  // ─── Unlink / მოხსნა ───

  test('ყადაღის დროს wallet-ის ბიზნესიდან მოხსნა (Unlink) → უარი, wallet ბიზნესზე რჩება', async ({ request }) => {
    await new RsLienHelper(request).unlinkBlocked({ balance: 1, lien: 1 });
  });

  test('RS ხსნის ყადაღას, რომელიც ჩვენთან არ არსებობს → უარი (code 22 — ყადაღის ნომერი ვერ მოიძებნა)', async ({ request }) => {
    await new RsLienHelper(request).withdrawUnknown();
  });

  // ─── დუბლიკატი ───

  test('RS იგივე ნომრით მეორედ აგზავნის ყადაღას → უარი (code 21), ფული ორჯერ არ იყინება', async ({ request }) => {
    await new RsLienHelper(request).duplicateLien({ balance: 1, lien: 0.5 });
  });

  test('RS ცდილობს არსებული ყადაღის თანხის შეცვლას იმავე ნომრით (0.5 ₾ → 1 ₾) → უარი (code 21), გაყინული 0.5 ₾ უცვლელი', async ({ request }) => {
    await new RsLienHelper(request).duplicateLien({ balance: 1, lien: 0.5, newAmount: 1 });
  });

  test('RS იგივე შეტყობინებას ხელახლა აგზავნის (კავშირის პრობლემა) → ახალი ყადაღა არ იქმნება, ფული ორჯერ არ იყინება', async ({ request }) => {
    await new RsLienHelper(request).resendSameMessage({ balance: 1, lien: 0.5 });
  });

  // ─── არავალიდური თანხა (code 6) ───

  test('ყადაღა 0 ₾ → უარი (code 6), არაფერი იყინება', async ({ request }) => {
    await new RsLienHelper(request).invalidAmount('0');
  });

  test('ყადაღა უარყოფითი თანხით (−1 ₾) → უარი (code 6), არაფერი იყინება', async ({ request }) => {
    await new RsLienHelper(request).invalidAmount('-1');
  });

  test('ყადაღა 1 თეთრზე ნაკლები (0.001 ₾) → უარი (code 6), არაფერი იყინება', async ({ request }) => {
    await new RsLienHelper(request).invalidAmount('0.001');
  });

  test('ყადაღა ტექსტით თანხის ნაცვლად ("abc") → უარი (code 6), არაფერი იყინება', async ({ request }) => {
    await new RsLienHelper(request).invalidAmount('abc');
  });

  // ─── ყადაღა ვერ ედება ───

  test('ბიზნესს RS რეგისტრაცია არ აქვს → ყადაღა არ ედება (code 1 — გადამხდელი ვერ მოიძებნა)', async ({ request }) => {
    await new RsLienHelper(request).lienNotApplied('noRegistration');
  });

  test('ბიზნესი RS-ში რეგისტრირებულია, მაგრამ wallet არ ჰყავს → ყადაღა არ ედება (code 13 — ღია ანგარიში არ აქვს)', async ({ request }) => {
    await new RsLienHelper(request).lienNotApplied('noWallet');
  });

  test('ბიზნესის RS რეგისტრაცია გაუქმებულია (Cancel) → ყადაღა არ ედება (code 1 — გადამხდელი ვერ მოიძებნა)', async ({ request }) => {
    await new RsLienHelper(request).lienNotApplied('cancelled');
  });

  // ─── არასწორი ident: RS აგზავნის ყადაღას ნომერზე, რომელიც ჩვენთან არ არსებობს ───

  test('ყადაღა 8-ციფრიან ident-ზე (12345678) → უარი (code 1 — გადამხდელი ვერ მოიძებნა)', async ({ request }) => {
    await new RsLienHelper(request).invalidIdent('12345678');
  });

  test('ყადაღა 10-ციფრიან ident-ზე (1234567890) → უარი (code 1)', async ({ request }) => {
    await new RsLienHelper(request).invalidIdent('1234567890');
  });

  test('ყადაღა ident-ზე ასოებით (abcdefghi) → უარი (code 1)', async ({ request }) => {
    await new RsLienHelper(request).invalidIdent('abcdefghi');
  });

  test('ყადაღა ცარიელ ident-ზე → უარი (code 1)', async ({ request }) => {
    await new RsLienHelper(request).invalidIdent('');
  });

  // ─── უსაფრთხოება: RS-ის შეტყობინებას ციფრული ხელმოწერა აქვს — ყალბს ვერ მივიღებთ ───
  // 💡 სხვანაირად ნებისმიერი შეძლებდა "ყადაღის" გამოგზავნას და კლიენტის ფულის გაყინვას

  test('ყადაღა ყალბი RS ხელმოწერით → მთელი შეტყობინება უარყოფილია (code 4), ყადაღა არ ინახება, ფული არ იყინება', async ({ request }) => {
    await new RsLienHelper(request).forgedSignature({ balance: 1, lien: 0.5 });
  });

  // ─── Reallocate უკვე მოხსნილ ყადაღაზე (გაიდი, known issue #41: 200, მაგრამ არაფერს აკეთებს) ───

  test('RS-მა ყადაღა მოხსნა (Withdrawn) → ადმინი მაინც აჭერს Reallocate → ფული თავიდან არ იყინება, ყადაღა Withdrawn რჩება', async ({ request }) => {
    await new RsLienHelper(request).reallocateWithdrawn({ balance: 1, lien: 0.5 });
  });

  // ─── RS ეკითხება "ეს გადამხდელი ჩვენი კლიენტია?" (CheckPayer) ───

  test('RS ეკითხება ident-ზე, რომელიც ჩვენთან არ არის → ვპასუხობთ შეცდომით code 1 (გადამხდელი ვერ მოიძებნა)', async ({ request }) => {
    await new RsLienHelper(request).checkPayer('unknown');
  });

  test('RS ეკითხება ბიზნესზე, რომელიც რეგისტრირებულია, მაგრამ wallet არ აქვს → ვპასუხობთ შეცდომით code 13 (ღია ანგარიში არ აქვს)', async ({ request }) => {
    await new RsLienHelper(request).checkPayer('noWallet');
  });

  // ─── ჯერ ვერ ვტესტავთ (საჭიროა დეველოპერი / სხვა ექაუნთი) ───

  // გაიდი: Keepz-ის საკომისიო (settlement commission) wallet-ს პერიოდულად ეჭრება — ყადაღის დროს მხოლოდ თავისუფლიდან, თორემ 5089
  test.fixme('Keepz-ის საკომისიო (settlement) ყადაღის დროს → მხოლოდ თავისუფალი თანხიდან, არ ჰყოფნის → უარი (5089) — საჭიროა დეველოპერი settlement-ის გასაშვებად', async () => {});

  // გაიდი (PRM): Reallocate / Return საჭიროებს RS_RESTRICTION_MANAGE უფლებას
  test.fixme('ადმინი RS_RESTRICTION_MANAGE უფლების გარეშე → Reallocate holds აკრძალულია (403) — საჭიროა მეორე, შეზღუდული ადმინი', async () => {});
});
