import { test } from '@playwright/test';
import { RsNegativeHelper } from '../../../utils/order-helpers';
import { gel, currencyConfig } from '../../../utils/order-helpers/RS/RsClientHelper';
import * as dotenv from 'dotenv';

dotenv.config();

// RS — Distributor Hub კლიენტი ნეგატიური ქეისები — ადმინ პანელი (KD-2237 / KD-2239)
// ტექნიკები: ზღვრული მნიშვნელობები (0 / −0.01 / 100% +0.01, min ↔ max), ეკვივალენტური კლასები
// (აკლია / ცარიელი / არავალიდური enum / არარსებული id), დუბლიკატი, მიბმის / მოხსნის / update-ის წესები.
// ყოველ ქეისში: მოსალოდნელი HTTP + code (+ errors[] ველი) და უარყოფილი კლიენტი არ შეინახა / არ შეიცვალა.
// 🐞 — ბაგი (2026-11-05 შემოწმებით API მიიღებს / 500 აბრუნებს) — ტესტი ჩავარდება, სანამ არ გასწორდება.

// ─── 1. scheme / businessId ───

test('RS Client Negative — scheme აკლია → 1488', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ scheme: undefined }, { http: 400, code: 1488, field: 'scheme' });
});

test('RS Client Negative — scheme არავალიდური BANK → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ scheme: 'BANK' }, { http: 400, code: 1003 });
});

test('RS Client Negative — SYSTEM_OPERATOR + businessId → 1484', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ scheme: 'SYSTEM_OPERATOR' },
    { http: 400, code: 1484, field: 'businessId' }, { withBusiness: true });
});

test('RS Client Negative — არარსებული businessId → 404 / 1479', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ businessId: '00000000-0000-0000-0000-000000000000' },
    { http: 404, code: 1479 });
});

test('RS Client Negative — businessId არავალიდური uuid → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ businessId: 'abc' }, { http: 400, code: 1003 });
});

// ─── 2. clientName ───

test('RS Client Negative — clientName აკლია → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ clientName: undefined }, { http: 400, code: 1001, field: 'clientName' });
});

test('RS Client Negative — clientName მხოლოდ space-ები → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ clientName: '   ' }, { http: 400, code: 1001, field: 'clientName' });
});

test('RS Client Negative — clientName მხოლოდ tab / newline → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ clientName: ' \t\n ' }, { http: 400, code: 1001, field: 'clientName' });
});

// 🐞 201 — non-breaking space-ებით სახელი სიაში ცარიელად ჩანს, მაგრამ ინახება
test('RS Client Negative — clientName მხოლოდ non-breaking space (\\u00A0) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ clientName: '   ' }, { http: 400, code: 1001, field: 'clientName' });
});

// 🐞 201 — zero-width space: სახელი საერთოდ არ ჩანს, მაგრამ ინახება
test('RS Client Negative — clientName მხოლოდ zero-width space (\\u200B) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ clientName: '​​​' }, { http: 400, code: 1001, field: 'clientName' });
});

// 🐞 201 — ideographic space (　): business-ზე იბლოკება (1480), client-ზე — არა
test('RS Client Negative — clientName მხოლოდ ideographic space (\\u3000) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ clientName: '　' }, { http: 400, code: 1001, field: 'clientName' });
});

// 🐞 500 მოდის (An unexpected error occurred) — სიგრძის ვალიდაცია არ არის, 400 უნდა იყოს
test('RS Client Negative — clientName 256 სიმბოლო → 400', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ clientName: `QA ${'N'.repeat(253)}` }, { http: 400 });
});

test('RS Client Negative — clientName დაკავებულია (შექმნა) → 1186', async ({ request }) => {
  await new RsNegativeHelper(request).duplicateClientNameRejected('create');
});

test('RS Client Negative — clientName დაკავებულია (სხვა კლიენტის update) → 1186', async ({ request }) => {
  await new RsNegativeHelper(request).duplicateClientNameRejected('update');
});

// 🐞 201 — clientName-ს space-ებს არ აჭრის: "QA Wolf" და "QA Wolf " ორი სხვადასხვა კლიენტი ხდება (ვიზუალურად ერთნაირი)
test('RS Client Negative — clientName = არსებული + ბოლოში space → 1186', async ({ request }) => {
  await new RsNegativeHelper(request).duplicateClientNameWithSpaceRejected();
});

// ─── 3. distributeMethod / distributionStrategy ───

test('RS Client Negative — distributeMethod აკლია → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ distributeMethod: undefined }, { http: 400, code: 1001, field: 'distributeMethod' });
});

test('RS Client Negative — distributeMethod არავალიდური CASH → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ distributeMethod: 'CASH' }, { http: 400, code: 1003 });
});

test('RS Client Negative — distributionStrategy აკლია → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ distributionStrategy: undefined }, { http: 400, code: 1001, field: 'distributionStrategy' });
});

test('RS Client Negative — distributionStrategy არავალიდური FAST → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ distributionStrategy: 'FAST' }, { http: 400, code: 1003 });
});

// ─── 4. currencyConfigs / provider ───

test('RS Client Negative — currencyConfigs აკლია → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: undefined }, { http: 400, code: 1001, field: 'currencyConfigs' });
});

test('RS Client Negative — currencyConfigs ცარიელი {} → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: {} }, { http: 400, code: 1001, field: 'currencyConfigs' });
});

test('RS Client Negative — GEL ცარიელი სია [] → 404 / 1232', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: { GEL: [] } }, { http: 404, code: 1232 });
});

test('RS Client Negative — DEFAULT provider-ის გარეშე (მხოლოდ TBC) → 404 / 1232', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ provider: 'TBC' }) }, { http: 404, code: 1232 });
});

test('RS Client Negative — DEFAULT provider ორჯერ → 404 / 1232', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: { GEL: [currencyConfig(), currencyConfig()] } },
    { http: 404, code: 1232 });
});

test('RS Client Negative — არარსებული ვალუტა XYZ → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: { XYZ: [currencyConfig()] } }, { http: 400, code: 1003 });
});

// ─── 5. ტრანზაქციის ლიმიტები (min / max > 0, min ≤ max) ───

test('RS Client Negative — minTransactionAmount 0 (ქვედა ზღვარი) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ minTransactionAmount: 0 }) },
    { http: 400, code: 1001, field: 'minTransactionAmount' });
});

test('RS Client Negative — minTransactionAmount -0.01 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ minTransactionAmount: -0.01 }) },
    { http: 400, code: 1001, field: 'minTransactionAmount' });
});

test('RS Client Negative — minTransactionAmount აკლია → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ minTransactionAmount: undefined }) },
    { http: 400, code: 1001, field: 'minTransactionAmount' });
});

test('RS Client Negative — maxTransactionAmount 0 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ maxTransactionAmount: 0 }) },
    { http: 400, code: 1001, field: 'maxTransactionAmount' });
});

test('RS Client Negative — maxTransactionAmount -1 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ maxTransactionAmount: -1 }) },
    { http: 400, code: 1001, field: 'maxTransactionAmount' });
});

// 🐞 201 — min 100 > max 10 მიიღო (ასეთ კლიენტზე არც ერთი თანხა არ გაივლის)
test('RS Client Negative — min > max (100 > 10) → 400', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ minTransactionAmount: 100, maxTransactionAmount: 10 }) },
    { http: 400 });
});

// ─── 6. საკომისიო (commission ≥ 0, PERCENTAGE ≤ 100, min ≤ max საკომისიო) ───

test('RS Client Negative — commissionTiers ცარიელი [] → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({ commissionTiers: [] }) },
    { http: 400, code: 1001, field: 'commissionTiers' });
});

test('RS Client Negative — FIXED საკომისიო -1 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { commission: -1, commissionRateType: 'FIXED' }) },
    { http: 400, code: 1001, field: 'commission' });
});

test('RS Client Negative — PERCENTAGE -0.01 (0-ის ქვედა ზღვარი −0.01) → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { commission: -0.01, commissionRateType: 'PERCENTAGE' }) },
    { http: 400, code: 1001, field: 'commission' });
});

// 🐞 201 — 100%-ზე მეტი საკომისიო მიიღო
test('RS Client Negative — PERCENTAGE 100.01 (100-ის ზედა ზღვარი +0.01) → 400', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { commission: 100.01, commissionRateType: 'PERCENTAGE' }) },
    { http: 400 });
});

// 🐞 201 — 1000% საკომისიო მიიღო
test('RS Client Negative — PERCENTAGE 1000 → 400', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { commission: 1000, commissionRateType: 'PERCENTAGE' }) },
    { http: 400 });
});

test('RS Client Negative — commissionRateType არავალიდური → 1003', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { commissionRateType: 'X' }) }, { http: 400, code: 1003 });
});

test('RS Client Negative — startAmount -1 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { startAmount: -1 }) },
    { http: 400, code: 1001, field: 'startAmount' });
});

test('RS Client Negative — minCommissionAmount 0 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { minCommissionAmount: 0 }) },
    { http: 400, code: 1001, field: 'minCommissionAmount' });
});

test('RS Client Negative — maxCommissionAmount 0 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: gel({}, { maxCommissionAmount: 0 }) },
    { http: 400, code: 1001, field: 'maxCommissionAmount' });
});

// 🐞 201 — min საკომისიო 10 > max საკომისიო 1 მიიღო
test('RS Client Negative — minCommissionAmount > maxCommissionAmount (10 > 1) → 400', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected(
    { currencyConfigs: gel({}, { commission: 5, commissionRateType: 'PERCENTAGE', minCommissionAmount: 10, maxCommissionAmount: 1 }) },
    { http: 400 });
});

// 🐞 201 — ორი tier ერთი და იგივე startAmount-ით მიიღო (გაურკვეველია, რომელი იმოქმედებს)
test('RS Client Negative — 2 tier ერთი startAmount-ით (0 და 0) → 400', async ({ request }) => {
  await new RsNegativeHelper(request).createClientRejected({ currencyConfigs: { GEL: [currencyConfig({ commissionTiers: [
    { commission: 1, commissionRateType: 'FIXED', startAmount: 0 },
    { commission: 2, commissionRateType: 'FIXED', startAmount: 0 },
  ] })] } }, { http: 400 });
});

// ─── 7. ბიზნესზე მიბმა / მოხსნა ───

test('RS Client Negative — მიბმა: SYSTEM_OPERATOR კლიენტი → 1484', async ({ request }) => {
  await new RsNegativeHelper(request).linkRejected('systemOperator', { http: 400, code: 1484 });
});

test('RS Client Negative — მიბმა: ცარიელი clientIds [] → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).linkRejected('emptyList', { http: 400, code: 1001, field: 'clientIds' });
});

test('RS Client Negative — მიბმა: clientIds [null] → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).linkRejected('nullId', { http: 400, code: 1001, field: 'clientIds' });
});

test('RS Client Negative — მიბმა: არარსებული კლიენტი → 404 / 1188', async ({ request }) => {
  await new RsNegativeHelper(request).linkRejected('unknownClient', { http: 404, code: 1188 });
});

test('RS Client Negative — მიბმა: არარსებული ბიზნესი → 404 / 1479', async ({ request }) => {
  await new RsNegativeHelper(request).linkRejected('unknownBusiness', { http: 404, code: 1479 });
});

test('RS Client Negative — მიბმა: კლიენტი უკვე სხვა ბიზნესზეა → 409 / 1485', async ({ request }) => {
  await new RsNegativeHelper(request).linkRejected('otherBusiness', { http: 409, code: 1485 });
});

test('RS Client Negative — მოხსნა: კლიენტი ამ ბიზნესზე არ არის → 404 / 1491', async ({ request }) => {
  await new RsNegativeHelper(request).unlinkRejected('notInBusiness', { http: 404, code: 1491 });
});

test('RS Client Negative — მოხსნა: არარსებული ბიზნესი → 404 / 1479', async ({ request }) => {
  await new RsNegativeHelper(request).unlinkRejected('unknownBusiness', { http: 404, code: 1479 });
});

// ─── 8. update (integratorId) / GET ───

test('RS Client Negative — update: scheme-ის შეცვლა WALLET → SYSTEM_OPERATOR → 409 / 1487', async ({ request }) => {
  await new RsNegativeHelper(request).updateClientRejected('changeScheme', { http: 409, code: 1487, field: 'scheme' });
});

test('RS Client Negative — update: სხვა ბიზნესზე გადატანა → 409 / 1485', async ({ request }) => {
  await new RsNegativeHelper(request).updateClientRejected('otherBusiness', { http: 409, code: 1485, field: 'businessId' });
});

// 🐞 500 მოდის (docs-შიც წერია 1000 / 500) — status-ის გარეშე ვალიდაციის ერორი უნდა იყოს
test('RS Client Negative — update: status-ის გარეშე → 400', async ({ request }) => {
  await new RsNegativeHelper(request).updateClientRejected('noStatus', { http: 400 });
});

test('RS Client Negative — update: არარსებული integratorId → 404 / 1188', async ({ request }) => {
  await new RsNegativeHelper(request).updateClientRejected('unknownClient', { http: 404, code: 1188 });
});

// 🐞 201 — update-ითაც 100%-ზე მეტი საკომისიო (500%) შეინახა
test('RS Client Negative — update: PERCENTAGE 500 → 400', async ({ request }) => {
  await new RsNegativeHelper(request).updateClientRejected('percentOver100', { http: 400 });
});

// ─── 9. ბალანსის ცვლილება (PUT client/{id}?amount=) ───

test('RS Client Negative — ბალანსი: amount 0 → 1001', async ({ request }) => {
  await new RsNegativeHelper(request).balanceRejected({ amount: 0, currency: 'GEL' }, { http: 400, code: 1001 });
});

test('RS Client Negative — ბალანსი: არარსებული ვალუტა XYZ → 1002', async ({ request }) => {
  await new RsNegativeHelper(request).balanceRejected({ amount: 1, currency: 'XYZ' }, { http: 400, code: 1002 });
});

// 🐞 500 მოდის (docs-შიც წერია 1000 / 500) — amount-ის გარეშე ვალიდაციის ერორი უნდა იყოს
test('RS Client Negative — ბალანსი: amount-ის გარეშე → 400', async ({ request }) => {
  await new RsNegativeHelper(request).balanceRejected({ currency: 'GEL' }, { http: 400 });
});

test('RS Client Negative — GET არარსებული კლიენტი → 400 / 1185', async ({ request }) => {
  await new RsNegativeHelper(request).getClientRejected({ http: 400, code: 1185 });
});
