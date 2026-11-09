import { test } from '@playwright/test';
import { RsRegistrationHelper } from '../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS რეგისტრაცია — ნეგატიური (მდგომარეობის გადასვლები, wallet-ის უნიკალურობა, ჩაკეტილი ველები, თარიღები)
// 🐞 მონიშნული ტესტები ჩავარდება, სანამ ბაგი არ გასწორდება (docs/RS-BUGS.md)

// ─── wallet / ident ───

test('RS Registration Negative — უკვე მიბმული wallet სხვა ident-ით → 409 / 7021', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('walletOtherIdent', { http: 409, code: 7021 });
});

test('RS Registration Negative — იგივე ident wallet-ის გარეშე (ღია რეგისტრაცია არსებობს) → 409 / 7011', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('sameIdentNoWallet', { http: 409, code: 7011 });
});

// ─── სტატუსები ───

test('RS Registration Negative — submit ორჯერ → 409 / 7011', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('submitTwice', { http: 409, code: 7011 });
});

test('RS Registration Negative — Submit changes, არაფერი შეცვლილა → 409 / 7011', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('submitChangesNothing', { http: 409, code: 7011 });
});

// ─── residency ჩაკეტილია RS-ში გაგზავნის შემდეგ ───

test('RS Registration Negative — Approved: residency → FOREIGN → 409 / 7012', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('residencyAfterSubmit', { http: 409, code: 7012 });
});

test('RS Registration Negative — Edit business: residency → FOREIGN (Approved) → 409 / 1483', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('businessResidencyAfterSubmit', { http: 409, code: 1483 });
});

test('RS Registration Negative — Edit business დაკავებული ident-ით → 1481, რეგისტრაცია უცვლელი 🐞', async ({ request }) => {
  await new RsRegistrationHelper(request).businessTakenIdentKeepsRegistration();
});

// ─── Cancel ───

test('RS Registration Negative — Cancel დადასტურება "yes" (არა "delete") → 400 / 7015', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('cancelWrongConfirmation', { http: 400, code: 7015 });
});

test('RS Registration Negative — Cancel ორჯერ → 409 / 7011', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('cancelTwice', { http: 409, code: 7011 });
});

test('RS Registration Negative — გაუქმებულის რედაქტირება → 409 / 7011', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('editCancelled', { http: 409, code: 7011 });
});

// ─── თარიღები (docs: Operation date — not in the future) ───

test('RS Registration Negative — operDate მომავალში (+30 დღე) → 400 / 7010 🐞', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('futureOperDate', { http: 400, code: 7010 });
});

test('RS Business Negative — operDate მომავალში (+30 დღე) → 400 / 1480 🐞', async ({ request }) => {
  await new RsRegistrationHelper(request).rejected('businessFutureOperDate', { http: 400, code: 1480 });
});
