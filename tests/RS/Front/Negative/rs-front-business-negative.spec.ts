import { test } from '@playwright/test';
import { RsFrontBusinessHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — ❌ ნეგატიური: Distributor Hub → Businesses (KD-2559), ადმინი 591078180

test.describe('RS ფრონტი — Businesses: შექმნა ❌', () => {
  test.describe.configure({ timeout: 120_000 });

  test('UI: Create business — Resident, ცარიელი ფორმა → Create → წითლად: Owner full name, Owner identification number, Operation date, Known date; ბიზნესი არ იქმნება', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).requiredFields('RESIDENT');
  });

  test('UI: Create business — Foreign, ცარიელი ფორმა → Create → წითლად: Owner full name, Operation date და 6 მისამართის ველი; ბიზნესი არ იქმნება', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).requiredFields('FOREIGN');
  });
});
