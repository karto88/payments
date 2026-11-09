import { APIRequestContext } from '@playwright/test';
import { AuthDevicePage } from '../../../pages/AuthDevicePage';
import { PaymentPage } from '../../../pages/PaymentPage';
import { RsHubApi, RsSimulatorApi, ApiResult } from './RsHubApi';
import { RefundReportsHelper } from '../RefundReportsHelper';
import { assertCondition } from '../../assertions';

const OP_BALANCE = 'GET walletportal /wallet/balances (merchant)';
const OP_CASH_OUT = 'POST walletportal /wallet/cash-out (merchant-ის გატანა)';
const OP_REFUND = 'POST /generic-transaction/refund (merchant-ის refund)';
const OP_SIM_LIEN = 'POST $SIM/orders/lien (RS → ყადაღა)';
const OP_SIM_OBTAIN = 'POST $SIM/orders/obtain-lien (RS → მოხსნა)';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions/{id} (allocations — merchant-ის hold)';
const OP_INT_REFUND = 'POST ecommerce /order/refund (ინტეგრატორის refund)';
const OP_CONFIG ='walletportal /wallet/config (ავტომატური გატანის კონფიგი)';
const WALLETPORTAL = 'https://walletportal.dev.keepz.me/api/v1/wallet';

export type CashOutMode = 'DAILY' | 'WEEKLY' | 'MONTHLY';
type CashOutConfig = { enabled: boolean; cashOutMode: CashOutMode };

/**
 * სატესტო merchant — 599000555 "stromae refund report" (refund-reports-ის merchant):
 *   BALANCE flow (ფული ბალანსზე რჩება), personalNumber 34252525522, RS რეგისტრაცია Approved, MERCHANT:<id> ACTIVE
 */
export const RS_MERCHANT = {
  merchantId: '6f99d426-6042-4b27-addb-33e6fc188c3e',
  phone: '599000555',
  ident: '34252525522',
  iban: 'GE29TB7197445064300124',
  /** ინტეგრატორის ორდერის მიმღები (merchant-ის branch) + ინტეგრატორი — refund-reports-ის მონაცემები */
  receiverId: 'fa14f6c6-a3a4-4563-8eb0-2e4859fa70b9',
  integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
  /** merchant-ის გადახდის ლინკი (პროდუქტი, ფიქსირებული თანხა 0.2 GEL) */
  paymentLink: 'https://www.web.appdev.keepz.me/pay?qrType=CUSTOM&receiverType=BRANCH&receiverId=fa14f6c6-a3a4-4563-8eb0-2e4859fa70b9&productId=a5c58233-5a98-4849-be90-de1cbddefc7a&lng=ka',
};

/** ფული merchant-ზე როგორ შემოდის: add money (TOP_UP) · ინტეგრატორის ორდერი · merchant-ის payment link (ყველა 💳 ბარათი + OTP) */
export type PayVia = 'ADD_MONEY' | 'ORDER' | 'LINK';

/** ⚠️ ბალანსი რეალური ფულია — გატანა ≤ 1 ₾ */
const MAX_AMOUNT = 1;
/** ყადაღის თანხა (ბალანსი − free) — ბალანსი ტესტებს შორის იზრდება (add money), ყადაღა ფულს არ ხარჯავს */
const MAX_LIEN = 5;
const HOLD_TIMEOUT = 30_000;
/** DAILY ჯობი dev-ზე ყოველ ~10 წთ-ში → 12 წთ ლოდინი */
const AUTO_CASH_OUT_TIMEOUT = 12 * 60_000;

const round = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * RS ყადაღა merchant-ზე (payment-service).
 *   📋 merchant-ზე ფული იყინება მხოლოდ BALANCE flow-ზე (ფული ბალანსზე რჩება); STANDARD (instant settlement) — ვერ ყინავს.
 *   📋 გატანა / refund იღებს მხოლოდ თავისუფალს (ბალანსი − გაყინული), თორემ 412 / 2501.
 *   📋 merchant-ის API გაყინულს არ აჩვენებს (known issue #6) → hold ჩანს ყადაღის allocations-ში (MERCHANT:<id>).
 *   ⚠️ merchant-ის ბალანსი სხვა ტესტებიც იყენებს → ყადაღა ითვლება მიმდინარე ბალანსიდან და ტესტის ბოლოს ყოველთვის იხსნება.
 * Docs: RS Integration Test Guide → data.js (HLD-01, HLD-06, HLD-07), api.js (sim-orders-lien)
 */
export class RsMerchantLienHelper {
  private api: RsHubApi;
  private sim: RsSimulatorApi;
  private deviceToken?: string;

  constructor(private request: APIRequestContext) {
    this.api = new RsHubApi(request);
    this.sim = new RsSimulatorApi(request);
  }

  /**
   * ყადაღა ტოვებს `free` თავისუფალს (ყადაღა = ბალანსი − free) → merchant იტანს `cashOut`-ს:
   *   REJECTED → 412 / 2501, ბალანსი უცვლელი · OK → გადის, ბალანსი −cashOut (💸 merchant-ის IBAN-ზე)
   */
  async cashOutWithLien(c: { free: number; cashOut: number; expect: 'OK' | 'REJECTED' }) {
    this.guard(c.cashOut);
    await this.withLien(c.free, async (lien, balance) => {
      const res = await this.cashOut(c.cashOut);
      if (c.expect === 'REJECTED') {
        this.expectRejected(res);
        await this.expectBalance(balance, 'უარის შემდეგ ბალანსი უცვლელია');
        console.log(`✅ Merchant cash-out ${c.cashOut} ₾ rejected (2501) — free ${c.free} ₾`);
      } else {
        assertCondition(OP_CASH_OUT, res.status >= 200 && res.status < 300, `HTTP ${res.status}`, 'HTTP 2xx — თავისუფალი თანხა საკმარისია', res.body);
        await this.expectBalance(round(balance - c.cashOut), `ბალანსი −${c.cashOut}`);
        await this.expectHold(lien.id, round(balance - c.free), 'გაყინული ხელუხლებელია');
        console.log(`✅ Merchant cash-out ${c.cashOut} ₾ OK — held ${round(balance - c.free)} ₾ untouched`);
      }
    });
  }

  /** RS ხსნის ყადაღას → merchant-ის hold RELEASED → მთელი ბალანსი თავისუფალია → გატანა გადის (💸) */
  async withdrawThenCashOut(c: { cashOut: number }) {
    this.guard(c.cashOut);
    const balance = await this.balance();
    const lien = await this.placeLien(0);
    await this.obtain(lien.number);
    await this.expectHold(lien.id, 0, 'მოხსნის შემდეგ merchant-ის hold RELEASED');

    const res = await this.cashOut(c.cashOut);
    assertCondition(OP_CASH_OUT, res.status >= 200 && res.status < 300, `HTTP ${res.status}`, 'HTTP 2xx — ყადაღა მოხსნილია', res.body);
    await this.expectBalance(round(balance - c.cashOut), `ბალანსი −${c.cashOut}`);
    console.log(`✅ Lien withdrawn → merchant cash-out ${c.cashOut} ₾ OK`);
  }

  /** ყადაღა merchant-ის ბალანსზე მეტია (Partially restricted, გაყინულია მთელი ბალანსი) → RS ხსნის → hold RELEASED, მთელი ბალანსი თავისუფალი */
  async withdrawPartialLien() {
    const balance = await this.balance();
    const number = `QA-L-M-${Date.now()}`;
    this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, round(balance + 0.5), number));
    try {
      const r = await this.waitStatus(number, 'PARTIALLY_RESTRICTED');
      await this.expectHold(r.id, balance, 'ყადაღა ბალანსზე მეტია — გაყინულია მთელი ბალანსი');
      await this.obtain(number);
      await this.waitStatus(number, 'WITHDRAWN');
      await this.expectHold(r.id, 0, 'მოხსნის შემდეგ hold RELEASED');
      console.log(`✅ Partially restricted lien (${round(balance + 0.5)} > ${balance}) withdrawn — released`);
    } finally {
      await this.sim.obtainLien(number);
    }
  }

  /** merchant-ზე 2 ყადაღა (0.3 + 0.4) → გაყინულია ჯამი → RS ხსნის პირველს → მეორე (0.4) რჩება გაყინული */
  async twoLiens(c: { first: number; second: number }) {
    const balance = await this.balance();
    assertCondition('ტესტის წინაპირობა', balance >= c.first + c.second, `ბალანსი ${balance}`, `ბალანსი ≥ ${round(c.first + c.second)}`, { balance });
    const n1 = `QA-L-M-${Date.now()}`;
    const n2 = `${n1}B`;
    this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, c.first, n1));
    this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, c.second, n2));
    try {
      const r1 = await this.waitStatus(n1, 'FULLY_RESTRICTED');
      const r2 = await this.waitStatus(n2, 'FULLY_RESTRICTED');
      await this.expectHold(r1.id, c.first, `პირველი ყადაღა — ${c.first}`);
      await this.expectHold(r2.id, c.second, `მეორე ყადაღა — ${c.second}`);
      // ჯამზე 1 თეთრით მეტის გატანა → უარი (თავისუფალი = ბალანსი − ორივე)
      const free = round(balance - c.first - c.second);
      this.expectRejected(await this.cashOut(round(free + 0.01)));

      await this.obtain(n1);
      await this.waitStatus(n1, 'WITHDRAWN');
      await this.expectHold(r1.id, 0, 'პირველი მოიხსნა');
      await this.expectHold(r2.id, c.second, 'მეორე ხელუხლებელია');
      console.log(`✅ Two liens ${c.first} + ${c.second} on merchant → withdraw first → second held`);
    } finally {
      await this.sim.obtainLien(n1);
      await this.sim.obtainLien(n2);
    }
  }

  /** RS იგივე ნომრით მეორედ აგზავნის ყადაღას → code 21, merchant-ზე ფული ორჯერ არ იყინება */
  async duplicateLien(c: { free: number }) {
    await this.withLien(c.free, async (lien, balance) => {
      const res = await this.sim.lien(RS_MERCHANT.ident, round(balance - c.free), lien.number);
      const item = res?.items?.[0];
      assertCondition(OP_SIM_LIEN, String(item?.code) === '21', `code ${item?.code}: ${item?.description}`, 'items[0].code = 21 (ყადაღის ნომერი უკვე არსებობს)', res?.items);
      await sleep(3000);
      await this.expectHold(lien.id, round(balance - c.free), 'გაყინული არ გაორმაგდა');
      console.log('✅ Duplicate merchant lien → code 21');
    });
  }

  /**
   * ყადაღა უკვე ადევს → merchant-ზე შემოდის ახალი ფული (💳 via: add money / ინტეგრატორის ორდერი / payment link) → merchant იტანს:
   *   covered — ყადაღა = ბალანსი (დაფარულია) → ახალი ფული თავისუფალია → გატანა გადის
   *   short   — ყადაღა ბალანსზე მეტია → ახალი ფული ჯერ ყადაღას ავსებს (გაყინული = ახალი ბალანსი) → გატანა უარყოფილია (2501)
   */
  async addMoneyDuringLienThenCashOut(c: { lien: 'covered' | 'short'; topUp: number; cashOut: number; via?: PayVia }) {
    this.guard(c.topUp, c.cashOut);
    const via = c.via ?? 'ADD_MONEY';
    const balance = await this.balance();
    const amount = c.lien === 'covered' ? balance : round(balance + c.topUp + 0.3);
    const number = `QA-L-M-${Date.now()}`;
    this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, amount, number));
    try {
      // short: ბალანსი 0 → PENDING (გასაყინი არაფერია) · ბალანსი > 0 → PARTIALLY_RESTRICTED
      const r = await this.waitStatus(number, c.lien === 'covered' ? 'FULLY_RESTRICTED' : balance > 0 ? 'PARTIALLY_RESTRICTED' : 'PENDING');
      await this.pay(via, c.topUp);
      const after = await this.balance();
      const res = await this.cashOut(c.cashOut);
      if (c.lien === 'covered') {
        assertCondition(OP_CASH_OUT, res.status >= 200 && res.status < 300, `HTTP ${res.status}`, 'HTTP 2xx — ახალი ფული თავისუფალია', res.body);
        await this.expectBalance(round(after - c.cashOut), `ბალანსი −${c.cashOut}`);
      } else {
        await this.expectHold(r.id, after, `ახალმა ფულმა ყადაღა შეავსო — გაყინულია მთელი ბალანსი ${after}`);
        this.expectRejected(res);
        await this.expectBalance(after, 'უარის შემდეგ ბალანსი უცვლელია');
      }
      console.log(`✅ Lien ${amount} (${c.lien}) → ${via} ${c.topUp} → cash-out ${c.cashOut} ${c.lien === 'covered' ? 'OK' : 'rejected'}`);
    } finally {
      await this.sim.obtainLien(number);
    }
  }

  /**
   * ადმინი აკეთებს refund-ს (PUT /transaction/refund), როცა merchant-ის მთელი ბალანსი გაყინულია:
   *   📋 refund გადის (204), მაგრამ გაყინული ფული არ იხარჯება — ბალანსი და hold უცვლელია (refund Keepz-ის ხარჯზე — Over Balance)
   *   💡 merchant-ის refund ამავე სიტუაციაში 2501-ს აგდებს; ადმინისა და ინტეგრატორის refund — Over Balance (დასადასტურებელია დეველოპერთან)
   */
  async adminRefundWithLien(c: { topUp: number; refund: number }) {
    this.guard(c.topUp, c.refund);
    const tx = await this.addMoney(c.topUp);
    await this.withLien(0, async (lien, balance) => {
      const res = await this.request.put('https://newadmin.dev.keepz.me/api/transaction/refund', {
        headers: { Authorization: `Bearer ${await this.api.adminToken()}`, 'Content-Type': 'application/json' },
        data: { amount: c.refund, genericTransactionId: tx },
      });
      const body = await res.json().catch(() => null);
      assertCondition('PUT /api/transaction/refund (ადმინის refund)', res.ok(),
        `HTTP ${res.status()}, code ${body?.statusCode}: ${body?.message}`, 'HTTP 2xx — refund Keepz-ის ხარჯზე (Over Balance)', body);
      await sleep(5000);
      await this.expectBalance(balance, 'გაყინული ფული refund-ში არ წავიდა — ბალანსი უცვლელია');
      await this.expectHold(lien.id, balance, 'გაყინული ხელუხლებელია');
      console.log(`✅ Admin refund ${c.refund} ₾ with whole balance held — balance untouched (Over Balance)`);
    });
  }

  /**
   * merchant-ის flow STANDARD (instant settlement — ფული ბალანსზე არ ჩერდება) → ყადაღა merchant-ზე არ იყინება.
   *   ტესტის ბოლოს flow ბრუნდება BALANCE-ზე.
   */
  async standardFlowCantHold() {
    const flows = new RefundReportsHelper(this.request);
    await flows.updateMerchantFlow('STANDARD');
    let number: string | undefined;
    try {
      number = `QA-L-M-${Date.now()}`;
      this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, 0.5, number));
      await sleep(5000);
      const r = await this.restriction(number);
      const held = (r.allocations || []).filter((a: any) => a.holderRef === `MERCHANT:${RS_MERCHANT.merchantId}`)
        .reduce((s: number, a: any) => s + Number(a.held || 0), 0);
      assertCondition(OP_RESTRICTION, held === 0, `merchant-ზე გაიყინა ${held}`,
        'STANDARD flow-ზე merchant-ზე არაფერი იყინება (instant settlement — "not able to hold")', r);
      console.log(`✅ STANDARD flow — no hold on merchant (status ${r.status})`);
    } finally {
      if (number) await this.sim.obtainLien(number);
      await flows.updateMerchantFlow('BALANCE');
    }
  }

  /** ფიქსირებული ყადაღა (მაგ. 1 ₾) → გატანა: თავისუფალი = ბალანსი − ყადაღა (ან 0) → REJECTED / OK */
  async cashOutFixedLien(c: { lien: number; cashOut: number; expect: 'OK' | 'REJECTED' }) {
    this.guard(c.cashOut);
    const balance = await this.balance();
    const free = round(Math.max(0, balance - c.lien));
    assertCondition('ტესტის წინაპირობა', (c.expect === 'REJECTED') === (c.cashOut > free),
      `ბალანსი ${balance}, ყადაღა ${c.lien} → თავისუფალი ${free}`, `გატანა ${c.cashOut} ${c.expect === 'REJECTED' ? '>' : '≤'} თავისუფალზე`, { balance, free });
    const number = `QA-L-M-${Date.now()}`;
    this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, c.lien, number));
    try {
      const r = await this.poll(async () => {
        const x = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content[0];
        return x && ['FULLY_RESTRICTED', 'PARTIALLY_RESTRICTED'].includes(x.status) ? x : undefined;
      });
      assertCondition(OP_RESTRICTION, !!r, 'ყადაღა არ დაიდო', `ყადაღა ${c.lien} ₾`, r);
      await this.expectHold(r.id, round(Math.min(balance, c.lien)), `merchant-ზე გაიყინა ${round(Math.min(balance, c.lien))}`);

      const res = await this.cashOut(c.cashOut);
      if (c.expect === 'REJECTED') {
        this.expectRejected(res);
        await this.expectBalance(balance, 'უარის შემდეგ ბალანსი უცვლელია');
      } else {
        assertCondition(OP_CASH_OUT, res.status >= 200 && res.status < 300, `HTTP ${res.status}`, 'HTTP 2xx', res.body);
        await this.expectBalance(round(balance - c.cashOut), `ბალანსი −${c.cashOut}`);
      }
      console.log(`✅ Lien ${c.lien} ₾ (balance ${balance}, free ${free}, ${r.status}) → cash-out ${c.cashOut} ₾ ${c.expect}`);
    } finally {
      await this.sim.obtainLien(number);
    }
  }

  // ─── refund ყადაღის დროს (refund-იც merchant-ის ბალანსიდან იჭრება) ───

  /**
   * add money (ბარათით, 💳 რეალური) → ყადაღა ტოვებს `free` თავისუფალს → merchant ცდილობს refund-ს:
   *   REJECTED → 412 / 2501, ბალანსი უცვლელი (refund + საკომისიო > თავისუფალი)
   *   OK       → გადის, ბალანსი მცირდება ≥ refund-ით, გაყინული ხელუხლებელი
   */
  async refundWithLien(c: { topUp: number; free: number; refund: number; expect: 'OK' | 'REJECTED' }) {
    this.guard(c.topUp, c.refund);
    const tx = await this.addMoney(c.topUp);
    await this.withLien(c.free, async (lien, balance) => {
      const res = await this.refund(tx, c.refund);
      if (c.expect === 'REJECTED') {
        this.expectRefundRejected(res);
        await this.expectBalance(balance, 'უარის შემდეგ ბალანსი უცვლელია');
        console.log(`✅ Merchant refund ${c.refund} ₾ rejected (2501) — free ${c.free} ₾`);
      } else {
        this.expectRefundOk(res);
        await this.expectBalanceBelow(balance, c.refund);
        await this.expectHold(lien.id, round(balance - c.free), 'გაყინული ხელუხლებელია');
        console.log(`✅ Merchant refund ${c.refund} ₾ OK — held untouched`);
      }
    });
  }

  /**
   * 💳 მიმღების საკომისიო + სრული refund ყადაღის დროს:
   *   📋 add money 0.2 → merchant-ს ერიცხება 0.19 (receiver commission 0.01). სრული refund-ისას მყიდველს ბრუნდება მთელი 0.2 →
   *      merchant-ს ეჭრება 0.2 (საკომისიოც მისი ხარჯია), არა 0.19
   *   free 'credited' — თავისუფალია მხოლოდ ჩარიცხული (0.19) → სრული refund 0.2 → უარი (2501), ბალანსი უცვლელი
   *   free 'payment'  — თავისუფალია სრული თანხა (0.2) → სრული refund გადის, ბალანსი −0.2 (ზუსტად), გაყინული ხელუხლებელი
   */
  async fullRefundWithReceiverCommission(c: { topUp: number; free: 'credited' | 'payment' }) {
    this.guard(c.topUp);
    const before = await this.balance();
    const tx = await this.addMoney(c.topUp);
    const credited = round((await this.balance()) - before);
    assertCondition(OP_BALANCE, credited > 0 && credited < c.topUp, `ჩაირიცხა ${credited}`,
      `ჩაირიცხა ${c.topUp}-ზე ნაკლები (მიმღების საკომისიო)`, { before, credited, topUp: c.topUp });
    const free = c.free === 'credited' ? credited : c.topUp;
    await this.withLien(free, async (lien, balance) => {
      const res = await this.refund(tx, c.topUp);
      if (c.free === 'credited') {
        this.expectRefundRejected(res);
        await this.expectBalance(balance, 'უარის შემდეგ ბალანსი უცვლელია');
        console.log(`✅ Full refund ${c.topUp} ₾ rejected (2501) — free only credited ${credited} ₾ (receiver commission ${round(c.topUp - credited)})`);
      } else {
        this.expectRefundOk(res);
        await this.expectBalance(round(balance - c.topUp), `სრული refund — ეჭრება მთელი ${c.topUp} (არა ჩარიცხული ${credited})`);
        await this.expectHold(lien.id, round(balance - free), 'გაყინული ხელუხლებელია');
        console.log(`✅ Full refund ${c.topUp} ₾ OK — merchant charged full ${c.topUp} (credited was ${credited}), held untouched`);
      }
    });
  }

  /** add money (💳) → ყადაღა მთელ ბალანსზე → RS ხსნის → refund გადის */
  async withdrawThenRefund(c: { topUp: number; refund: number }) {
    this.guard(c.topUp, c.refund);
    const tx = await this.addMoney(c.topUp);
    const lien = await this.placeLien(0);
    await this.obtain(lien.number);
    await this.expectHold(lien.id, 0, 'მოხსნის შემდეგ merchant-ის hold RELEASED');
    const balance = await this.balance();
    this.expectRefundOk(await this.refund(tx, c.refund));
    await this.expectBalanceBelow(balance, c.refund);
    console.log(`✅ Lien withdrawn → merchant refund ${c.refund} ₾ OK`);
  }

  /**
   * ყადაღა უკვე ადევს → add money (💳) → refund ამ ახალი ფულიდან:
   *   covered — ყადაღა მთლიანად დაფარულია (= ბალანსი) → ახალი ფული თავისუფალია → refund გადის
   *   short   — ყადაღა ბალანსზე მეტია (აკლია) → ახალი ფული ჯერ ყადაღას ავსებს → refund უარყოფილია (2501)
   */
  async addMoneyDuringLienThenRefund(c: { lien: 'covered' | 'short'; topUp: number; refund: number }) {
    this.guard(c.topUp, c.refund);
    const balance = await this.balance();
    const amount = c.lien === 'covered' ? balance : round(balance + c.topUp + 0.3);
    const number = `QA-L-M-${Date.now()}`;
    this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, amount, number));
    try {
      await sleep(5000);
      const tx = await this.addMoney(c.topUp);
      const after = await this.balance();
      const res = await this.refund(tx, c.refund);
      if (c.lien === 'covered') {
        this.expectRefundOk(res);
        await this.expectBalanceBelow(after, c.refund);
      } else {
        this.expectRefundRejected(res);
        await this.expectBalance(after, 'უარის შემდეგ ბალანსი უცვლელია');
      }
      console.log(`✅ Lien ${amount} (${c.lien}) → add money ${c.topUp} → refund ${c.refund} ${c.lien === 'covered' ? 'OK' : 'rejected'}`);
    } finally {
      await this.sim.obtainLien(number);
    }
  }

  // ─── ინტეგრატორის refund ყადაღის დროს (encrypt → ecommerce /order/refund; ფული merchant-ის ბალანსიდან) ───

  /**
   * 💳 ინტეგრატორის ორდერით გადახდა merchant-ზე → ყადაღა ტოვებს `free` თავისუფალს → ინტეგრატორი აკეთებს refund-ს:
   *   OK      — თავისუფალი საკმარისია → REFUND_REQUESTED → PARTIALLY_REFUNDED, ბალანსი მცირდება, გაყინული ხელუხლებელი
   *   BLOCKED — თავისუფალი არ არის → გაყინული ფული refund-ში არ უნდა წავიდეს: ბალანსი და გაყინული უცვლელია
   *             (💡 სხვა endpoint-ია, ვიდრე merchant-ის refund — ბექმა შეიძლება ბალანსის შემოწმება გამოტოვოს;
   *              ლოგში ვწერთ რა მოხდა: უარი, თუ refund Keepz-ის ხარჯზე — OVER_BALANCE)
   */
  async integratorRefundWithLien(c: { pay: number; free: number; refund: number; expect: 'OK' | 'BLOCKED' }) {
    this.guard(c.pay, c.refund);
    const reports = new RefundReportsHelper(this.request);
    const order = await reports.payAndWaitSuccess({ amount: c.pay, currency: 'GEL', receiverId: RS_MERCHANT.receiverId, integratorId: RS_MERCHANT.integratorId });
    console.log(`✅ Integrator order ${c.pay} ₾ paid to merchant — tx ${order.transactionId}`);
    await this.withLien(c.free, async (lien, balance) => {
      const res = await reports.integratorRefund(order.accessToken, RS_MERCHANT.integratorId, order.integratorOrderId, c.refund);
      const status = await this.orderStatusAfterRefund(order.accessToken, order.integratorOrderId, c.expect === 'OK');
      if (c.expect === 'OK') {
        assertCondition(OP_INT_REFUND, res.ok && res.result?.status === 'REFUND_REQUESTED',
          `HTTP ${res.status}, status ${res.result?.status}`, 'HTTP 200 + REFUND_REQUESTED', res.result ?? res.body);
        assertCondition(OP_INT_REFUND, status.includes('REFUNDED'), `ორდერის status ${status}`, 'PARTIALLY_REFUNDED / REFUNDED', { status });
        await this.expectBalanceBelow(balance, c.refund);
        await this.expectHold(lien.id, round(balance - c.free), 'გაყინული ხელუხლებელია');
        console.log(`✅ Integrator refund ${c.refund} ₾ OK (${status}) — held untouched`);
      } else {
        await this.expectBalance(balance, 'გაყინული ფული refund-ში არ წავიდა — ბალანსი უცვლელია');
        await this.expectHold(lien.id, balance, 'გაყინული ხელუხლებელია');
        console.log(`✅ Integrator refund ${c.refund} ₾ with whole balance held — balance untouched `
          + `(refund: HTTP ${res.status}, ${res.result?.status ?? res.body?.message}; order status ${status})`);
      }
    });
  }

  /** refund-ის შემდეგ ორდერის status: OK → ველოდებით *REFUNDED-ს (~1 წთ) · BLOCKED → 30 წმ-ში ვნახავთ, რა მოხდა */
  private async orderStatusAfterRefund(accessToken: string, integratorOrderId: string, waitRefunded: boolean): Promise<string> {
    const page = new PaymentPage(this.request, null as any);
    let status = '';
    for (let i = 0; i < (waitRefunded ? 20 : 10) && !status.includes('REFUNDED'); i++) {
      await sleep(3000);
      status = (await page.getOrderStatus(accessToken, RS_MERCHANT.integratorId, integratorOrderId))?.status ?? '';
    }
    return status;
  }

  // ─── ავტომატური გატანა (cash-out ჯობი) ყადაღის დროს ───

  /**
   * ⏰ ყადაღა ტოვებს `free` თავისუფალს → ვრთავთ ავტომატურ გატანას (DAILY; dev-ზე ჯობი ყოველ ~10 წთ-ში) → ველოდებით ჯობს:
   *   📋 ჯობმა უნდა გაიტანოს მხოლოდ თავისუფალი (free > 0 → ბალანსი = გაყინული) · free 0 → არაფერი გადის
   *   💡 ჯობი API-ს (/cash-out, 2501) გვერდს უვლის — თუ held-ს არ ითვალისწინებს, გაყინულსაც გაიტანს
   *   ტესტის ბოლოს: ჯერ ვაბრუნებთ ძველ კონფიგს (რომ მოხსნის შემდეგ ჯობმა ფული არ გაიტანოს) → მერე ვხსნით ყადაღას
   */
  async autoCashOutWithLien(c: { free: number; mode: CashOutMode }) {
    this.guard(c.free);
    const before = await this.cashOutConfig();
    const balance = await this.balance();
    const lien = await this.placeLien(c.free, balance);
    const held = round(balance - c.free);
    try {
      await this.setCashOutConfig({ enabled: true, cashOutMode: c.mode });
      if (c.free > 0) {
        await this.expectBalance(held, `ჯობმა გაიტანა მხოლოდ თავისუფალი ${c.free} ₾ — დარჩა გაყინული ${held} ₾`, AUTO_CASH_OUT_TIMEOUT);
      } else {
        await sleep(AUTO_CASH_OUT_TIMEOUT);
        await this.expectBalance(balance, `${AUTO_CASH_OUT_TIMEOUT / 60_000} წთ-ში ჯობმა გაყინული ფული არ გაიტანა`);
      }
      await this.expectHold(lien.id, held, 'ჯობის შემდეგ გაყინული ხელუხლებელია');
      console.log(`✅ Auto cash-out (${c.mode}) with lien ${held} ₾ — ${c.free > 0 ? `only free ${c.free} ₾ went out` : 'nothing went out'}`);
    } finally {
      await this.setCashOutConfig(before);
      await this.sim.obtainLien(lien.number);
    }
  }

  /**
   * ⏰ მთელი ბალანსი გაყინულია → ვრთავთ ავტომატურ გატანას → RS ხსნის ყადაღას → ჯობი გაიტანს მთელ ბალანსს (ბალანსი 0)
   *   💸 merchant-ის მთელი ბალანსი გადის მის IBAN-ზე → შემდეგი ტესტებისთვის ბალანსი ხელახლა შესავსებია (add money)
   */
  async autoCashOutAfterWithdraw(c: { mode: CashOutMode }) {
    const before = await this.cashOutConfig();
    const balance = await this.balance();
    const lien = await this.placeLien(0, balance);
    try {
      await this.setCashOutConfig({ enabled: true, cashOutMode: c.mode });
      await this.obtain(lien.number);
      await this.expectHold(lien.id, 0, 'მოხსნის შემდეგ merchant-ის hold RELEASED');
      await this.expectBalance(0, `ყადაღა მოხსნილია — ჯობმა გაიტანა მთელი ბალანსი ${balance} ₾`, AUTO_CASH_OUT_TIMEOUT);
      console.log(`✅ Auto cash-out (${c.mode}) after lien withdrawn — whole balance ${balance} ₾ went out`);
    } finally {
      await this.setCashOutConfig(before);
      await this.sim.obtainLien(lien.number);
    }
  }

  /** ავტომატური გატანის კონფიგი (merchant-ის device token): GET /wallet/config → { enabled, cashOutMode } */
  private async cashOutConfig(): Promise<CashOutConfig> {
    const res = await this.request.get(`${WALLETPORTAL}/config`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    const body = await res.json().catch(() => ({}));
    assertCondition(OP_CONFIG, res.ok() && !!body.value, `HTTP ${res.status()}`, 'HTTP 200 + value { enabled, cashOutMode }', body);
    return { enabled: body.value.enabled, cashOutMode: body.value.cashOutMode };
  }

  /** PUT /wallet/config { enabled, cashOutMode } → GET-ით ვამოწმებთ, რომ შეიცვალა */
  private async setCashOutConfig(config: CashOutConfig) {
    const res = await this.request.put(`${WALLETPORTAL}/config`, {
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      data: config,
    });
    assertCondition(OP_CONFIG, res.ok(), `PUT HTTP ${res.status()}`, `HTTP 2xx — ${JSON.stringify(config)}`, await res.text());
    const now = await this.cashOutConfig();
    assertCondition(OP_CONFIG, now.enabled === config.enabled && now.cashOutMode === config.cashOutMode,
      `კონფიგი ${JSON.stringify(now)}`, `კონფიგი ${JSON.stringify(config)}`, now);
  }

  // ─── შიდა ───

  /** add money ბარათით (refund-reports-ის flow: payment link → TBC ბარათი → OTP) → TOP_UP ტრანზაქციის id */
  private async addMoney(amount: number): Promise<number> {
    const tx = await new RefundReportsHelper(this.request).addMoneyTopUp(RS_MERCHANT.phone, amount, 'GEL');
    console.log(`✅ Add money ${amount} ₾ — tx ${tx}`);
    return tx;
  }

  /** ფული merchant-ზე (💳): add money · ინტეგრატორის ორდერი (branch receiver) · merchant-ის payment link (თანხა ფიქსირებულია — 0.2) */
  private async pay(via: PayVia, amount: number) {
    const reports = new RefundReportsHelper(this.request);
    if (via === 'ADD_MONEY') return this.addMoney(amount);
    if (via === 'ORDER') {
      const { transactionId } = await reports.payAndWaitSuccess({ amount, currency: 'GEL', receiverId: RS_MERCHANT.receiverId, integratorId: RS_MERCHANT.integratorId });
      console.log(`✅ Integrator order ${amount} ₾ paid to merchant — tx ${transactionId}`);
      return transactionId;
    }
    // BALANCE flow → ტრანზაქცია COLLECTED-ზე ჩერდება (ფული ბალანსზეა)
    const tx = await reports.payPaymentLink({ phone: RS_MERCHANT.phone, paymentLink: RS_MERCHANT.paymentLink, amount, currency: 'GEL' }, 'COLLECTED');
    console.log(`✅ Payment link ${amount} ₾ paid — tx ${tx}`);
    return tx;
  }

  /** merchant-ის refund (device token): POST /generic-transaction/refund { amount, genericTransactionId } */
  private async refund(transactionId: number, amount: number): Promise<ApiResult> {
    const res = await this.request.post('https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/refund', {
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      data: { amount, genericTransactionId: transactionId },
    });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status(), body, value: body?.value };
  }

  private expectRefundRejected(res: ApiResult) {
    assertCondition(OP_REFUND, res.status === 412 && res.body?.statusCode === 2501,
      `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`, 'HTTP 412 / code 2501 "Insufficient balance for this operation"', res.body);
  }

  private expectRefundOk(res: ApiResult) {
    assertCondition(OP_REFUND, res.status >= 200 && res.status < 300, `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`,
      'HTTP 2xx — refund გავიდა', res.body);
  }

  /** refund-ის შემდეგ ბალანსი მცირდება მინიმუმ refund-ის თანხით (+ საკომისიო) */
  private async expectBalanceBelow(before: number, refund: number) {
    let last = before;
    const ok = await this.poll(async () => { last = await this.balance(); return last <= round(before - refund) ? last : undefined; });
    assertCondition(OP_BALANCE, ok !== undefined, `ბალანსი ${before} → ${last}`, `ბალანსი ≤ ${round(before - refund)} (−${refund} + საკომისიო)`, { before, after: last });
  }

  /** ყადაღა (ბალანსი − free) → fn → ყადაღა ყოველთვის იხსნება (ჩავარდნის შემთხვევაშიც) */
  private async withLien(free: number, fn: (lien: { id: string; number: string }, balance: number) => Promise<void>) {
    const balance = await this.balance();
    const lien = await this.placeLien(free, balance);
    try {
      await fn(lien, balance);
    } finally {
      await this.sim.obtainLien(lien.number);
    }
  }

  /** RS აგზავნის ყადაღას merchant-ის ident-ზე → merchant-ზე იყინება ბალანსი − free */
  private async placeLien(free: number, balance?: number) {
    const b = balance ?? await this.balance();
    const amount = round(b - free);
    // ყადაღა ფულს არ გადარიცხავს (მხოლოდ ყინავს) → ზედა ზღვარი მხოლოდ შეცდომისგან დაცვაა
    assertCondition('ტესტის წინაპირობა', amount > 0 && amount <= MAX_LIEN,
      `merchant-ის ბალანსი ${b} ₾ — ყადაღა ${amount} ₾ ვერ დაიდება`, `ბალანსი > ${free} ₾ (merchant 599000555)`, { balance: b, free });
    const number = `QA-L-M-${Date.now()}`;
    this.expectAccepted(await this.sim.lien(RS_MERCHANT.ident, amount, number));
    const r = await this.poll(async () => {
      const x = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content[0];
      return x && x.status === 'FULLY_RESTRICTED' ? x : undefined;
    });
    assertCondition(OP_RESTRICTION, !!r, 'ყადაღა FULLY_RESTRICTED არ გახდა', `FULLY_RESTRICTED, restricted ${amount}`, r);
    await this.expectHold(r.id, amount, `merchant-ზე გაიყინა ${amount}`);
    console.log(`✅ Lien ${amount} ₾ on merchant ${RS_MERCHANT.phone} — balance ${b} / free ${free}`);
    return { id: r.id as string, number };
  }

  /** ყადაღის სტატუსის მოლოდინი (rsNumber) → restriction */
  private async waitStatus(number: string, status: string): Promise<any> {
    let last: any;
    const r = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content[0];
      return last?.status === status ? last : undefined;
    });
    assertCondition(OP_RESTRICTION, !!r, last ? `status ${last.status}` : 'ყადაღა არ არსებობს', `status ${status}`, last);
    return r;
  }

  private async obtain(number: string) {
    this.expectAccepted(await this.sim.obtainLien(number), OP_SIM_OBTAIN);
  }

  private async restriction(number: string): Promise<any> {
    const x = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content[0];
    const d = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(x.id));
    return { ...x, allocations: d.allocations || d.restriction?.allocations || [] };
  }

  /** merchant-ის hold = ყადაღის allocation MERCHANT:<id> (merchant API გაყინულს არ აჩვენებს) */
  private async expectHold(restrictionId: string, held: number, why: string) {
    let last: any;
    const ok = await this.poll(async () => {
      const d = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(restrictionId));
      last = (d.allocations || d.restriction?.allocations || []).find((a: any) => a.holderRef === `MERCHANT:${RS_MERCHANT.merchantId}`);
      return last && round(Number(last.held)) === round(held) ? last : undefined;
    });
    assertCondition(OP_RESTRICTION, !!ok, last ? `merchant held ${last.held} (${last.status})` : 'merchant-ის allocation არ არის',
      `merchant held ${round(held)} — ${why}`, last);
  }

  private async token(): Promise<string> {
    if (!this.deviceToken) this.deviceToken = await new AuthDevicePage(this.request).authenticate(RS_MERCHANT.phone);
    return this.deviceToken;
  }

  private async balance(): Promise<number> {
    const res = await this.request.get(`${WALLETPORTAL}/balances`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    const body = await res.json().catch(() => ({}));
    assertCondition(OP_BALANCE, res.ok(), `HTTP ${res.status()}`, 'HTTP 200', body);
    return round((body.value || []).find((b: any) => b.currency === 'GEL')?.amount ?? 0);
  }

  private async expectBalance(amount: number, why: string, timeout = HOLD_TIMEOUT) {
    let last = 0;
    const ok = await this.poll(async () => { last = await this.balance(); return last === round(amount) ? last : undefined; }, timeout);
    assertCondition(OP_BALANCE, ok !== undefined, `ბალანსი ${last}`, `ბალანსი ${round(amount)} — ${why}`, { balance: last });
  }

  private async cashOut(amount: number): Promise<ApiResult> {
    const res = await this.request.post(`${WALLETPORTAL}/cash-out?merchantId=${RS_MERCHANT.merchantId}`, {
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      data: { amount: amount.toFixed(2), currencyCode: 'GEL', iban: RS_MERCHANT.iban },
    });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status(), body, value: body?.value };
  }

  private guard(...amounts: number[]) {
    assertCondition('ტესტის კონფიგი', amounts.every((a) => a <= MAX_AMOUNT),
      `თანხა > ${MAX_AMOUNT} ₾: ${amounts.join(', ')}`, `ყველა თანხა ≤ ${MAX_AMOUNT} ₾ (რეალური ფული)`, amounts);
  }

  private expectAccepted(res: any, op = OP_SIM_LIEN) {
    const item = res?.items?.[0];
    assertCondition(op, res?.accepted === true && item?.code === null,
      `code ${item?.code}: ${item?.description}`, 'accepted: true, items[0].code = null (მიღებულია)', res?.items);
  }

  private expectRejected(res: ApiResult) {
    assertCondition(OP_CASH_OUT, res.status === 412 && res.body?.statusCode === 2501,
      `HTTP ${res.status}, code ${res.body?.statusCode}`, 'HTTP 412 / code 2501 "Insufficient balance for this operation"', res.body);
  }

  private async poll<T>(fn: () => Promise<T | undefined>, timeout = HOLD_TIMEOUT): Promise<T | undefined> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const v = await fn();
      if (v !== undefined) return v;
      await sleep(2000);
    }
    return undefined;
  }
}
