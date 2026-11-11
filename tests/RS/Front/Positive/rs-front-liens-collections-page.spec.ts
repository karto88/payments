import { test } from '@playwright/test';
import { RsFrontRestrictionsPageHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — საერთო გვერდი RS → Liens & collections: ყველა ყადაღა / ინკასო, ძებნა, ფილტრი, გადახდა აქედან, History / Audit
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის მხარე — სიმულატორი

const helper = (page: any, request: any) => new RsFrontRestrictionsPageHelper(page, request);
const SETUP = { balance: 0.7, lien: 0.2, collection: 0.4 };

test.describe('RS ფრონტი — Liens & collections (საერთო გვერდი)', () => {
  test.describe.configure({ timeout: 420_000 });

  test('wallet 0.7 → ყადაღა 0.2 + ინკასო 0.4 → სიაში ძებნა RS reference-ით (ორივე სწორი მწკრივით, უცნობი → ცარიელი) → ფილტრები: Identification number, + Type Lien / Collection, + Status Fully restricted / Executed, Registration ID', async ({ page, request }) => {
    await helper(page, request).listSearchAndFilters(SETUP);
  });

  test('საერთო გვერდიდან ინკასოს გადახდა: ძებნა → ფანჯარა → Request amount → RS asks 0.4 → Record manual payment 0.4 → Executed (სიაშიც) → History: ყველა ნაბიჯი რიგით + ვინ (RS / User / Integrator / System), payload (თანხა, Bank reference) → Audit: მხოლოდ Restriction-ის ცვლილებები', async ({ page, request }) => {
    await helper(page, request).payCollectionFromList(SETUP);
  });

  test('ყადაღა საერთო გვერდიდან: ფანჯარაში Executions / Request amount / Record manual payment არ არის → RS ხსნის → სიაში Withdrawn, Restricted 0 → History: Lien received … Lien withdrawn by RS → Hold released → Audit', async ({ page, request }) => {
    await helper(page, request).lienWithdrawnFromList(SETUP);
  });
});
