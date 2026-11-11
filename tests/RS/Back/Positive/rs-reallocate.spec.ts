import { test } from '@playwright/test';
import { RsMixedWalletsHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS — Reallocate (docs HLD-11): სისტემა ხელახლა ითვლის, სად არის მეტი თავისუფალი ფული → იქ იყინება, მეორე wallet თავისუფლდება
// 📋 ყოველი ქეისი — ახალი ბიზნესი: ახალი merchant (995300000001…, Temporary Verified, BALANCE flow) + ახალი hub wallet — სულ 2 wallet
// ⚠️ merchant-ის add money = 💳 ბანკის OTP შენს ტელეფონზე (ქეისზე 1-2 SMS)
// ⚠️ თანხები ≤ 1 ₾; hub-ის გადარიცხვა და merchant-ის გატანა — რეალური

test.describe('RS — Reallocate (merchant + hub)', () => {
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  test('ყადაღა 0.45 = merchant 0.15 + hub 0.3 (ორივე მთლიანად, hub ვერ გადარიცხავს) → merchant-ს add money 0.6 → Reallocate → მთელი ყადაღა merchant-ზე, hub თავისუფლდება და გადარიცხავს 0.1-ს ✅', async ({ request }) => {
    await new RsMixedWalletsHelper(request).reallocateToMerchant({ merchant: 0.15, hub: 0.3, topUp: 0.6, hubTransfer: 0.1 });
  });

  test('ყადაღა 0.45 = merchant 0.3 + hub 0.15 (ორივე მთლიანად, merchant ვერ გაიტანს) → hub-ს +0.5 → Reallocate → მთელი ყადაღა hub-ზე, merchant თავისუფლდება და გაიტანს 0.1-ს ✅', async ({ request }) => {
    await new RsMixedWalletsHelper(request).reallocateToHub({ merchant: 0.3, hub: 0.15, hubTopUp: 0.5, merchantCashOut: 0.1 });
  });

  test('ინკასო 0.35 = merchant 0.2 + hub 0.15 (ორივე მთლიანად, merchant ვერ გაიტანს) → hub-ს +0.5 → Reallocate → მთელი ინკასო hub-ზე, merchant თავისუფლდება და გაიტანს 0.1-ს ✅', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').reallocateToHub({ merchant: 0.2, hub: 0.15, hubTopUp: 0.5, merchantCashOut: 0.1 });
  });

  test('ინკასო 0.4 = merchant 0.1 + hub 0.3 (ორივე მთლიანად, hub ვერ გადარიცხავს) → merchant-ს add money 0.6 → Reallocate → მთელი ინკასო merchant-ზე, hub თავისუფლდება და გადარიცხავს 0.1-ს ✅', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').reallocateToMerchant({ merchant: 0.1, hub: 0.3, topUp: 0.6, hubTransfer: 0.1 });
  });

  test('merchant მერე დაემატა: hub 0.3, ყადაღა 0.5 (hub მთლიანად, აკლია 0.2) → ბიზნესს ემატება ახალი merchant 0.35 → Reallocate → merchant 0.35 + hub 0.15 → hub გადარიცხავს 0.15-ს ✅, merchant ვერაფერს', async ({ request }) => {
    await new RsMixedWalletsHelper(request).merchantAddedLater({ hub: 0.3, amount: 0.5, merchant: 0.35 });
  });

  test('merchant მერე დაემატა: hub 0.3, ინკასო 0.5 → ახალი merchant 0.35 → Reallocate → merchant 0.35 + hub 0.15 → hub გადარიცხავს 0.15-ს ✅, merchant ვერაფერს', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').merchantAddedLater({ hub: 0.3, amount: 0.5, merchant: 0.35 });
  });

  test('hub მერე დაემატა: merchant 0.3, ყადაღა 0.5 (merchant მთლიანად, აკლია 0.2, ვერ გაიტანს) → ბიზნესს ემატება hub 0.35 → Reallocate → hub 0.35 + merchant 0.15 → merchant გაიტანს 0.15-ს ✅, hub ვერაფერს', async ({ request }) => {
    await new RsMixedWalletsHelper(request).hubAddedLater({ merchant: 0.3, amount: 0.5, hub: 0.35 });
  });

  test('hub მერე დაემატა: merchant 0.3, ინკასო 0.5 → hub 0.35 → Reallocate → hub 0.35 + merchant 0.15 → merchant გაიტანს 0.15-ს ✅, hub ვერაფერს', async ({ request }) => {
    await new RsMixedWalletsHelper(request, 'COLLECTION').hubAddedLater({ merchant: 0.3, amount: 0.5, hub: 0.35 });
  });
});
