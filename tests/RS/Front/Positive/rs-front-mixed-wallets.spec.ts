import { test } from '@playwright/test';
import { RsFrontMixedHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — ერთი გადამხდელი, ორი wallet (API-ის ნაბიჯები + UI: Wallets ტაბი, Liens & collections ფანჯარა, ბიზნესის გვერდი): hub-ის WALLET კლიენტი + merchant (BALANCE flow) — docs ENR-10, HLD-02/03/04, Example 1
// 📋 ყოველი ქეისი — ახალი ბიზნესი: ახალი merchant (995300000001…, OTP 111111, Temporary Verified, BALANCE flow) + ახალი hub wallet — სულ 2 wallet
// ⚠️ merchant-ის ფული = add money 💳 (ბანკის OTP შენს ტელეფონზე) — ქეისზე 1 SMS
// 📋 ქეისის ბოლოს: RS ხსნის, merchant იტანს მთელ ბალანსს (0), hub → 0 და იხსნება ბიზნესიდან
// ⚠️ თანხები ≤ 1 ₾; hub-ის გადარიცხვა და merchant-ის გატანა — რეალური

test.describe('RS ფრონტი — merchant + hub ერთ რეგისტრაციაზე', () => {
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  // ─── მიბმა ───

  test('UI: გზა 1: ბიზნესი + hub wallet → ახალი merchant ბიზნესის Identification Number-ით → Register to RS merchant-ის wallet-ით → იგივე რეგისტრაცია, 2 wallet (payment-service + distributor-hub)', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).linkMerchantToBusiness();
  });

  test('UI: გზა 2: ახალი merchant → Register to RS → ბიზნესი merchant-ის Identification Number-ით + hub wallet → hub wallet იგივე რეგისტრაციას ებმის, 2 wallet', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).linkBusinessToMerchant();
  });

  // ─── ყადაღა ───

  test('UI: ყადაღა 0.4: merchant 0.45, hub 0.2 → მხოლოდ merchant 0.4 → hub გადარიცხავს 0.1-ს ✅, merchant ვერ გაიტანს 0.1-ს (თავისუფალი 0.05) → RS ხსნის → ორივე თავისუფალია', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).holdCase({ merchant: 0.45, hub: 0.2, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.1 });
  });

  test('UI: ყადაღა 0.4: merchant 0.25, hub 0.2 → merchant 0.25 (მთლიანად) + hub 0.15 → hub ვერ გადარიცხავს 0.1-ს (თავისუფალი 0.05), merchant ვერ გაიტანს 0.05-ს', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).holdCase({ merchant: 0.25, hub: 0.2, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.05 });
  });

  test('UI: ყადაღა 0.3: merchant 0.2, hub 0.2 (თანაბარი) → ერთზე მთლიანად 0.2, მეორეზე 0.1 (ვინ — integrator-ის პრიორიტეტი)', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).equalBalances({ balance: 0.2, amount: 0.3 });
  });

  test('UI: ყადაღა 0.4: merchant 0.15, hub 0.45 → მხოლოდ hub 0.4 → merchant გაიტანს 0.05-ს თავის ანგარიშზე ✅, hub ვერ გადარიცხავს 0.1-ს (თავისუფალი 0.05)', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).holdCase({ merchant: 0.15, hub: 0.45, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.05 });
  });

  test('UI: ყადაღა 0.4: merchant 0.1, hub 0.2 (სულ 0.3) → Partially restricted, ორივე მთლიანად, ვერც ერთი ვერაფერს → hub-ს +0.2 → hold ივსება (hub 0.3) → Fully restricted', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).shortThenHubTopUp({ merchant: 0.1, hub: 0.2, amount: 0.4, topUp: 0.2 });
  });

  // ─── ინკასო ───

  test('UI: ინკასო 0.4: merchant 0.45, hub 0.2 → მხოლოდ merchant 0.4 → hub გადარიცხავს 0.1-ს ✅, merchant ვერ გაიტანს 0.1-ს → RS ხსნის → ორივე თავისუფალია', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').holdCase({ merchant: 0.45, hub: 0.2, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.1 });
  });

  test('UI: ინკასო 0.4: merchant 0.2, hub 0.2 → merchant 0.2 (მთლიანად) + hub 0.2 → hub ვერ გადარიცხავს, merchant ვერ გაიტანს', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').holdCase({ merchant: 0.2, hub: 0.2, amount: 0.4, hubTransfer: 0.05, merchantCashOut: 0.05 });
  });

  test('UI: ინკასო 0.3: merchant 0.15, hub 0.15 (თანაბარი) → ერთზე მთლიანად 0.15, მეორეზე 0.15', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').equalBalances({ balance: 0.15, amount: 0.3 });
  });

  test('UI: ინკასო 0.4: merchant 0.1, hub 0.45 → მხოლოდ hub 0.4 → merchant გაიტანს 0.05-ს ✅, hub ვერ გადარიცხავს 0.1-ს', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').holdCase({ merchant: 0.1, hub: 0.45, amount: 0.4, hubTransfer: 0.1, merchantCashOut: 0.05 });
  });

  test('UI: ინკასო 0.4: merchant 0.05, hub 0.2 (სულ 0.25) → Partially restricted → hub-ს +0.2 → hold ივსება (hub 0.35) → Fully restricted', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').shortThenHubTopUp({ merchant: 0.05, hub: 0.2, amount: 0.4, topUp: 0.2 });
  });

  test('UI: ინკასო 0.35: merchant 0.05, hub 0.3 → hub 0.3 + merchant 0.05 → ადმინი იხდის 0.3 → ჩამოიჭრება გაყინულიდან (merchant / hub), ჯამი 0.3, ბალანსები შემცირდა', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').collectionPaidFromBoth({ merchant: 0.05, hub: 0.3, amount: 0.35, pay: 0.3 });
  });

});
