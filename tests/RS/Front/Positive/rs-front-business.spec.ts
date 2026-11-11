import { test } from '@playwright/test';
import { RsFrontBusinessHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — Distributor Hub → Businesses (KD-2559), ადმინი 591078180
// UI-ში მოქმედება → შემოწმება UI-ში (სია / ბიზნესის გვერდი) და API-ში (რა შეინახა)

test.describe('RS ფრონტი — Businesses: შექმნა', () => {
  test.describe.configure({ timeout: 120_000 });

  test('UI: Create business — Resident → toast "Business created" → ბიზნესის გვერდზე სწორი მონაცემები, Register to RS → API-ში ყველა ველი შენახულია → სიაში პირველია (0 კლიენტი)', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).createBusiness('RESIDENT');
  });

  test('UI: Create business — Foreign (მისამართებით) → toast "Business created" → ბიზნესის გვერდზე Foreign → API-ში მისამართებიც შენახულია → სიაში პირველია', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).createBusiness('FOREIGN');
  });

});

test.describe('RS ფრონტი — Businesses: ძებნა და ფილტრი', () => {
  test.describe.configure({ timeout: 120_000 });

  test('UI: ძებნა identification number-ით → სიაში მხოლოდ ეს ბიზნესი', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).searchByIdent();
  });

  test('UI: ფილტრი Owner-ით → სიაში მხოლოდ ამ სახელის ბიზნესები', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).filterByOwner();
  });

  test('UI: ფილტრი Residency = Resident → სიაში მხოლოდ Resident ბიზნესები', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).filterByResidency('RESIDENT');
  });

  test('UI: ფილტრი Residency = Foreign → სიაში მხოლოდ Foreign ბიზნესები', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).filterByResidency('FOREIGN');
  });
});
