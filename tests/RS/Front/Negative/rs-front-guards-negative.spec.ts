import { test } from '@playwright/test';
import { RsFrontGuardsHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — UI-ის დაცვები: აკრძალულ მოქმედებაზე ღილაკი არ ჩანს / გამორთულია, API კი შეცდომის კოდს აბრუნებს
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის მხარე — სიმულატორი

test.describe('RS ფრონტი — UI-ის დაცვები (ნეგატიური)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('UI: ინკასო 0.3 (Fully restricted) → Request amount from RS → ღილაკი ქრება (დღეს მეორედ ვერ) → API: მეორე მოთხოვნა → 7018', async ({ page, request }) => {
    await new RsFrontGuardsHelper(page, request).requestAmountOncePerDay({ balance: 0.5, collection: 0.3 });
  });

  test('UI: ცარიელი wallet → ინკასო 0.3 → Pending (გაყინული 0) → "Request amount from RS" არ ჩანს → API → 7011', async ({ page, request }) => {
    await new RsFrontGuardsHelper(page, request).requestAmountHiddenOnPending({ collection: 0.3 });
  });

  test('UI: wallet 0.3 → ყადაღა 0.2 → ბიზნესის გვერდზე Unlink გამორთულია → API unlink → 1492 (Money is held) → RS ხსნის → Unlink ირთვება', async ({ page, request }) => {
    await new RsFrontGuardsHelper(page, request).unlinkDisabledWhileHeld({ balance: 0.3, lien: 0.2 });
  });

  test('UI: wallet 0.3 → ყადაღა 0.2 (Fully restricted) → "Reallocate holds" არ ჩანს → მეორე ყადაღა 0.3 (Partially restricted, 0.1) → "Reallocate holds" ჩანს', async ({ page, request }) => {
    await new RsFrontGuardsHelper(page, request).reallocateButtonVisibility({ balance: 0.3, full: 0.2, partial: 0.3 });
  });
});
