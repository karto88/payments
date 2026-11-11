import { test } from '@playwright/test';
import { RsFrontManualPaymentHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — Record manual payment, ნეგატიური: ფორმის ვალიდაცია (ბექზე არაფერი იგზავნება), ჩაწერა პასუხამდე / მეორედ
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾

const helper = (page: any, request: any) => new RsFrontManualPaymentHelper(page, request);

test.describe('RS ფრონტი — Record manual payment (ნეგატიური)', () => {
  test.describe.configure({ timeout: 360_000 });

  test('UI: Request amount-მდე — TODAY "Not asked today…", "Record manual payment" არ ჩანს → API-ით ჩაწერა → 409 / 7031, არაფერი ჩამოიჭრა', async ({ page, request }) => {
    await helper(page, request).recordBeforeRequest({ balance: 0.5, amount: 0.3 });
  });

  test('UI: ფორმა ცარიელი (Amount, Paid at, Bank reference) → Record → სამივესთან "Field is required", არაფერი იგზავნება', async ({ page, request }) => {
    await helper(page, request).formRejects({ balance: 0.5, amount: 0.3, input: { amount: '', paidAt: '', bankReference: '' }, error: ['Field is required', 'Field is required', 'Field is required'], why: 'სავალდებულო ველები ცარიელია' });
  });

  test('UI: Bank reference ცარიელი → "Field is required", არაფერი იგზავნება', async ({ page, request }) => {
    await helper(page, request).formRejects({ balance: 0.5, amount: 0.3, input: { bankReference: '' }, error: 'Field is required', why: 'Bank reference სავალდებულოა' });
  });

  test('UI: Amount paid 0.31 (RS asks 0.3, ზედა ზღვარი +0.01) → "Must be at most 0.3", არაფერი იგზავნება', async ({ page, request }) => {
    await helper(page, request).formRejects({ balance: 0.5, amount: 0.3, input: { amount: '0.31', bankReference: 'QA-NEG' }, error: 'Must be at most 0.3', why: 'RS-ის პასუხზე მეტი' });
  });

  test('UI: Amount paid 0 (ქვედა ზღვარი) → "Must be more than 0", არაფერი იგზავნება', async ({ page, request }) => {
    await helper(page, request).formRejects({ balance: 0.5, amount: 0.3, input: { amount: '0', bankReference: 'QA-NEG' }, error: 'Must be more than 0', why: 'თანხა 0' });
  });

  test('UI: Amount paid — აკრეფა "-0.1" → მინუსი არ იწერება, ველში "0.1" (უარყოფითს ვერ ჩაწერ)', async ({ page, request }) => {
    await helper(page, request).amountMask({ balance: 0.5, amount: 0.3, typed: '-0.1', kept: '0.1' });
  });

  test('UI: Amount paid — აკრეფა "abc" → ასოები არ იწერება, ველი ცარიელი → Record → "Field is required", არაფერი იგზავნება', async ({ page, request }) => {
    await helper(page, request).formRejects({ balance: 0.5, amount: 0.3, input: { amount: 'abc', bankReference: 'QA-NEG' }, error: 'Field is required', why: 'ასოები არ იწერება — თანხა ცარიელია' });
  });

  test('UI: Paid at — 3 საათით მომავალში → ბრაუზერი ბლოკავს "Value must be … or earlier.", არაფერი იგზავნება', async ({ page, request }) => {
    await helper(page, request).formRejects({ balance: 0.5, amount: 0.3, input: { paidAt: RsFrontManualPaymentHelper.paidAt(3), bankReference: 'QA-NEG' }, error: /or earlier/, why: 'გადახდა მომავალში' });
  });

  test('UI: ჩაწერა 0.3 → "Record manual payment" ქრება → API-ით იგივე პასუხზე მეორედ → 409 / 7031, მეორედ არ ჩამოიჭრა', async ({ page, request }) => {
    await helper(page, request).recordOnlyOnce({ balance: 0.5, amount: 0.3, pay: 0.3 });
  });
});
