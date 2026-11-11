import { test } from '@playwright/test';
import { RsFrontManualPaymentHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — ინკასოს ხელით გადახდა UI-დან (11.11: ღილაკი "Record manual payment")
//   Request amount from RS → RS პასუხობს (TODAY: "RS asks ₾X today…") → Record manual payment (Amount paid, Paid at, Bank reference, Note) → wallet ჩამოიჭრება
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის პასუხი — სიმულატორი (ნაკლები / 0 — scenario)

test.describe('RS ფრონტი — ინკასოს ხელით გადახდა (Record manual payment)', () => {
  test.describe.configure({ timeout: 360_000 });

  test('UI: wallet 0.5 → ინკასო 0.3 (Fully restricted) → Request amount → TODAY "RS asks ₾ 0.30" → Record manual payment: ფორმაში 0.3 და ახლანდელი დრო → Bank reference → Record → "Payment recorded…" → Executed, Paid 0.3, TODAY Completed, Executions: MANUAL PAYMENT (ჩვენი Bank reference) + TRANSFERS Success, ღილაკი ქრება, wallet 0.2', async ({ page, request }) => {
    await new RsFrontManualPaymentHelper(page, request).recordFromUi({ balance: 0.5, amount: 0.3, pay: 0.3 });
  });

  test('UI: wallet 0.3 → ინკასო 0.5 (გაყინულია 0.3) → RS asks ₾ 0.50 → ფორმაში 0.5 → Record → "Must be at most 0.3" → 0.3 → Partially executed, Paid 0.3, Still owed 0.2, wallet 0', async ({ page, request }) => {
    await new RsFrontManualPaymentHelper(page, request).recordFromUi({ balance: 0.3, amount: 0.5, pay: 0.3 });
  });

  test('UI: ნაწილობრივი გადახდა — wallet 0.5 → ინკასო 0.4 → RS asks ₾ 0.40 → ადმინი იწერს 0.25 → Partially executed, Paid 0.25, Still owed 0.15, დარჩენილი 0.15 ისევ გაყინულია', async ({ page, request }) => {
    await new RsFrontManualPaymentHelper(page, request).recordFromUi({ balance: 0.5, amount: 0.4, pay: 0.25 });
  });

  test('UI: RS პასუხობს ნაკლებს (გადამხდელმა ნაწილი სხვაგან გადაიხადა) — ინკასო 0.4 → RS asks ₾ 0.20 → ფორმაში 0.2; 0.21 → "Must be at most 0.2" → 0.2 → Partially executed, Still owed 0.2', async ({ page, request }) => {
    await new RsFrontManualPaymentHelper(page, request).rsAnswersLess({ balance: 0.5, amount: 0.4, answer: 0.2 });
  });

  test('UI: RS პასუხობს 0 — ინკასო 0.3 → TODAY "No amount | RS asks nothing today. The money stays held." → "Record manual payment" არ ჩანს → Executions: No amount, RS answer ₾ 0.00 → ფული ისევ გაყინულია', async ({ page, request }) => {
    await new RsFrontManualPaymentHelper(page, request).rsAnswersZero({ balance: 0.5, amount: 0.3 });
  });
});
