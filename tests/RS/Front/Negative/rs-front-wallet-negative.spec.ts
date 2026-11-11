import { test } from '@playwright/test';
import { RsFrontWalletHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — ❌ ნეგატიური: WALLET კლიენტი (Dist. Integrators → New Integrator)

test.describe('RS ფრონტი — Wallet: შექმნა ❌', () => {
  test.describe.configure({ timeout: 120_000 });

  test('UI: New Integrator: Scheme Wallet, სხვა ველები ცარიელი → Create → შეცდომები: Name, Distribution method, Distribution Strategy, Min / Max transaction amount, Commission rate type, Commission; wallet არ იქმნება', async ({ page, request }) => {
    await new RsFrontWalletHelper(page, request).emptyFormRejected();
  });
});
