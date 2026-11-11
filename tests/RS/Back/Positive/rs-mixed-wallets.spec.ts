import { test } from '@playwright/test';
import { RsMixedWalletsHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS — ერთი გადამხდელი, ორი wallet: hub-ის WALLET კლიენტი + merchant (BALANCE flow) — docs ENR-10, HLD-02/03/04, Example 1
// 📋 ყოველი ქეისი — ახალი ბიზნესი: ახალი merchant (995300000001…, OTP 111111, Temporary Verified, BALANCE flow) + ახალი hub wallet — სულ 2 wallet
// ⚠️ merchant-ის ფული = add money 💳 (ბანკის OTP შენს ტელეფონზე) — ქეისზე 1 SMS
// 📋 ქეისის ბოლოს: RS ხსნის, merchant იტანს მთელ ბალანსს (0), hub → 0 და იხსნება ბიზნესიდან
// ⚠️ თანხები ≤ 1 ₾; hub-ის გადარიცხვა და merchant-ის გატანა — რეალური

test.describe('RS — merchant + hub ერთ რეგისტრაციაზე', () => {
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  // ─── მიბმა ───

  test('გზა 1: ბიზნესი + hub wallet → ახალი merchant ბიზნესის Identification Number-ით → Register to RS merchant-ის wallet-ით → იგივე რეგისტრაცია, 2 wallet (payment-service + distributor-hub)', async ({ request }) => {
    await new RsMixedWalletsHelper(request).linkMerchantToBusiness();
  });

  test('გზა 2: ახალი merchant → Register to RS → ბიზნესი merchant-ის Identification Number-ით + hub wallet → hub wallet იგივე რეგისტრაციას ებმის, 2 wallet', async ({ request }) => {
    await new RsMixedWalletsHelper(request).linkBusinessToMerchant();
  });

  // ─── ყადაღა ───

  test('ყადაღა 0.4: merchant 0.45, hub 0.2 → მხოლოდ merchant 0.4 → hub გადარიცხავს 0.1-ს ✅, merchant ვერ გაიტანს 0.1-ს (თავისუფალი 0.05) → RS ხსნის → ორივე თავისუფალია', async ({ request }) => {
    await new RsMixedWalletsHelper(request).holdCase({ merchant: 0.45, hub: 0.2, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.1 });
  });

  test('ყადაღა 0.4: merchant 0.25, hub 0.2 → merchant 0.25 (მთლიანად) + hub 0.15 → hub ვერ გადარიცხავს 0.1-ს (თავისუფალი 0.05), merchant ვერ გაიტანს 0.05-ს', async ({ request }) => {
    await new RsMixedWalletsHelper(request).holdCase({ merchant: 0.25, hub: 0.2, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.05 });
  });

  test('ყადაღა 0.3: merchant 0.2, hub 0.2 (თანაბარი) → ერთზე მთლიანად 0.2, მეორეზე 0.1 (ვინ — integrator-ის პრიორიტეტი)', async ({ request }) => {
    await new RsMixedWalletsHelper(request).equalBalances({ balance: 0.2, amount: 0.3 });
  });

  test('ყადაღა 0.4: merchant 0.15, hub 0.45 → მხოლოდ hub 0.4 → merchant გაიტანს 0.05-ს თავის ანგარიშზე ✅, hub ვერ გადარიცხავს 0.1-ს (თავისუფალი 0.05)', async ({ request }) => {
    await new RsMixedWalletsHelper(request).holdCase({ merchant: 0.15, hub: 0.45, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.05 });
  });

  test('ყადაღა 0.4: merchant 0.1, hub 0.2 (სულ 0.3) → Partially restricted, ორივე მთლიანად, ვერც ერთი ვერაფერს → hub-ს +0.2 → hold ივსება (hub 0.3) → Fully restricted', async ({ request }) => {
    await new RsMixedWalletsHelper(request).shortThenHubTopUp({ merchant: 0.1, hub: 0.2, amount: 0.4, topUp: 0.2 });
  });

  // ─── ინკასო ───

  test('ინკასო 0.4: merchant 0.45, hub 0.2 → მხოლოდ merchant 0.4 → hub გადარიცხავს 0.1-ს ✅, merchant ვერ გაიტანს 0.1-ს → RS ხსნის → ორივე თავისუფალია', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').holdCase({ merchant: 0.45, hub: 0.2, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.1 });
  });

  test('ინკასო 0.4: merchant 0.2, hub 0.2 → merchant 0.2 (მთლიანად) + hub 0.2 → hub ვერ გადარიცხავს, merchant ვერ გაიტანს', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').holdCase({ merchant: 0.2, hub: 0.2, amount: 0.4, hubTransfer: 0.05, merchantCashOut: 0.05 });
  });

  test('ინკასო 0.3: merchant 0.15, hub 0.15 (თანაბარი) → ერთზე მთლიანად 0.15, მეორეზე 0.15', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').equalBalances({ balance: 0.15, amount: 0.3 });
  });

  test('ინკასო 0.4: merchant 0.1, hub 0.45 → მხოლოდ hub 0.4 → merchant გაიტანს 0.05-ს ✅, hub ვერ გადარიცხავს 0.1-ს', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').holdCase({ merchant: 0.1, hub: 0.45, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.05 });
  });

  test('ინკასო 0.4: merchant 0.05, hub 0.2 (სულ 0.25) → Partially restricted → hub-ს +0.2 → hold ივსება (hub 0.35) → Fully restricted', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').shortThenHubTopUp({ merchant: 0.05, hub: 0.2, amount: 0.4, topUp: 0.2 });
  });

  test('ინკასო 0.35: merchant 0.05, hub 0.3 → hub 0.3 + merchant 0.05 → ადმინი იხდის 0.3 → ჩამოიჭრება გაყინულიდან (merchant / hub), ჯამი 0.3, ბალანსები შემცირდა', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').collectionPaidFromBoth({ merchant: 0.05, hub: 0.3, amount: 0.35, pay: 0.3 });
  });

});
