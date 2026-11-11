import { test } from '@playwright/test';
import { RsFrontTabsHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — რეგისტრაციის გვერდის ტაბები (KD-2239): სათაური + Data · Wallets · Field changes · RS messages · History
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის მხარე (დადასტურება, ყადაღა, ინკასო) — სიმულატორი

test.describe('RS ფრონტი — KD-2239 რეგისტრაციის ტაბები', () => {
  test.describe.configure({ timeout: 480_000 });

  test('UI: Approved რეგისტრაცია → სათაური (Partner, Approved by, Submitted / Approved დრო, Registration ID) და Data ტაბი = API; RS-ში გაგზავნილ ველებს "Sent to RS" ნიშანი', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).headerAndData();
  });

  test('UI: ბიზნესზე 3 wallet (1 UI-დან + 2 Link clients-ით) → Wallets ტაბზე 3 მწკრივი (სახელი, Integrator, Holder reference, Accounts open, Active, Enrolled) = API', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).threeWallets();
  });

  test('UI: Field changes — Not submitted-ზე Edit data (სახელი, Known date) → 2 მწკრივი (ძველი / ახალი, ვინ, როდის) = API; Approved-ზე RS-ში გაგზავნილი ველები გამორთულია', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).fieldChanges();
  });

  test('UI: RS messages ტაბი → NEW_CLIENT "New client" / Acked (Message ID, Attempts, Created, Acknowledged) = API', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).rsMessages();
  });

  test('UI: History ტაბი → ყველა ნაბიჯი (Client created → Enrollment created → Queued new client → Submit → Approved), ახალი ზემოთ, ავტორებით', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).history();
  });
});
