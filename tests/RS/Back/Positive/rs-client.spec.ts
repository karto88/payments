import { test } from '@playwright/test';
import { RsClientHelper } from '../../../../utils/order-helpers';
import { gel, currencyConfig } from '../../../../utils/order-helpers/RS/RsClientHelper';
import * as dotenv from 'dotenv';

dotenv.config();

// RS — Distributor Hub კლიენტი (საფულე) + ბიზნესზე მიბმა — ადმინ პანელი (KD-2237 / KD-2239)
// 1. შექმნა: WALLET ბიზნესით / ბიზნესის გარეშე, SYSTEM_OPERATOR
//    + distributeMethod / distributionStrategy, საკომისიო (FIXED / PERCENTAGE / tier-ები), ლიმიტები, provider-ები, ვალუტები
// 2. მიბმა / მოხსნა: POST /business/{id}/clients (1 და 2 კლიენტი), DELETE /business/{id}/clients/{clientId}
// 3. ფილტრები: searchText (სახელი / clientId), showMock
// ყოველი ტესტი ქმნის ახალ ბიზნესს + mock კლიენტ(ებ)ს

// ─── 1. შექმნა ───

test('RS Client — WALLET ბიზნესით (businessId შექმნისას)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true });
});

test('RS Client — WALLET ბიზნესის გარეშე (თავისუფალ სიაშია)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: false });
});

test('RS Client — SYSTEM_OPERATOR ბიზნესის გარეშე (თავისუფალ სიაში არ არის)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'SYSTEM_OPERATOR', withBusiness: false });
});

// ─── 1.1 შექმნა — distributeMethod / distributionStrategy ───

test('RS Client — distributeMethod RECEIVER_ID', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true, body: { distributeMethod: 'RECEIVER_ID' } });
});

test('RS Client — distributionStrategy MANUAL', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true, body: { distributionStrategy: 'MANUAL' } });
});

test('RS Client — distributionStrategy TREASURY', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true, body: { distributionStrategy: 'TREASURY' } });
});

// TESTING — მხოლოდ შექმნის შემოწმება (ასეთი კლიენტით გადახდებს არ ვაკეთებთ)
test('RS Client — distributionStrategy TESTING', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true, body: { distributionStrategy: 'TESTING' } });
});

// ─── 1.2 შექმნა — საკომისიო და ლიმიტები (ზღვრული მნიშვნელობები — ვალიდური მხარე) ───

test('RS Client — საკომისიო FIXED 1 GEL', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: gel({}, { commission: 1, commissionRateType: 'FIXED' }) } });
});

test('RS Client — საკომისიო PERCENTAGE 2.5%', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: gel({}, { commission: 2.5, commissionRateType: 'PERCENTAGE' }) } });
});

test('RS Client — საკომისიო PERCENTAGE 100% (ზედა ზღვარი)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: gel({}, { commission: 100, commissionRateType: 'PERCENTAGE' }) } });
});

test('RS Client — საკომისიო PERCENTAGE min / max საკომისიოს თანხით', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: gel({}, { commission: 1.5, commissionRateType: 'PERCENTAGE', minCommissionAmount: 0.5, maxCommissionAmount: 50 }) } });
});

test('RS Client — საკომისიოს 2 tier (0-დან FIXED, 1000-დან PERCENTAGE)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: { GEL: [currencyConfig({ commissionTiers: [
      { commission: 1, commissionRateType: 'FIXED', startAmount: 0 },
      { commission: 1.5, commissionRateType: 'PERCENTAGE', startAmount: 1000 },
    ] })] } } });
});

test('RS Client — ლიმიტები: min 0.01 (ქვედა ზღვარი), max 1 000 000', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: gel({ minTransactionAmount: 0.01, maxTransactionAmount: 1000000 }) } });
});

test('RS Client — ლიმიტები: min = max (10 = 10)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: gel({ minTransactionAmount: 10, maxTransactionAmount: 10 }) } });
});

test('RS Client — რამდენიმე provider (DEFAULT + TBC + BOG)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: { GEL: [
      currencyConfig(),
      currencyConfig({ provider: 'TBC', minTransactionAmount: 1, maxTransactionAmount: 3000 }),
      currencyConfig({ provider: 'BOG', minTransactionAmount: 1, maxTransactionAmount: 5000 }, { commission: 1, commissionRateType: 'PERCENTAGE' }),
    ] } } });
});

test('RS Client — რამდენიმე ვალუტა (GEL + USD + EUR)', async ({ request }) => {
  await new RsClientHelper(request).createClient({ scheme: 'WALLET', withBusiness: true,
    body: { currencyConfigs: {
      GEL: [currencyConfig()],
      USD: [currencyConfig({ minTransactionAmount: 1, maxTransactionAmount: 10000 }, { commission: 2, commissionRateType: 'PERCENTAGE' })],
      EUR: [currencyConfig({ minTransactionAmount: 1, maxTransactionAmount: 10000 })],
    } } });
});

// ─── 2. მიბმა / მოხსნა ───

test('RS Client — ბიზნესზე მიბმა: 1 კლიენტი', async ({ request }) => {
  await new RsClientHelper(request).linkClients(1);
});

test('RS Client — ბიზნესზე მიბმა: 2 კლიენტი ერთი request-ით', async ({ request }) => {
  await new RsClientHelper(request).linkClients(2);
});

test('RS Client — ბიზნესიდან მოხსნა - Unlink', async ({ request }) => {
  await new RsClientHelper(request).unlinkClient();
});

// ─── 3. ფილტრები ───

test('RS Client — ფილტრი: searchText = სახელის ნაწილი', async ({ request }) => {
  await new RsClientHelper(request).checkFilter('name');
});

test('RS Client — ფილტრი: searchText = clientId', async ({ request }) => {
  await new RsClientHelper(request).checkFilter('clientId');
});

test('RS Client — ფილტრი: showMock = false → mock კლიენტი დამალულია', async ({ request }) => {
  await new RsClientHelper(request).checkFilter('hideMock');
});
