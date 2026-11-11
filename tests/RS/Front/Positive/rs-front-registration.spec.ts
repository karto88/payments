import { test } from '@playwright/test';
import { RsFrontHelper, RsFrontBusinessHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — wallet-ის მიბმა ბიზნესზე + RS რეგისტრაცია (KD-2239): Link clients / Create business კლიენტიდან → რეგისტრაცია თავისით → Submit → Approved → ცხრილები
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის მხარე (დადასტურება, ყადაღა, ინკასო) — სიმულატორი

test.describe('RS ფრონტი — KD-2239 რეგისტრაცია', () => {
  test.describe.configure({ timeout: 360_000 });

  test('UI: ბიზნესის შექმნა → wallet-ის მიბმა → რეგისტრაცია თავისით იქმნება (Not submitted) → Submit to RS → Pending RS approval → RS ადასტურებს → Approved, Wallets ტაბზე ჩანს wallet', async ({ page, request }) => {
    await new RsFrontHelper(page, request).registerBusinessFromUi();
  });

  test('UI: "Clients without business" → კლიენტის მწკრივიდან Create business → ბანერი "will be linked", Operation date = კლიენტის შექმნის თარიღი → Create → wallet ბიზნესზე მიბმულია, რეგისტრაცია Not submitted, კლიენტი ტაბიდან ქრება (რიცხვი −1)', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).createBusinessFromClient();
  });
});
