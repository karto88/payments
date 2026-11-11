import { test } from '@playwright/test';
import { RsFrontWalletHelper, RsFrontBusinessHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — WALLET კლიენტი (Distributor Hub → Dist. Integrators): შექმნა, ფილტრები, მონაცემები UI-ში + API-ში

test.describe('RS ფრონტი — Wallet: შექმნა', () => {
  test.describe.configure({ timeout: 180_000 });

  test('UI: Dist. Integrators → New Integrator: Wallet (ბიზნესის გარეშე), IBAN, STANDARD, GEL, For testing → toast → სიაში: Test, Wallet, Activated, IBAN, STANDARD, GEL, ₾ 0 → API-ში ყველა ველი → "Clients without business"-ში ჩანს', async ({ page, request }) => {
    await new RsFrontWalletHelper(page, request).createWallet();
  });

  test('UI: New Integrator: Wallet + Business არჩეულია → სიაში Scheme "Wallet · <ბიზნესი>" → ბიზნესის გვერდზე Wallet clients-ში ჩანს → API businessId → "Clients without business"-ში არ ჩანს', async ({ page, request }) => {
    await new RsFrontWalletHelper(page, request).createWalletOnBusiness();
  });

  test('UI: Wallet კლიენტი ბიზნესის გარეშე → "Clients without business" ტაბში ჩანს (სახელი, Client ID, Active), რიცხვი +1', async ({ page, request }) => {
    await new RsFrontBusinessHelper(page, request).clientWithoutBusinessListed();
  });
});

test.describe('RS ფრონტი — Wallet: ძებნა და ფილტრი', () => {
  test.describe.configure({ timeout: 180_000 });

  test('UI: ძებნა სახელით: სატესტო wallet "Show Test Integrators"-ის გარეშე არ ჩანს → ჩართვით ჩანს (1 მწკრივი, "Test" ნიშნით)', async ({ page, request }) => {
    await new RsFrontWalletHelper(page, request).testFilter();
  });
});
