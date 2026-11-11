import { test } from '@playwright/test';
import { RsCollectionHelper, RsLienHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ინკასო — ❌ ნეგატიური (hub WALLET კლიენტი)
// ყადაღის ნეგატიური ქეისები RsLienHelper-ით (რეჟიმი COLLECTION) + ინკასოს საკუთარი: Request amount, ხელით გადახდის უარები (COL-17)
// RS-ის კოდები ინკასოზე: 11 — ნომერი არსებობს, 12 — ვერ მოიძებნა, 24 — უცნობი ხაზინის კოდი, 6 — არავალიდური თანხა, 1 / 13 — გადამხდელი / ანგარიში
// ⚠️ hub STANDARD = რეალური ფული → თანხები ≤ 1 ₾

const col = (request: any) => new RsLienHelper(request, 'COLLECTION');

test.describe('ინკასო — ❌ გაყინული ფულის გატანა', () => {
  test.describe.configure({ timeout: 420_000 });

  test('ბალანსი 1 ₾, ინკასო 1 ₾ (მთლიანად გაყინულია) → wallet ცდილობს 0.5 ₾-ის გადარიცხვას → უარი (5038), ბალანსი უცვლელი', async ({ request }) => {
    await col(request).walletTransfer({ balance: 1, lien: 1, transfer: 0.5, expect: 'REJECTED' });
  });

  test('ბალანსი 1 ₾, ინკასო 0.5 ₾ → wallet ცდილობს 0.6 ₾-ს (თავისუფალზე მეტს) → უარი (5038)', async ({ request }) => {
    await col(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.6, expect: 'REJECTED' });
  });

  test('ზღვარი: ბალანსი 1 ₾, ინკასო 0.5 ₾ → wallet ცდილობს 0.51 ₾-ს (1 თეთრით მეტს) → უარი (5038)', async ({ request }) => {
    await col(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.51, expect: 'REJECTED' });
  });

  test('ინკასო ფულზე მეტია: ბალანსი 0.5 ₾, ინკასო 1 ₾ (თავისუფალი 0) → wallet ცდილობს 0.1 ₾-ს → უარი (5038)', async ({ request }) => {
    await col(request).walletTransfer({ balance: 0.5, lien: 1, transfer: 0.1, expect: 'REJECTED' });
  });

  test('საკომისიო 0.05 ₾: ბალანსი 1 ₾, ინკასო 0.9 ₾ (თავისუფალია 0.1) → wallet ცდილობს 0.1 ₾-ს (+ საკომისიო = 0.15) → უარი (5038)', async ({ request }) => {
    await col(request).walletTransfer({ balance: 1, lien: 0.9, transfer: 0.1, expect: 'REJECTED', commission: { type: 'FIXED', value: 0.05 } });
  });

  test('ადმინი ინკასოს დროს: ბალანსი 1 ₾, ინკასო 0.7 ₾ (თავისუფალია 0.3) → ადმინი ჩამოჭრის 0.5 ₾-ს → უარი (5038), ბალანსი უცვლელი', async ({ request }) => {
    await col(request).adminDebit({ balance: 1, lien: 0.7, debit: 0.5, expect: 'REJECTED' });
  });

  test('ინკასოს დროს wallet-ის ბიზნესიდან მოხსნა (Unlink) → უარი (1492), wallet ბიზნესზე რჩება', async ({ request }) => {
    await col(request).unlinkBlocked({ balance: 1, lien: 0.5 });
  });
});

test.describe('ინკასო — ❌ RS-ის შეტყობინებები', () => {
  test.describe.configure({ timeout: 420_000 });

  test('RS ხსნის ინკასოს, რომელიც ჩვენთან არ არსებობს → უარი (code 12 — ნომერი ვერ მოიძებნა)', async ({ request }) => {
    await col(request).withdrawUnknown();
  });

  test('RS იგივე ნომრით მეორედ აგზავნის ინკასოს (იგივე თანხა) → უარი (code 11), ფული ორჯერ არ იყინება', async ({ request }) => {
    await col(request).duplicateLien({ balance: 1, lien: 0.5 });
  });

  test('RS იგივე ნომრით სხვა თანხას აგზავნის (0.5 → 1 ₾) → უარი (code 11), გაყინული 0.5 უცვლელი', async ({ request }) => {
    await col(request).duplicateLien({ balance: 1, lien: 0.5, newAmount: 1 });
  });

  test('RS იგივე შეტყობინებას ხელახლა აგზავნის (resend) → ახალი ინკასო არ იქმნება, ფული ორჯერ არ იყინება', async ({ request }) => {
    await col(request).resendSameMessage({ balance: 1, lien: 0.5 });
  });

  test('ინკასო 0 ₾ → უარი (code 6), არაფერი იყინება', async ({ request }) => {
    await col(request).invalidAmount('0');
  });

  test('ინკასო უარყოფითი თანხით (−1 ₾) → უარი (code 6)', async ({ request }) => {
    await col(request).invalidAmount('-1');
  });

  test('ინკასო 1 თეთრზე ნაკლები (0.001 ₾) → უარი (code 6)', async ({ request }) => {
    await col(request).invalidAmount('0.001');
  });

  test('ინკასო ტექსტით ("abc") → უარი (code 6)', async ({ request }) => {
    await col(request).invalidAmount('abc');
  });

  test('COL-14: ინკასო უცნობი ხაზინის კოდით → უარი (code 24), არაფერი ინახება და იყინება', async ({ request }) => {
    await new RsCollectionHelper(request).badTreasury({ balance: 1, amount: 0.5 });
  });

  test('ყალბი RS ხელმოწერით → მთელი შეტყობინება უარყოფილია (code 4), ინკასო არ ინახება', async ({ request }) => {
    await col(request).forgedSignature({ balance: 1, lien: 0.5 });
  });
});

test.describe('ინკასო — ❌ გადამხდელი / ანგარიში ვერ მოიძებნა', () => {
  test.describe.configure({ timeout: 420_000 });

  test('ბიზნესს RS რეგისტრაცია არ აქვს → ინკასო არ ედება (code 1)', async ({ request }) => {
    await col(request).lienNotApplied('noRegistration');
  });

  test('ბიზნესი Approved, wallet არ ჰყავს → code 13 და RS-ს ავტომატურად ეგზავნება ReturnCollection', async ({ request }) => {
    await new RsCollectionHelper(request).noWalletReturns({ amount: 0.5 });
  });

  test('ბიზნესის RS რეგისტრაცია გაუქმებულია (Cancel) → ინკასო არ ედება (code 1)', async ({ request }) => {
    await col(request).lienNotApplied('cancelled');
  });

  test('ინკასო 8-ციფრიან ident-ზე (12345678) → უარი (code 1)', async ({ request }) => {
    await col(request).invalidIdent('12345678');
  });

  test('ინკასო ident-ზე ასოებით (abcdefghi) → უარი (code 1)', async ({ request }) => {
    await col(request).invalidIdent('abcdefghi');
  });

  test('RS-მა ინკასო მოხსნა (Withdrawn) → ადმინი მაინც აჭერს Reallocate → ფული თავიდან არ იყინება', async ({ request }) => {
    await col(request).reallocateWithdrawn({ balance: 1, lien: 0.5 });
  });
});

test.describe('ინკასო — ❌ Request amount', () => {
  test.describe.configure({ timeout: 420_000 });

  test('COL-02: Request amount იმავე დღეს მეორედ → უარი 409 / 7018', async ({ request }) => {
    await new RsCollectionHelper(request).requestAmountTwice({ balance: 0.5, amount: 0.1 });
  });

  test('COL-02: Request amount, როცა არაფერია გაყინული (ცარიელი wallet, Pending) → უარი 409 / 7011', async ({ request }) => {
    await new RsCollectionHelper(request).requestAmountNothingHeld({ amount: 0.1 });
  });

  test('ინკასო PROCESSING-ზეა (RS-ის პასუხს ელოდება) → ადმინი აჭერს Return → უარი 409 / 7011, ინკასო არ ბრუნდება, ფული გაყინულია', async ({ request }) => {
    await new RsCollectionHelper(request).returnWhileProcessing({ balance: 0.5, amount: 0.1 });
  });

  test('Request amount RS-ში დაბრუნებულ (Returned) ინკასოზე → უარი 409 / 7011', async ({ request }) => {
    await new RsCollectionHelper(request).requestAmountReturned({ balance: 0.5, amount: 0.1 });
  });
});

test.describe('ინკასო — ❌ ხელით გადახდის უარები (COL-17)', () => {
  test.describe.configure({ timeout: 420_000 });

  test('ხელით გადახდა RS-ის პასუხამდე (Request amount ჯერ არ გაგზავნილა) → უარი 409 / 7031, არაფერი ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).manualPaymentBeforeAnswer({ balance: 0.5, amount: 0.1 });
  });

  test('RS-მა უპასუხა 0.1 ₾ → ადმინი აფიქსირებს 0.11-ს (RS-ის პასუხზე მეტს) → უარი 400 / 7032, არაფერი ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).manualPaymentInvalid('over', { balance: 0.5, amount: 0.1 });
  });

  test('RS-მა უპასუხა 0.1 ₾ → ადმინი აფიქსირებს 0 ₾-ს → უარი 400 (ვალიდაცია), არაფერი ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).manualPaymentInvalid('zero', { balance: 0.5, amount: 0.1 });
  });

  test('RS-მა უპასუხა 0.1 ₾ → ადმინი აფიქსირებს 0.055-ს (3 ციფრი მძიმის შემდეგ) → უარი 400 (ვალიდაცია), არაფერი ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).manualPaymentInvalid('decimals', { balance: 0.5, amount: 0.1 });
  });

  test('RS-მა უპასუხა 0.1 ₾ → ადმინი აფიქსირებს გადახდას ცარიელი bankReference-ით → უარი 400 (ვალიდაცია), არაფერი ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).manualPaymentInvalid('noReference', { balance: 0.5, amount: 0.1 });
  });

  test('RS-მა უპასუხა 0.1 ₾ → ადმინი აფიქსირებს გადახდას ხვალინდელი paidAt-ით (მომავალში) → უარი 400 / 7033, არაფერი ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).manualPaymentInvalid('future', { balance: 0.5, amount: 0.1 });
  });

  test('ადმინი აფიქსირებს 0.1 ₾-ს → ინკასო EXECUTED → იგივე გადახდას მეორედ აფიქსირებს → უარი 409 / 7031, ფული მეორედ არ ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).manualPaymentTwice({ balance: 0.5, amount: 0.1 });
  });
});
