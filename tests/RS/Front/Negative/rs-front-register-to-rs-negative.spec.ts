import { test } from '@playwright/test';
import { RsFrontRegisterHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — Register to RS, ნეგატიური: ცარიელი merchant, merchant სხვა გადამხდელზე, ident-ს უკვე აქვს ღია რეგისტრაცია
// 📋 ახალი merchant — ნომრების pool-იდან (995300000001…, OTP 111111) — შენი SMS არ სჭირდება

test.describe('RS ფრონტი — Register to RS (ნეგატიური)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('UI: Register to RS → Payment merchant, merchant არ არის არჩეული → Save and review → Merchant: "Field is required", რეგისტრაცია არ იქმნება', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).merchantRequired();
  });

  test('UI: merchant უკვე მიბმულია სხვა გადამხდელის ღია რეგისტრაციაზე → Register to RS სხვა ident-ით → "This wallet is already linked to another taxpayer\'s RS registration.", რეგისტრაცია არ იქმნება', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).merchantLinkedToOtherTaxpayer();
  });

  test('UI: Register to RS → No wallet + ident, რომელსაც ღია რეგისტრაცია აქვს → "An open registration already exists for this identification number", ახალი არ იქმნება', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).noWalletOpenIdent();
  });
});
