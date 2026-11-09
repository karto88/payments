import { test } from '@playwright/test';
import { BankAccountsHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// ⚠️ PROD — Bank Accounts (Open Banking) — ადმინ პანელი (dashboard.keepz.me / newadmin.keepz.me)
// იგივე ტესტები რაც tests/Positive/bank-accounts.spec.ts — განსხვავება მხოლოდ URL (dev-ის გარეშე) და PROD_ADMIN_* credentials
// გაშვება NO_PUSH=1-ით (report public-ია, prod-ის IBAN / ბალანსი არ უნდა გავიდეს)
// 1. დაკავშირება (BOG) → 2. consent-ები / refresh → 3. ტრანზაქციები + დეტალები → 4. ფილტრები / ძიება / პაგინაცია
// 2–4 ტესტებს valid consent სჭირდება (ჯერ 1-ლი ტესტი)

const today = new Date().toLocaleDateString('sv-SE');
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE');

// ─── დაკავშირება ───

test('PROD - Bank Accounts — BOG-ის დაკავშირება (Connect bank → finalise)', async ({ request }) => {
  await new BankAccountsHelper(request, 'prod').connectBank('BOG', 'QA BOG test');
});

// ─── consent-ები ───

test('PROD - Bank Accounts — consent-ების სია (ანგარიშები, ბალანსი, ლიმიტი)', async ({ request }) => {
  await new BankAccountsHelper(request, 'prod').checkConsentList();
});

test('PROD - Bank Accounts — ბალანსის განახლება (refresh)', async ({ request }) => {
  await new BankAccountsHelper(request, 'prod').checkRefresh();
});

// ─── ტრანზაქციები ───

test('PROD - Bank Accounts — ტრანზაქციების სია (ჯერ უახლესი)', async ({ request }) => {
  await new BankAccountsHelper(request, 'prod').checkTransactions();
});

test('PROD - Bank Accounts — ტრანზაქციის დეტალები (ბანკის სრული პასუხი)', async ({ request }) => {
  await new BankAccountsHelper(request, 'prod').checkTransactionDetails();
});

// ─── ფილტრები ───

test('PROD - Bank Accounts — ფილტრი: ბანკი', async ({ request }) => {
  const helper = new BankAccountsHelper(request, 'prod');
  const { providerId } = await helper.sampleTransaction();
  await helper.checkFilter('ბანკი', { providerId }, (t) => t.providerId === providerId);
});

test('PROD - Bank Accounts — ფილტრი: ანგარიში (ბანკის გარეშე)', async ({ request }) => {
  const helper = new BankAccountsHelper(request, 'prod');
  const { accountId } = await helper.sampleTransaction();
  await helper.checkFilter('ანგარიში', { accountId }, (t) => t.accountId === accountId);
});

test('PROD - Bank Accounts — ფილტრი: IBAN (ბანკის გარეშე)', async ({ request }) => {
  const helper = new BankAccountsHelper(request, 'prod');
  const { accountIban } = await helper.sampleTransaction();
  await helper.checkFilter('IBAN', { iban: accountIban }, (t) => t.accountIban === accountIban);
});

test('PROD - Bank Accounts — ფილტრი: თარიღები (ბოლო 7 დღე)', async ({ request }) => {
  const dateFrom = daysAgo(7);
  await new BankAccountsHelper(request, 'prod').checkFilter('თარიღები', { dateFrom, dateTo: today },
    (t) => t.bookingDate.slice(0, 10) >= dateFrom && t.bookingDate.slice(0, 10) <= today);
});

// ─── ძიება ───

test('PROD - Bank Accounts — ძიება: Transaction ID (ნაწილობრივი)', async ({ request }) => {
  const helper = new BankAccountsHelper(request, 'prod');
  const part = (await helper.sampleTransaction()).transactionId.slice(2, 8);
  await helper.checkFilter('Transaction ID', { transactionId: part }, (t) => t.transactionId.includes(part));
});

test('PROD - Bank Accounts — ძიება: Recipient IBAN (ნაწილობრივი)', async ({ request }) => {
  const helper = new BankAccountsHelper(request, 'prod');
  const sample = await helper.sampleTransaction();
  const part = (sample.creditorIban || sample.debtorIban).slice(4, 12);
  await helper.checkFilter('Recipient IBAN', { counterpartyIban: part },
    (t) => `${t.creditorIban || ''}${t.debtorIban || ''}`.includes(part));
});

test('PROD - Bank Accounts — ფილტრი + ძიება ერთად (ბანკი + თარიღები + Transaction ID)', async ({ request }) => {
  const helper = new BankAccountsHelper(request, 'prod');
  const sample = await helper.sampleTransaction();
  const part = sample.transactionId.slice(2, 8);
  const dateFrom = daysAgo(90);
  await helper.checkFilter('ფილტრი + ძიება', { providerId: sample.providerId, dateFrom, dateTo: today, transactionId: part },
    (t) => t.providerId === sample.providerId && t.transactionId.includes(part) && t.bookingDate.slice(0, 10) >= dateFrom);
});

// ─── პაგინაცია ───

test('PROD - Bank Accounts — პაგინაცია (size 10)', async ({ request }) => {
  await new BankAccountsHelper(request, 'prod').checkPagination(10);
});
