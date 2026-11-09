import { test } from '@playwright/test';
import { BankAccountsHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// Bank Accounts (Open Banking) — ადმინ პანელი (KD-2438 BE / KD-2439 FE)
// 1. დაკავშირება (BOG / TBC / Liberty) + ბანკში უარი
// 2. ყოველი ბანკი: consent, refresh, ლიმიტი, უახლესი ტრანზაქციები, დეტალები
// 3. ჩანაცვლება / გათიშვა: იგივე ანგარიშის ხელახლა დამატება, წაშლა → ისევ დამატება
// 4. ძიება (Transaction ID / Counterparty IBAN), ფილტრები, პაგინაცია
// 5. ნეგატიური (API)
// 2–4 ტესტებს valid consent სჭირდება (ჯერ დაკავშირების ტესტები). OTP: BOG/TBC/Liberty — Gmail-იდან

const today = new Date().toLocaleDateString('sv-SE');
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE');

// ─── 1. დაკავშირება ───

test('Bank Accounts — BOG-ის დაკავშირება (Connect bank → finalise)', async ({ request }) => {
  await new BankAccountsHelper(request).connectBank('BOG', 'QA BOG test');
});

test('Bank Accounts — TBC-ის დაკავშირება (Connect bank → finalise)', async ({ request }) => {
  await new BankAccountsHelper(request).connectBank('TBC', 'QA TBC test');
});

test('Bank Accounts — Liberty-ის დაკავშირება (Connect bank → finalise)', async ({ request }) => {
  await new BankAccountsHelper(request).connectBank('LIBERTY', 'QA Liberty test');
});

test('Bank Accounts — სამივე ბანკი სიაში (valid + ანგარიშები)', async ({ request }) => {
  await new BankAccountsHelper(request).checkAllBanksConnected(['BOG', 'TBC', 'LIBERTY']);
});

test('Bank Accounts — BOG: Private connection — მხოლოდ შემქმნელი ხედავს, მეორე ადმინი ვერა (shared-ს ხედავს)', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  await helper.connectBank('BOG', 'QA BOG private', { private: true });
  await helper.checkPrivateVisibility('QA BOG private');
});

test('Bank Accounts — TBC: ბანკში უარი ("არ ვეთანხმები") → error toast, consent არ ემატება', async ({ request }) => {
  await new BankAccountsHelper(request).cancelAtBank('TBC', 'QA TBC cancel');
});

// ─── 2. BOG ───

test('Bank Accounts — BOG: consent (ანგარიშები, ბალანსი, ლიმიტი)', async ({ request }) => {
  await new BankAccountsHelper(request).checkConsentList('BOG');
});

test('Bank Accounts — BOG: ბალანსის განახლება (refresh)', async ({ request }) => {
  await new BankAccountsHelper(request).checkRefresh('BOG');
});

test('Bank Accounts — BOG: ლიმიტის ამოწურვის შემდეგ refresh უარყოფილია', async ({ request }) => {
  await new BankAccountsHelper(request).checkRefreshLimit('BOG');
});

test('Bank Accounts — BOG: უახლესი ტრანზაქციები', async ({ request }) => {
  await new BankAccountsHelper(request).checkBankTransactions('BOG');
});

test('Bank Accounts — BOG: ტრანზაქციის დეტალები', async ({ request }) => {
  await new BankAccountsHelper(request).checkTransactionDetails('BOG');
});

// ─── 2. TBC ───

test('Bank Accounts — TBC: consent (ანგარიშები, ბალანსი, ლიმიტი)', async ({ request }) => {
  await new BankAccountsHelper(request).checkConsentList('TBC');
});

test('Bank Accounts — TBC: ბალანსის განახლება (refresh)', async ({ request }) => {
  await new BankAccountsHelper(request).checkRefresh('TBC');
});

test('Bank Accounts — TBC: ლიმიტის ამოწურვის შემდეგ refresh უარყოფილია', async ({ request }) => {
  await new BankAccountsHelper(request).checkRefreshLimit('TBC');
});

test('Bank Accounts — TBC: უახლესი ტრანზაქციები', async ({ request }) => {
  await new BankAccountsHelper(request).checkBankTransactions('TBC');
});

test('Bank Accounts — TBC: ტრანზაქციის დეტალები', async ({ request }) => {
  await new BankAccountsHelper(request).checkTransactionDetails('TBC');
});

// ─── 2. Liberty ───

test('Bank Accounts — Liberty: consent (ანგარიშები, ბალანსი, ლიმიტი)', async ({ request }) => {
  await new BankAccountsHelper(request).checkConsentList('LIBERTY');
});

test('Bank Accounts — Liberty: ბალანსის განახლება (refresh)', async ({ request }) => {
  await new BankAccountsHelper(request).checkRefresh('LIBERTY');
});

test('Bank Accounts — Liberty: ლიმიტის ამოწურვის შემდეგ refresh უარყოფილია', async ({ request }) => {
  await new BankAccountsHelper(request).checkRefreshLimit('LIBERTY');
});

test('Bank Accounts — Liberty: უახლესი ტრანზაქციები', async ({ request }) => {
  await new BankAccountsHelper(request).checkBankTransactions('LIBERTY');
});

test('Bank Accounts — Liberty: ტრანზაქციის დეტალები', async ({ request }) => {
  await new BankAccountsHelper(request).checkTransactionDetails('LIBERTY');
});

// ─── 3. ჩანაცვლება / გათიშვა ───

test('Bank Accounts — TBC: იგივე ანგარიშის ხელახლა დამატება → ძველი ქრება, ტრანზაქციები არ ორმაგდება', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  await helper.connectBank('TBC', 'QA TBC test');
  await helper.checkReplaced('TBC');
});

test('Bank Accounts — TBC: წაშლა (Disconnect) → ბარათი და ტრანზაქციები ქრება', async ({ request }) => {
  await new BankAccountsHelper(request).disconnect('TBC');
});

test('Bank Accounts — TBC: წაშლის შემდეგ იგივე ანგარიშის ისევ დამატება', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  await helper.connectBank('TBC', 'QA TBC test');
  await helper.checkReplaced('TBC');
});

test('Bank Accounts — ტრანზაქციები არ მეორდება (ყველა ბანკი)', async ({ request }) => {
  await new BankAccountsHelper(request).checkNoDuplicateTransactions();
});

// ─── 4. ძიება ───

test('Bank Accounts — ძიება: Transaction ID სრული (ერთი ტრანზაქცია, ერთხელ)', async ({ request }) => {
  await new BankAccountsHelper(request).checkSearchTransactionIdExact('TBC');
});

test('Bank Accounts — ძიება: Transaction ID ნაწილობრივი', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  const part = (await helper.sampleTransaction()).transactionId.slice(2, 8);
  await helper.checkFilter('Transaction ID', { transactionId: part }, (t) => t.transactionId.includes(part));
});

test('Bank Accounts — ძიება: Transaction ID არარსებული → ცარიელი სია', async ({ request }) => {
  await new BankAccountsHelper(request).checkSearchNotFound({ transactionId: 'QA-NOT-EXISTS-000' });
});

test('Bank Accounts — ძიება: Counterparty IBAN სრული', async ({ request }) => {
  await new BankAccountsHelper(request).checkSearchCounterpartyIban('TBC', false);
});

test('Bank Accounts — ძიება: Counterparty IBAN ნაწილობრივი (GE-ის გარეშე)', async ({ request }) => {
  await new BankAccountsHelper(request).checkSearchCounterpartyIban('TBC', true);
});

test('Bank Accounts — ძიება: Counterparty IBAN არარსებული → ცარიელი სია', async ({ request }) => {
  await new BankAccountsHelper(request).checkSearchNotFound({ counterpartyIban: 'GE00XX0000000000000000' });
});

// ─── 4. ფილტრები ───

test('Bank Accounts — ფილტრი: ბანკი', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  const { providerId } = await helper.sampleTransaction();
  await helper.checkFilter('ბანკი', { providerId }, (t) => t.providerId === providerId);
});

test('Bank Accounts — ფილტრი: ანგარიში (ბანკის გარეშე)', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  const { accountId } = await helper.sampleTransaction();
  await helper.checkFilter('ანგარიში', { accountId }, (t) => t.accountId === accountId);
});

test('Bank Accounts — ფილტრი: IBAN (ბანკის გარეშე)', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  const { accountIban } = await helper.sampleTransaction();
  await helper.checkFilter('IBAN', { iban: accountIban }, (t) => t.accountIban === accountIban);
});

test('Bank Accounts — ფილტრი: თარიღები (ბოლო 7 დღე)', async ({ request }) => {
  const dateFrom = daysAgo(7);
  await new BankAccountsHelper(request).checkFilter('თარიღები', { dateFrom, dateTo: today },
    (t) => t.bookingDate.slice(0, 10) >= dateFrom && t.bookingDate.slice(0, 10) <= today);
});

test('Bank Accounts — ფილტრი + ძიება ერთად (ბანკი + თარიღები + Transaction ID)', async ({ request }) => {
  const helper = new BankAccountsHelper(request);
  const sample = await helper.sampleTransaction();
  const part = sample.transactionId.slice(2, 8);
  const dateFrom = daysAgo(90);
  await helper.checkFilter('ფილტრი + ძიება', { providerId: sample.providerId, dateFrom, dateTo: today, transactionId: part },
    (t) => t.providerId === sample.providerId && t.transactionId.includes(part) && t.bookingDate.slice(0, 10) >= dateFrom);
});

test('Bank Accounts — ტრანზაქციების სია (ჯერ უახლესი)', async ({ request }) => {
  await new BankAccountsHelper(request).checkTransactions();
});

test('Bank Accounts — პაგინაცია (size 10)', async ({ request }) => {
  await new BankAccountsHelper(request).checkPagination(10);
});

// ─── 5. ნეგატიური (API) ───

test('Bank Accounts — token-ის გარეშე → 401/403', async ({ request }) => {
  await new BankAccountsHelper(request).checkNoToken();
});

test('Bank Accounts — არარსებული consent: გათიშვა / refresh / დეტალები → 4xx', async ({ request }) => {
  await new BankAccountsHelper(request).checkUnknownConsent();
});
