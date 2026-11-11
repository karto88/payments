import { test } from '@playwright/test';
import { RsFrontHelper, RsFrontTabsHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — ყადაღა (KD-2242): UI flow (wallet → ბიზნესი → მიბმა → რეგისტრაცია → Approved) → RS აგზავნის ყადაღას → UI-ში ყველა ცხრილი
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის მხარე (დადასტურება, ყადაღა, ინკასო) — სიმულატორი

test.describe('RS ფრონტი — KD-2242 ყადაღა', () => {
  test.describe.configure({ timeout: 420_000 });

  test('UI flow (wallet → ბიზნესი → მიბმა → რეგისტრაცია → Approved) → wallet-ზე 0.5 ₾ → RS აგზავნის ყადაღას 0.3 ₾ → Fully restricted: ფანჯარა, Holds per wallet (Held 0.30), რეგისტრაციის და ბიზნესის ცხრილები, ბალანსი 0.50 / 0.30 / 0.20', async ({ page, request }) => {
    await new RsFrontHelper(page, request).lienFromUi({ balance: 0.5, lien: 0.3 });
  });

  test('UI flow → wallet-ზე 0.3 ₾ → RS აგზავნის ყადაღას 0.5 ₾ → Partially restricted, "Waiting for funds: 0.20 GEL short", Fills up Yes, ბალანსი 0.30 / 0.30 / 0.00', async ({ page, request }) => {
    await new RsFrontHelper(page, request).lienFromUi({ balance: 0.3, lien: 0.5 });
  });

  test('UI flow → ცარიელი wallet (0 ₾) → RS აგზავნის ყადაღას 0.3 ₾ → Pending, "Waiting for funds: 0.30 GEL short", Held 0, ბალანსი 0.00 / 0.00 / 0.00', async ({ page, request }) => {
    await new RsFrontHelper(page, request).lienFromUi({ balance: 0, lien: 0.3 });
  });

  test('UI: 3 wallet (0.2 / 0.5 / 0.3) → ყადაღა 0.6 → ჯერ ყველაზე დიდი: 0.5 + 0.1 → Holds per wallet = API, ბიზნესის გვერდზე თითო wallet-ის ბალანსი / გაყინული / თავისუფალი', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).lienAcrossWallets({ lien: 0.6 });
  });
});
