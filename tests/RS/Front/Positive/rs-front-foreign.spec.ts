import { test } from '@playwright/test';
import { RsFrontForeignHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — Foreign (არარეზიდენტი) e2e: RS მას იცნობს ალტერნატიული პირადი ნომრით (personIdAlt)
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის მხარე — სიმულატორი

test.describe('RS ფრონტი — Foreign e2e', () => {
  test.describe.configure({ timeout: 600_000 });

  test('UI: wallet 1 ₾ → Foreign ბიზნესი (მისამართებით) → wallet-ის მიბმა → რეგისტრაციაზე Alternative personal number → Submit to RS → Approved → RS: ყადაღა 0.3 + ინკასო 0.4 alt ნომრით → ორივე Fully restricted, გაყინულია 0.7 → გადარიცხვა 0.31 → უარი → ინკასო: Request amount → Record manual payment 0.4 → Executed → RS ხსნის ყადაღას → გადარიცხვა 0.1 გადის', async ({ page, request }) => {
    await new RsFrontForeignHelper(page, request).foreignEndToEnd({ balance: 1, lien: 0.3, collection: 0.4, transferAfter: 0.1 });
  });
});
