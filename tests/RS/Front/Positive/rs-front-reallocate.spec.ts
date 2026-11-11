import { test } from '@playwright/test';
import { RsFrontMixedHelper, RsFrontTabsHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — Reallocate (docs HLD-11) UI-დან: ფანჯარა → "Reallocate holds" → "Reallocate holds?" → Reallocate
//   სისტემა ხელახლა ითვლის, სად არის მეტი თავისუფალი ფული → იქ იყინება, მეორე wallet თავისუფლდება; UI (Overview, Holds per wallet, ბიზნესის გვერდი) = API
// 📋 ყოველი ქეისი — ახალი ბიზნესი: ახალი merchant (995300000001…, Temporary Verified, BALANCE flow) + ახალი hub wallet — სულ 2 wallet
// ⚠️ merchant-ის add money = 💳 ბანკის OTP შენს ტელეფონზე (ქეისზე 1-2 SMS)
// ⚠️ თანხები ≤ 1 ₾; hub-ის გადარიცხვა და merchant-ის გატანა — რეალური

test.describe('RS ფრონტი — Reallocate holds (merchant + hub)', () => {
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  // ─── Reallocate holds — hub wallet-ები (SMS არ სჭირდება) ───
  // ⚠️ ღილაკი "Reallocate holds" ჩანს მხოლოდ Partially restricted-ზე (KD-2617-ის შემდეგ Fully restricted-ზე დამალულია)

  test('UI: wallet A 0.3 → ყადაღა 0.5 → Partially restricted (A 0.3, აკლია 0.2) → UI-დან ებმის wallet B 0.4 → B-ზე ჯერ არაფერი → UI: Reallocate holds → B 0.4 + A 0.1 → Fully restricted → A გადარიცხავს 0.1-ს ✅; Holds per wallet და ბიზნესის გვერდი = API', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).reallocateWalletAddedLater({ kind: 'LIEN', first: 0.3, amount: 0.5, second: 0.4, transfer: 0.1 });
  });

  test('UI: wallet A 0.3 → ინკასო 0.5 → Partially restricted → UI-დან ებმის wallet B 0.4 → UI: Reallocate holds → B 0.4 + A 0.1 → Fully restricted → A გადარიცხავს 0.1-ს ✅', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).reallocateWalletAddedLater({ kind: 'COLLECTION', first: 0.3, amount: 0.5, second: 0.4, transfer: 0.1 });
  });

  // ⚠️ "ორივე მთლიანად გაყინულია → ერთს შევუვსეთ → Reallocate" (Fully restricted) UI-დან შეუძლებელია — ღილაკი არ ჩანს;
  //    ეს 4 ქეისი API-თ დაფარულია: tests/RS/Back/Positive/rs-reallocate.spec.ts; ღილაკის ხილვადობა — Negative/rs-front-guards-negative.spec.ts

  // ─── merchant + hub: wallet მერე დაემატა (Partially restricted → ღილაკი ჩანს) ───

  test('UI: merchant მერე დაემატა: hub 0.3, ყადაღა 0.5 (აკლია 0.2) → ახალი merchant 0.35 → UI: Reallocate holds → merchant 0.35 + hub 0.15 → hub გადარიცხავს 0.15-ს ✅, merchant ვერაფერს', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).merchantAddedLater({ hub: 0.3, amount: 0.5, merchant: 0.35 });
  });

  test('UI: merchant მერე დაემატა: hub 0.3, ინკასო 0.5 → ახალი merchant 0.35 → UI: Reallocate holds → merchant 0.35 + hub 0.15 → hub გადარიცხავს 0.15-ს ✅, merchant ვერაფერს', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').merchantAddedLater({ hub: 0.3, amount: 0.5, merchant: 0.35 });
  });

  test('UI: hub მერე დაემატა: merchant 0.3, ყადაღა 0.5 (merchant ვერ გაიტანს) → hub 0.35 → UI: Reallocate holds → hub 0.35 + merchant 0.15 → merchant გაიტანს 0.15-ს ✅, hub ვერაფერს', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request).hubAddedLater({ merchant: 0.3, amount: 0.5, hub: 0.35 });
  });

  test('UI: hub მერე დაემატა: merchant 0.3, ინკასო 0.5 → hub 0.35 → UI: Reallocate holds → hub 0.35 + merchant 0.15 → merchant გაიტანს 0.15-ს ✅, hub ვერაფერს', async ({ page, request }) => {
    await new RsFrontMixedHelper(page, request, 'COLLECTION').hubAddedLater({ merchant: 0.3, amount: 0.5, hub: 0.35 });
  });
});
