import { test } from '@playwright/test';
import { RsNegativeHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS — Business ნეგატიური ქეისები — ადმინ პანელი → Distributor Hub (KD-2237 / KD-2239)
// ტექნიკები: ზღვრული მნიშვნელობები (9/11 ციფრი ±1, 25/100/250 სიმბოლო +1), ეკვივალენტური კლასები
// (აკლია / ცარიელი / ასოები / არასწორი ფორმატი / არავალიდური enum), დუბლიკატი, optimistic lock (version).
// ყოველ ქეისში: მოსალოდნელი HTTP + code (+ errors[] ველი) და უარყოფილი ბიზნესი არ შეინახა.
// 🐞 — ბაგი (2026-11-05 შემოწმებით API მიიღებს / 500 აბრუნებს) — ტესტი ჩავარდება, სანამ არ გასწორდება.

// ─── 1. identificationNumber (RESIDENT: 9 ან 11 ციფრი) ───

test('RS Business Negative — RESIDENT ident 8 ციფრი (9-ის ქვედა ზღვარი −1) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { identificationNumber: '12345678' },
    { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — RESIDENT ident 10 ციფრი (9 და 11 შორის) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { identificationNumber: '1234567890' },
    { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — RESIDENT ident 12 ციფრი (11-ის ზედა ზღვარი +1) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { identificationNumber: '123456789012' },
    { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — RESIDENT ident ასოებით (9 სიმბოლო) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { identificationNumber: '12345678a' },
    { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — RESIDENT ident space-ით (9 სიმბოლო) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { identificationNumber: '1234 5678' },
    { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — RESIDENT ident აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { identificationNumber: undefined },
    { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — RESIDENT ident ცარიელი "" → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { identificationNumber: '' },
    { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — ident დაკავებულია (შექმნა) → 409 / 1481', async ({ request }) => {
  await new RsNegativeHelper(request).duplicateIdentRejected('create');
});

test('RS Business Negative — ident დაკავებულია (სხვა ბიზნესის რედაქტირება) → 409 / 1481', async ({ request }) => {
  await new RsNegativeHelper(request).duplicateIdentRejected('update');
});

test('RS Business Negative — FOREIGN ident 26 სიმბოლო (25-ის ზედა ზღვარი +1) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { identificationNumber: 'F'.repeat(26) },
    { http: 400, code: 1001, field: 'identificationNumber' });
});

// ─── 2. personalNumberAlt (9 ან 11 ციფრი) ───

test('RS Business Negative — personalNumberAlt 8 ციფრი → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { personalNumberAlt: '12345678' },
    { http: 400, code: 1480, field: 'personalNumberAlt' });
});

test('RS Business Negative — personalNumberAlt 10 ციფრი → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { personalNumberAlt: '1234567890' },
    { http: 400, code: 1480, field: 'personalNumberAlt' });
});

// 12 ციფრზე code 1001 მოდის (სიგრძის შემოწმება), 8/10-ზე — 1480; ორივე 400-ია
test('RS Business Negative — personalNumberAlt 12 ციფრი → 400', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { personalNumberAlt: '123456789012' },
    { http: 400, field: 'personalNumberAlt' });
});

// ─── 3. ownerFullName (სავალდებულო, max 250) ───

test('RS Business Negative — ownerFullName აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { ownerFullName: undefined },
    { http: 400, code: 1480, field: 'ownerFullName' });
});

test('RS Business Negative — ownerFullName მხოლოდ space-ები → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { ownerFullName: '   ' },
    { http: 400, code: 1480, field: 'ownerFullName' });
});

test('RS Business Negative — ownerFullName მხოლოდ tab / newline → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { ownerFullName: ' \t\n ' },
    { http: 400, code: 1480, field: 'ownerFullName' });
});

// 🐞 200 — უხილავი სიმბოლოებით (non-breaking space) სახელი ცარიელად ჩანს, მაგრამ ინახება
test('RS Business Negative — ownerFullName მხოლოდ non-breaking space (\\u00A0) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { ownerFullName: '   ' },
    { http: 400, code: 1480, field: 'ownerFullName' });
});

// 🐞 200 — zero-width space: სახელი საერთოდ არ ჩანს, მაგრამ ინახება
test('RS Business Negative — ownerFullName მხოლოდ zero-width space (\\u200B) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { ownerFullName: '​​​' },
    { http: 400, code: 1480, field: 'ownerFullName' });
});

test('RS Business Negative — ownerFullName 251 სიმბოლო (250 +1) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { ownerFullName: 'Q'.repeat(251) },
    { http: 400, code: 1001, field: 'ownerFullName' });
});

// ─── 4. თარიღები და residency ───

test('RS Business Negative — operDate აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { operDate: undefined },
    { http: 400, code: 1480, field: 'operDate' });
});

test('RS Business Negative — operDate არასწორი ფორმატი 05.11.2026 → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { operDate: '05.11.2026' },
    { http: 400, code: 1003 });
});

test('RS Business Negative — operDate არარსებული თარიღი 2026-02-30 → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { operDate: '2026-02-30' },
    { http: 400, code: 1003 });
});

test('RS Business Negative — RESIDENT knownDate აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { knownDate: undefined },
    { http: 400, code: 1480, field: 'knownDate' });
});

test('RS Business Negative — residency აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { residency: undefined },
    { http: 400, code: 1480, field: 'residency' });
});

test('RS Business Negative — residency არავალიდური ALIEN → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('RESIDENT', { residency: 'ALIEN' },
    { http: 400, code: 1003 });
});

// ─── 5. FOREIGN — სავალდებულო მისამართები და სიგრძეები ───

test('RS Business Negative — FOREIGN legalAddressCountry აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { legalAddressCountry: undefined },
    { http: 400, code: 1480, field: 'legalAddressCountry' });
});

test('RS Business Negative — FOREIGN legalAddressCity აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { legalAddressCity: undefined },
    { http: 400, code: 1480, field: 'legalAddressCity' });
});

test('RS Business Negative — FOREIGN legalAddressLine აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { legalAddressLine: undefined },
    { http: 400, code: 1480, field: 'legalAddressLine' });
});

test('RS Business Negative — FOREIGN actualAddressCountry აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { actualAddressCountry: undefined },
    { http: 400, code: 1480, field: 'actualAddressCountry' });
});

test('RS Business Negative — FOREIGN actualAddressCity აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { actualAddressCity: undefined },
    { http: 400, code: 1480, field: 'actualAddressCity' });
});

test('RS Business Negative — FOREIGN actualAddressLine აკლია → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { actualAddressLine: undefined },
    { http: 400, code: 1480, field: 'actualAddressLine' });
});

test('RS Business Negative — FOREIGN legalAddressCountry 101 სიმბოლო (100 +1) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { legalAddressCountry: 'C'.repeat(101) },
    { http: 400, code: 1001, field: 'legalAddressCountry' });
});

test('RS Business Negative — FOREIGN legalAddressLine 251 სიმბოლო (250 +1) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { legalAddressLine: 'L'.repeat(251) },
    { http: 400, code: 1001, field: 'legalAddressLine' });
});

test('RS Business Negative — FOREIGN stateRegAuthority 251 სიმბოლო (250 +1) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createBusinessRejected('FOREIGN', { stateRegAuthority: 'S'.repeat(251) },
    { http: 400, code: 1001, field: 'stateRegAuthority' });
});

// ─── 6. რედაქტირება (PUT + version) ───

test('RS Business Negative — რედაქტირება ძველი version-ით → 409 / 1482', async ({ request }) => {
  await new RsNegativeHelper(request).updateBusinessRejected('staleVersion', { http: 409, code: 1482 });
});

test('RS Business Negative — რედაქტირება version-ის გარეშე → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).updateBusinessRejected('noVersion', { http: 400, code: 1001, field: 'version' });
});

test('RS Business Negative — რედაქტირება არავალიდური ident-ით (8 ციფრი) → 1480', async ({ request }) => {
  await new RsNegativeHelper(request).updateBusinessRejected('invalidIdent', { http: 400, code: 1480, field: 'identificationNumber' });
});

test('RS Business Negative — არარსებული ბიზნესის რედაქტირება → 404 / 1479', async ({ request }) => {
  await new RsNegativeHelper(request).updateBusinessRejected('unknownBusiness', { http: 404, code: 1479 });
});

// ─── 7. GET / filter ───

test('RS Business Negative — GET არარსებული id → 404 / 1479', async ({ request }) => {
  await new RsNegativeHelper(request).getBusinessRejected('00000000-0000-0000-0000-000000000000', { http: 404, code: 1479 });
});

test('RS Business Negative — GET არავალიდური uuid → 400 / 1002', async ({ request }) => {
  await new RsNegativeHelper(request).getBusinessRejected('abc', { http: 400, code: 1002 });
});

test('RS Business Negative — filter residency არავალიდური → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).filterBusinessesRejected({ residency: 'ALIEN' }, { http: 400, code: 1001 });
});

test('RS Business Negative — filter pageSize ტექსტი "abc" → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).filterBusinessesRejected({ pageSize: 'abc' }, { http: 400, code: 1001 });
});

// 🐞 name="%" ყველა ბიზნესს აბრუნებს — % SQL wildcard-ად მუშაობს, ტექსტად არ არის escape-ებული
test('RS Business Negative — filter name "%" → მხოლოდ სახელები "%"-ით', async ({ request }) => {
  await new RsNegativeHelper(request).filterNameWildcardLiteral('%');
});

// 🐞 500 მოდის (An unexpected error occurred) — ვალიდაციის ერორი უნდა იყოს
test('RS Business Negative — filter pageSize 0 (ქვედა ზღვარი) → 400', async ({ request }) => {
  await new RsNegativeHelper(request).filterBusinessesRejected({ pageIndex: 1, pageSize: 0 }, { http: 400 });
});

// 🐞 500 მოდის (An unexpected error occurred) — ვალიდაციის ერორი უნდა იყოს
test('RS Business Negative — filter pageSize -1 → 400', async ({ request }) => {
  await new RsNegativeHelper(request).filterBusinessesRejected({ pageIndex: 1, pageSize: -1 }, { http: 400 });
});
