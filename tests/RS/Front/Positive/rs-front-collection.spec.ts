import { test } from '@playwright/test';
import { RsFrontHelper, RsFrontTabsHelper, RsFrontPriorityHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — ინკასო (KD-2241): UI flow → RS აგზავნის ინკასოს → ფანჯარა, Request amount, Record manual payment ("Return collection" 11.11-დან ამოღებულია)
// ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾; RS-ის მხარე (დადასტურება, ყადაღა, ინკასო) — სიმულატორი

test.describe('RS ფრონტი — KD-2241 ინკასო', () => {
  test.describe.configure({ timeout: 420_000 });

  test('wallet-ზე 0.5 ₾ → RS აგზავნის ინკასოს 0.3 ₾ → ფანჯარაში Fully restricted, wallet-ზე გაყინულია 0.3 → wallet ცდილობს 0.3 ₾-ის გადარიცხვას (თავისუფალია 0.2) → უარი → "Return collection" ღილაკი არ ჩანს → RS გამოითხოვს → Withdrawn, ფული თავისუფლდება', async ({ page, request }) => {
    await new RsFrontHelper(page, request).collectionBlocksTransferThenWithdraw({ balance: 0.5, collection: 0.3, transfer: 0.3 });
  });

  test('ცარიელ wallet-ზე RS აგზავნის ინკასოს 0.3 ₾ → ფანჯარაში Pending, "Waiting for funds: 0.30 GEL short" → wallet-ს ერიცხება 0.5 ₾ → ინკასო ივსება: Fully restricted, გაყინულია 0.3', async ({ page, request }) => {
    await new RsFrontHelper(page, request).collectionFillsWhenMoneyArrives({ collection: 0.3, topUp: 0.5 });
  });

  test('ინკასო 0.3 ₾ (Fully restricted) → ადმინი: Request amount from RS → RS პასუხობს 0.3 ₾ → Executions-ში 1 ბარათი: Amount received / Manual / ₾ 0.30, TRANSFERS ცარიელია (ხელით რეჟიმი — სისტემა არ რიცხავს)', async ({ page, request }) => {
    await new RsFrontHelper(page, request).requestAmountFromUi({ balance: 0.5, collection: 0.3 });
  });

  test('ინკასოს ხელით გადახდა: wallet 0.5, ინკასო 0.5 → UI: Request amount from RS → Executions: Amount received / Manual / RS answer → ადმინი აფიქსირებს 0.3-ს bankReference-ით (UI: Record manual payment) → UI: Paid to treasury 0.3; Executions: Completed, MANUAL PAYMENT (Bank reference = ჩვენი, Paid at, Recorded by), TRANSFERS: wallet · 0.30 · Success; ბალანსი −0.3', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).manualPaymentFromUi({ balance: 0.5, amount: 0.5, pay: 0.3 });
  });

  test('3 wallet → ინკასო 0.6 → სრული გადახდა 0.6 → Executed; Holds per wallet, Executions + TRANSFERS (თითო wallet-ის ჩამოჭრა) = API; ბიზნესის გვერდზე ბალანსები შემცირდა', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).collectionAcrossWallets({ amount: 0.6, pay: 0.6 });
  });

  test('3 wallet → ინკასო 0.6 → ნაწილობრივი გადახდა 0.4 → Partially executed; ჩამოჭრილი 0.4, დარჩენილი 0.2 გაყინულია; ცხრილები და ბალანსები = API', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).collectionAcrossWallets({ amount: 0.6, pay: 0.4 });
  });

  test('ინკასო 2 დღეში (ერთი ტესტი, გაუშვი დღეს და ხვალ): დღეს — 3 wallet (0.1 / 0.2 / 0.2) → ინკასო 0.8 → იყინება 0.5 → ადმინი იხდის 0.4 → დარჩა 0.4, ინკასო ღიაა; ხვალ — შევსება 0.3 → დარჩენილი 0.4 იყინება → Request amount → ადმინი იხდის 0.4 → Executed 0.8 (Executions 2 მწკრივი)', async ({ page, request }) => {
    await new RsFrontTabsHelper(page, request).collectionOverTwoDays({ balances: [0.1, 0.2, 0.2], amount: 0.8, pay: 0.4, topUp: 0.3 });
  });
});

// Priority (RS პროტოკოლი 5.4.3, §7): 1 ძირითადი · 2 სანქცია · 3 საურავი — ფული იყინება და იხდება 1 → 2 → 3, ერთნაირში ჯერ ძველი
// ⚠️ 11.11: KD-2682 (ფული შემოსვლის რიგით იყინება), KD-2683 (Request amount / გადახდა priority 1-მდე მუშაობს) — ჩავარდება გასწორებამდე
test.describe('RS ფრონტი — KD-2241 ინკასოს პრიორიტეტი', () => {
  test.describe.configure({ timeout: 420_000 });

  test('wallet 0.6 → ინკასოები შემოდის priority 3 → 2 → 1 (თითო 0.3) → ფანჯარაში Priority 3 / 2 / 1; ფული priority-ით: P1 Fully 0.3, P2 Fully 0.3, P3 Pending 0 (KD-2682)', async ({ page, request }) => {
    await new RsFrontPriorityHelper(page, request).holdsByPriority({ balance: 0.6, amount: 0.3, arrive: [3, 2, 1] });
  });

  test('ცარიელი wallet → priority 3, მერე priority 1 (ორივე Pending) → wallet-ს ერიცხება 0.3 → ფული priority 1-ს მიდის (Fully 0.3), priority 3 რჩება Pending (KD-2682)', async ({ page, request }) => {
    await new RsFrontPriorityHelper(page, request).topUpGoesToPriority({ amount: 0.3, arrive: [3, 1], topUp: 0.3 });
  });

  test('ერთნაირი priority: wallet 0.3 → 2 ინკასო priority 1 (თითო 0.3) → ფული ძველს: 1-ლი Fully 0.3, მე-2 Pending', async ({ page, request }) => {
    await new RsFrontPriorityHelper(page, request).holdsByPriority({ balance: 0.3, amount: 0.3, arrive: [1, 1] });
  });

  test('wallet 0.6 → priority 1 და 2 (ორივე Fully 0.3) → priority 2-ზე "Request amount from RS" არ ჩანს, API → უარი → priority 1: Request amount → Record manual payment → Executed → priority 2-ზე ღილაკი ჩნდება → გადახდა → Executed (KD-2683)', async ({ page, request }) => {
    await new RsFrontPriorityHelper(page, request).payInPriorityOrder({ balance: 0.6, amount: 0.3 });
  });

  test('wallet 0.6 → priority 1 და 2 → priority 1-ზე Request amount, RS პასუხობს "0" (No amount) → სისტემა თვითონ ეკითხება RS-ს priority 2-ზე (AUTO) → RS asks 0.3, ჩანს "Record manual payment" (5.7.3)', async ({ page, request }) => {
    await new RsFrontPriorityHelper(page, request).zeroAnswerMovesToNext({ balance: 0.6, amount: 0.3 });
  });
});
