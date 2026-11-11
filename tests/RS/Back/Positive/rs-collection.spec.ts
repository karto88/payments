import { test } from '@playwright/test';
import { RsCollectionHelper, RsLienHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ინკასო — ✅ პოზიტიური (hub WALLET კლიენტი)
// ინკასო ფულს ყინავს ისევე, როგორც ყადაღა (Available = ბალანსი − გაყინული) → იგივე ქეისები RsLienHelper-ით, რეჟიმი COLLECTION
// + ინკასოს საკუთარი: Request amount, ხელით გადახდა (MANUAL), Return, კორექცია, მესამე პირი, RS-ის პასუხი 0 / ნაწილი
// ⚠️ hub STANDARD = რეალური ფული → თანხები ≤ 1 ₾; 💸 "გადარიცხავს" — რეალური გადარიცხვა IBAN-ზე

const col = (request: any) => new RsLienHelper(request, 'COLLECTION');

test.describe('ინკასო — ✅ გაყინვა და თავისუფალი ფული', () => {
  test.describe.configure({ timeout: 420_000 });

  test('ბიზნესს 1 wallet: ბალანსი 1 ₾, ინკასო 0.5 ₾ (თავისუფალია 0.5) → wallet გადარიცხავს 0.3 ₾-ს 💸 → გადის, გაყინული 0.5 ხელუხლებელია', async ({ request }) => {
    await col(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.3, expect: 'OK' });
  });

  test('ზღვარი: ბალანსი 1 ₾, ინკასო 0.5 ₾ → wallet გადარიცხავს ზუსტად თავისუფალ 0.5 ₾-ს 💸 → გადის', async ({ request }) => {
    await col(request).walletTransfer({ balance: 1, lien: 0.5, transfer: 0.5, expect: 'OK' });
  });

  test('ადმინი ინკასოს დროს: ბალანსი 1 ₾, ინკასო 0.7 ₾ (თავისუფალია 0.3) → ადმინი ჩამოჭრის 0.3 ₾-ს → გადის, გაყინული 0.7 რჩება', async ({ request }) => {
    await col(request).adminDebit({ balance: 1, lien: 0.7, debit: 0.3, expect: 'OK' });
  });

  test('ზღვარი, საკომისიო 0.05 ₾: ბალანსი 1 ₾, ინკასო 0.9 ₾ (თავისუფალია 0.1) → wallet გადარიცხავს 0.05 ₾-ს (+ საკომისიო = 0.1) 💸 → გადის', async ({ request }) => {
    await col(request).walletTransfer({ balance: 1, lien: 0.9, transfer: 0.05, expect: 'OK', commission: { type: 'FIXED', value: 0.05 } });
  });
});

test.describe('ინკასო — ✅ სტატუსი და ახალი ფული', () => {
  test.describe.configure({ timeout: 420_000 });

  test('ბალანსი 0 ₾ → ინკასო 0.5 ₾ → მიღებულია, გასაყინი არაფერია (Pending — ელოდება ფულს)', async ({ request }) => {
    await col(request).walletTransfer({ balance: 0, lien: 0.5, transfer: 0.1, expect: 'REJECTED' });
  });

  test('ინკასო ფულზე მეტია: ბალანსი 0.5 ₾, ინკასო 1 ₾ → ადმინი ავსებს 0.5-ით → ახალი ფულიც იყინება → Fully restricted, wallet ვერ გადარიცხავს 0.1-ს', async ({ request }) => {
    await col(request).topUpFillsHold({ balance: 0.5, lien: 1, topUp: 0.5, transfer: 0.1 });
  });

  test('ნაწილობრივი შევსება: ბალანსი 0.5 ₾, ინკასო 1 ₾ → ადმინი ავსებს 0.4-ით → გაყინულია 0.9, აკლია 0.10 (Partially restricted)', async ({ request }) => {
    await col(request).topUpFillsHold({ balance: 0.5, lien: 1, topUp: 0.4, transfer: 0.1 });
  });

  test('ცარიელი wallet: ბალანსი 0 ₾, ინკასო 1 ₾ (Pending) → ადმინი ავსებს 0.4-ით → გაყინულია 0.4, აკლია 0.60 (Partially restricted)', async ({ request }) => {
    await col(request).topUpFillsHold({ balance: 0, lien: 1, topUp: 0.4, transfer: 0.1 });
  });
});

test.describe('ინკასო — ✅ მოხსნა (RS ხსნის — ObtainCollection) და დაბრუნება', () => {
  test.describe.configure({ timeout: 420_000 });

  test('RS ხსნის ინკასოს: ბალანსი 1 ₾, ინკასო 1 ₾ → Withdrawn → ფული თავისუფლდება → wallet გადარიცხავს 0.5 ₾-ს 💸 → გადის', async ({ request }) => {
    await col(request).withdrawThenTransfer({ balance: 1, lien: 1, transfer: 0.5 });
  });

  test('RS ხსნის ნაწილობრივ გაყინულ ინკასოს: ბალანსი 0.5 ₾, ინკასო 1 ₾ → Withdrawn, მთელი 0.5 თავისუფლდება', async ({ request }) => {
    await col(request).withdrawPartial({ balance: 0.5, lien: 1 });
  });

  test('ერთ wallet-ზე 2 ინკასო: ბალანსი 1 ₾, 0.3 + 0.4 → გაყინულია 0.7 → RS ხსნის პირველს → რჩება 0.4 → პირველის მოხსნა მეორედ არაფერს ცვლის', async ({ request }) => {
    await col(request).twoLiensOneWithdrawn({ balance: 1, liens: [0.3, 0.4] });
  });

  test('RS-მა შეცდომით 0.5 ₾ გამოაგზავნა → ხსნის → აგზავნის ახალს 1 ₾-ზე → ძველი Withdrawn, გაყინულია მხოლოდ 1 ₾', async ({ request }) => {
    await col(request).replaceLien({ balance: 1, wrong: 0.5, correct: 1 });
  });

  test('ინკასოს მოხსნის შემდეგ wallet-ის ბიზნესიდან მოხსნა (Unlink) → გადის', async ({ request }) => {
    await col(request).unlinkAfterWithdraw({ balance: 1, lien: 0.5 });
  });

  test('COL-11: ადმინი აბრუნებს ინკასოს RS-ში (Return) → Returned, გაყინული 0.5 თავისუფლდება, RS-ს მიდის ReturnCollection', async ({ request }) => {
    await new RsCollectionHelper(request).returnToRs({ balance: 1, amount: 0.5 });
  });

  test('COL-12: RS ასწორებს ინკასოს (0.3 → 0.5, note #ძველი) → ძველი იცვლება, გაყინულია მხოლოდ 0.5 (ორმაგად არა)', async ({ request }) => {
    await new RsCollectionHelper(request).correction({ balance: 1, amount: 0.3, corrected: 0.5 });
  });
});

test.describe('ინკასო — ✅ რეგისტრაცია, რამდენიმე wallet, ვალუტა', () => {
  test.describe.configure({ timeout: 420_000 });

  test('რეგისტრაცია გაგზავნილია (Pending RS approval) → მოდის ინკასო 0.5 ₾ → რეგისტრაცია Approved (approvalSource COLLECTION), ინკასო იყინება', async ({ request }) => {
    await col(request).lienApprovesRegistration('submitted', { balance: 1, lien: 0.5 });
  });

  test('რეგისტრაცია Not submitted → მოდის ინკასო 0.5 ₾ → რეგისტრაცია Approved (approvalSource COLLECTION), ინკასო იყინება', async ({ request }) => {
    await col(request).lienApprovesRegistration('notSubmitted', { balance: 1, lien: 0.5 });
  });

  test('ბიზნესს 2 wallet: A 0.3 ₾, B 0.6 ₾ → ინკასო 0.5 ₾ → იყინება მხოლოდ B (ჯერ ყველაზე დიდი ბალანსი)', async ({ request }) => {
    await col(request).twoWallets({ a: 0.3, b: 0.6, lien: 0.5, expectHeld: [0, 0.5] });
  });

  test('ბიზნესს 2 wallet: A 0.3 ₾, B 0.6 ₾ → ინკასო 1 ₾ (ჯამზე მეტი) → ორივე მთლიანად იყინება, აკლია 0.1 (Partially restricted)', async ({ request }) => {
    await col(request).twoWallets({ a: 0.3, b: 0.6, lien: 1, expectHeld: [0.3, 0.6] });
  });

  test('wallet A 0.5 ₾, ინკასო 1 ₾ (A მთლიანად გაყინულია) → ემატება B (1 ₾) → A ვერ გადარიცხავს 0.3-ს → ადმინი: Reallocate → იყინება B, A თავისუფლდება', async ({ request }) => {
    await col(request).secondWalletAfterLien({ a: 0.5, b: 1, lien: 1, transfer: 0.3, reallocate: 'admin' });
  });

  test('wallet-ს მხოლოდ დოლარი აქვს (1 $) → ინკასო 0.5 ₾ → არაფერი იყინება, Pending (ინკასო მხოლოდ ლარს ეხება)', async ({ request }) => {
    await col(request).otherCurrency('usdOnly', { gel: 0, usd: 1, lien: 0.5 });
  });

  test('wallet შეუზღუდავი ბალანსით (unlimited) → ინკასო 0.5 ₾ → არაფერი იყინება, Pending ("can\'t hold")', async ({ request }) => {
    await col(request).unlimitedWallet({ lien: 0.5 });
  });

  test('ინკასოს დროს wallet-ს გამორთავენ (status false) → გაყინული ფული გაყინული რჩება', async ({ request }) => {
    await col(request).deactivatedWalletKeepsHold({ balance: 1, lien: 0.5 });
  });

  test('ინკასოს დროს ადმინი ცვლის ბიზნესის ალტ. პირად ნომერს (RS-ს არ ეგზავნება) → ინკასო და გაყინული ფული ადგილზე რჩება', async ({ request }) => {
    await col(request).businessEditKeepsLien({ balance: 1, lien: 0.5 });
  });

  test('wallet გადარიცხავს მთელ ბალანსს (0.3 ₾) ზუსტად ინკასოს მოსვლისას → ან გადარიცხვა უარყოფილია, ან გასაყინი აღარაფერია; გაყინული ≤ ბალანსი', async ({ request }) => {
    await col(request).raceTransferAndLien({ balance: 0.3, lien: 0.3 });
  });

  test('COL-13: მესამე პირის ინკასო (kind 3) → ფული თავისით არ იყინება ("needs a manual decision") → ადმინი: Start enforcement → იყინება 0.5', async ({ request }) => {
    await new RsCollectionHelper(request).thirdPerson({ balance: 1, amount: 0.5 });
  });
});

test.describe('ინკასო — ✅ Request amount და ხელით გადახდა (MANUAL)', () => {
  test.describe.configure({ timeout: 420_000 });

  test('COL-15: wallet-ზე 0.5 ₾ → ინკასო 0.1 ₾ → იყინება → ადმინი: Request amount → RS პასუხობს 0.1 ₾ (ავტომატური გადარიცხვა არ ხდება, MANUAL_PAYMENT_NEEDED) → ადმინი აფიქსირებს ხელით გადახდას → ინკასო EXECUTED, wallet 0.4 ₾, გაყინული 0', async ({ request }) => {
    await new RsCollectionHelper(request).manualPayment({ balance: 0.5, amount: 0.1 });
  });

  test('COL-18: ნაწილობრივი გადახდა — wallet-ზე 0.12 ₾, ინკასო 0.15 ₾ (Partially restricted) → RS პასუხობს 0.15 → ადმინი აფიქსირებს 0.13-ს (გაყინულზე მეტი) → უარი 7032 → აფიქსირებს 0.07-ს → Partially executed, ვალი 0.08, wallet-ზე 0.05 ისევ გაყინულია', async ({ request }) => {
    await new RsCollectionHelper(request).partialManualPayment({ balance: 0.12, amount: 0.15, over: 0.13, pay: 0.07 });
  });

  test('COL-05: RS პასუხობს ნაკლებს (0.08 ინკასოდან 0.1) → ადმინი აფიქსირებს 0.08-ს → Partially executed, ვალი 0.02', async ({ request }) => {
    await new RsCollectionHelper(request).rsAnswers({ balance: 0.5, amount: 0.1, answer: 0.08 });
  });

  test('RS ხსნის ინკასოს (ObtainCollection) ხელით გადახდის ჩამოჭრისას → მოხსნა მიიღება, ჩამოჭრა სრულდება (wallet 0.4), ინკასო Withdrawn, ფული აღარ არის გაყინული', async ({ request }) => {
    await new RsCollectionHelper(request).withdrawDuringSettlement({ balance: 0.5, amount: 0.1 });
  });

  test('COL-06: RS პასუხობს 0 → execution NO_AMOUNT, ინკასო ისევ გაყინულია, გადახდის დაფიქსირება → 7031, არაფერი ჩამოიჭრა', async ({ request }) => {
    await new RsCollectionHelper(request).rsAnswers({ balance: 0.5, amount: 0.1, answer: 0 });
  });
});
