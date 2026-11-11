import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { RsFrontHelper, Ctx } from './RsFrontHelper';
import { TRANSFER_TO } from '../RsLienHelper';
import { RsHubApi, digits, date } from '../RsHubApi';
import { RsBusinessHelper } from '../RsBusinessHelper';
import { RsClientHelper } from '../RsClientHelper';
import { assertCondition, assertField } from '../../../assertions';

const OP_HEAD = 'UI RS registration — სათაური + Data';
const OP_WALLETS = 'UI RS registration — Wallets';
const OP_FIELDS = 'UI RS registration — Field changes';
const OP_MSG = 'UI RS registration — RS messages';
const OP_HIST = 'UI RS registration — History';
const OP_RESTR = 'UI Liens & collections — ფანჯარა';
const OP_BIZ = 'UI Dist. Businesses — Wallet clients';
const OP_REG = 'GET /api/v1/rs/registrations/{id}';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions/{id}';

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `₾ ${n.toFixed(2)}`;
/** API ISO → UI "10 Nov 2026, 12:23" (თბილისის დრო) */
const dateTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tbilisi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
/** API ISO → UI "10 Nov 2026" */
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tbilisi', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));

interface Wallets { ctx: Ctx; wallets: { clientId: string; name: string; balance: number }[] }

/** ინკასო 2 დღეში: დღე 1 აქ ინახავს მონაცემებს, დღე 2 კითხულობს (ლოკალური ფაილი, git-ში არ მიდის) */
const STATE_FILE = path.join(process.cwd(), 'test-data', 'rs-collection-day2.json');
interface Day2State extends Wallets { day: string; number: string; restrictionId: string; amount: number; paid: number; held: Record<string, number>; executed: Record<string, number> }
/** დღევანდელი თარიღი თბილისის დროით (2026-11-10) */
const tbilisiDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date());
/** "₾ 0.40" → 0.4 */
const parseMoney = (s: string) => Number((s || '').replace(/[^\d.]/g, '')) || 0;
/** PARTIALLY_EXECUTED → "Partially executed" */
const uiLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * RS ფრონტი — რეგისტრაციის გვერდის ტაბების მონაცემები (UI ↔ API):
 *   სათაური + Data · Wallets (რამდენიმე wallet) · Field changes · RS messages · History
 *   Liens & collections — ყადაღა / ინკასო რამდენიმე wallet-ზე: ვის რამდენი გაეყინა, გადახდის შემდეგ ვის რამდენი ჩამოეჭრა
 */
export class RsFrontTabsHelper extends RsFrontHelper {
  // ─── სათაური + Data ───

  /** Approved რეგისტრაცია: სათაურის ყველა ველი + Data ↔ API; "Sent to RS" ნიშანი გაგზავნილ ველებზე, ალტ. ნომერი "-" */
  async headerAndData() {
    const ctx = await this.prepare(0);
    const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(ctx.regId));
    const r = v.registration;
    await this.ui.openRegistration(ctx.regId);
    const t = await this.ui.pageText();
    const need = [
      `${r.data.ownerFullName} | Approved`, 'Partner | keepz', 'Client number | -', 'Approved by | Honest taxpayer',
      `First submitted | ${dateTime(r.firstSubmittedAt)}`, `Last submitted | ${dateTime(r.lastSubmittedAt)}`, `Approved | ${dateTime(r.approvedAt)}`,
      'Resubmit allowed | No', `Registration ID | ${r.id}`,
      'Residency status | Resident', `Owner full name | ${r.data.ownerFullName} | Sent to RS`, `Owner identification number | ${r.data.identNumber} | Sent to RS`,
      'Alternative personal number | - |', `Operation date | ${day(r.data.operDate)} | Sent to RS`, `Known date | ${day(r.data.knownDate)} | Sent to RS`,
    ];
    const miss = need.filter((x) => !t.includes(x));
    assertCondition(OP_HEAD, miss.length === 0, `UI-ში არ ჩანს: ${miss.join(' · ')}`, 'სათაური და Data = API (registration)', t.slice(0, 1500));
    console.log('✅ Header + Data = API');
  }

  // ─── Wallets ───

  /** ბიზნესზე 3 wallet (1 UI-დან + 2 Link clients-ით) → Wallets ტაბზე 3 მწკრივი = API enrollments; ბიზნესის გვერდზე 3 wallet ბალანსით */
  async threeWallets() {
    const w = await this.prepareWallets([0.2, 0.5, 0.3]);
    const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(w.ctx.regId));
    await this.ui.openRegistration(w.ctx.regId);
    assertCondition(OP_WALLETS, (await this.ui.tabCount('Wallets')) === 3, `Wallets ${await this.ui.tabCount('Wallets')}`, 'Wallets 3', null);
    await this.ui.openTab('Wallets');
    const rows = (await this.ui.tabRows()).map((r) => r.join(' | '));
    for (const e of v.enrollments) {
      const line = rows.find((x) => x.includes(e.holderRef)) || '';
      const exp = [e.holderName, e.integrator, e.holderRef, e.accountsOpen ? 'Yes' : 'No', 'Active', day(e.enrolledAt)];
      const miss = exp.filter((x) => !line.includes(x));
      assertCondition(OP_WALLETS, miss.length === 0, `მწკრივი: ${line || 'არ ჩანს'}${miss.length ? ` · აკლია: ${miss.join(', ')}` : ''}`, exp.join(' | '), e);
    }
    assertCondition(OP_WALLETS, rows.length === 3, `${rows.length} მწკრივი`, '3 მწკრივი', rows);
    console.log('✅ Wallets tab — 3 rows = API enrollments');
  }

  // ─── Liens & collections — რამდენიმე wallet ───

  /**
   * 3 wallet (0.2 / 0.5 / 0.3) → ყადაღა 0.6 → ჯერ ყველაზე დიდი: 0.5-იანი მთლიანად, 0.3-იანზე 0.1, 0.2-იანი თავისუფალი
   *   UI: მწკრივი, Holds per wallet (თითო wallet-ის Target / Held) = API allocations; ბიზნესის გვერდზე თითო wallet-ის ბალანსი
   */
  async lienAcrossWallets(c: { lien: number }) {
    const w = await this.prepareWallets([0.2, 0.5, 0.3]);
    const number = `QA-L-UI-${Date.now()}`;
    const res = await this.sim.lien(w.ctx.ident, c.lien, number);
    assertCondition('POST $SIM/orders/lien', res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია', res?.items);
    try {
      const expected = this.largestFirst(w.wallets, c.lien);
      const d = await this.waitAllocations(number, expected);
      await this.expectOverview(w.ctx, number, { status: 'Fully restricted', requested: c.lien, restricted: c.lien, remaining: c.lien });
      await this.expectHolds(w, d, expected, {});
      await this.ui.closeModal();
      await this.expectBusinessBalances(w, expected, {});
      console.log(`✅ Lien ${c.lien} across 3 wallets — ${w.wallets.map((x) => `${x.balance}→held ${expected[x.clientId] || 0}`).join(', ')}`);
    } finally {
      await this.sim.obtainLien(number);
    }
  }

  /**
   * Reallocate holds UI-დან (hub wallet-ები, SMS არ სჭირდება):
   *   wallet A `first` ₾ → ყადაღა / ინკასო `amount` > A → A მთლიანად, Partially restricted (აკლია) →
   *   ბიზნესს UI-დან ებმის ახალი wallet B `second` ₾ (B > A) → მიბმისთანავე B-ზე არაფერი იყინება (Reallocate-მდე) →
   *   UI: ფანჯარა → "Reallocate holds" (ჩანს მხოლოდ Partially restricted-ზე) → Reallocate → ჯერ B (მეტი აქვს), დანარჩენი A-ზე →
   *   UI: Overview / Holds per wallet / ბიზნესის გვერდი = API → A-ს გაუთავისუფლდა ნაწილი → გადარიცხავს `transfer`-ს ✅
   */
  async reallocateWalletAddedLater(c: { kind: 'LIEN' | 'COLLECTION'; first: number; amount: number; second: number; transfer: number }) {
    this.guard(c.amount, c.second, c.transfer);
    const w = await this.prepareWallets([c.first]);
    const a = w.wallets[0];
    const number = `QA-${c.kind === 'LIEN' ? 'L' : 'C'}-UI-RA-${Date.now()}`;
    const res = c.kind === 'LIEN' ? await this.sim.lien(w.ctx.ident, c.amount, number) : await this.sim.collection(w.ctx.ident, c.amount, number);
    assertCondition(`POST $SIM/orders/${c.kind.toLowerCase()}`, res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია', res?.items);
    try {
      assertCondition('ტესტის კონფიგი', c.amount > c.first && c.second > c.first && round(c.first - Math.max(0, c.amount - c.second)) >= c.transfer,
        JSON.stringify(c), `ყადაღა > A, B > A, Reallocate-ის შემდეგ A-ს თავისუფალი ≥ ${c.transfer}`, c);
      const before = { [a.clientId]: c.first };
      await this.waitAllocations(number, before);
      await this.expectOverview(w.ctx, number, { status: 'Partially restricted', requested: c.amount, restricted: c.first, remaining: c.amount });
      await this.ui.closeModal();

      w.wallets.push(await this.linkNewWallet(w.ctx, c.second));
      await this.expectAllEnrolled(w);
      await this.waitAllocations(number, before);
      console.log(`ℹ️ ${w.wallets[1].name} (${c.second}) linked → before Reallocate held only on ${a.name} (${c.first})`);

      await this.expectOverview(w.ctx, number, { status: 'Partially restricted', requested: c.amount, restricted: c.first, remaining: c.amount });
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_RESTR, buttons.includes('Reallocate holds'), `ღილაკები: ${buttons.join(' · ')}`, 'ღილაკი "Reallocate holds" (Partially restricted)', buttons);
      const status = await this.ui.reallocateHolds();
      assertCondition(`${OP_RESTR} — Reallocate holds (POST …/reallocate)`, status >= 200 && status < 300, `HTTP ${status}`, 'HTTP 2xx', null);
      await this.ui.closeModal();

      const after = this.largestFirst(w.wallets, c.amount);
      const total = round(Object.values(after).reduce((x, y) => x + y, 0));
      const d = await this.waitAllocations(number, after);
      await this.expectOverview(w.ctx, number, { status: total >= c.amount ? 'Fully restricted' : 'Partially restricted', requested: c.amount, restricted: total, remaining: c.amount });
      await this.expectHolds(w, d, after, {});
      await this.ui.closeModal();
      await this.expectBusinessBalances(w, after, {});

      // A-ს ნაწილი გათავისუფლდა → გადარიცხვა გადის
      const t = await this.dist.transfer(await this.dist.token(w.ctx.wallet.clientId, w.ctx.wallet.clientSecret), { amount: c.transfer, uniqueId: randomUUID(), ...TRANSFER_TO });
      assertCondition('POST distributor /api/distributor/ (wallet-ის გადარიცხვა)', t.status >= 200 && t.status < 300, `HTTP ${t.status}, code ${t.body?.statusCode}`,
        `HTTP 2xx — ${a.name}: Reallocate-ის შემდეგ held ${after[a.clientId] || 0} / ${c.first}, თავისუფალი ≥ ${c.transfer}`, t.body);
      console.log(`✅ ${c.kind} ${c.amount}: Reallocate holds → ${Object.entries(after).map(([id, h]) => `${w.wallets.find((x) => x.clientId === id)?.name} ${h}`).join(', ')}; ${a.name} transferred ${c.transfer}`);
    } finally {
      await (c.kind === 'LIEN' ? this.sim.obtainLien(number) : this.sim.obtainCollection(number)).catch(() => undefined);
    }
  }

  /**
   * 3 wallet (0.2 / 0.5 / 0.3) → ინკასო 0.6 → Request amount → ადმინი აფიქსირებს `pay`-ს (სრული ან ნაწილობრივი)
   *   UI: მწკრივი (Requested / Restricted / Remaining / Executed), Holds per wallet (Executed თითო wallet-ზე),
   *       Executions (Completed, Accomplished, MANUAL PAYMENT; TRANSFERS — თითო wallet-ის ჩამოჭრა) = API; ბიზნესის გვერდზე ბალანსები
   */
  async collectionAcrossWallets(c: { amount: number; pay: number }) {
    const w = await this.prepareWallets([0.2, 0.5, 0.3]);
    const number = `QA-C-UI-${Date.now()}`;
    const res = await this.sim.collection(w.ctx.ident, c.amount, number);
    assertCondition('POST $SIM/orders/collection', res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია', res?.items);
    let done = false;
    try {
      const held = this.largestFirst(w.wallets, c.amount);
      const d0 = await this.waitAllocations(number, held);
      const d = await this.requestAndPay(w.ctx, number, d0.restriction.id, c.pay, c.pay);
      done = c.pay >= c.amount;
      const executed = await this.expectPaidUi(w, number, d, { amount: c.amount, held, executedTotal: c.pay, executions: 1 });
      console.log(`✅ Collection ${c.amount} paid ${c.pay} across wallets — ${w.wallets.map((x) => `${x.name}: −${executed[x.clientId] || 0}`).join(', ')}`);
    } finally {
      if (!done) await this.sim.obtainCollection(number);
    }
  }

  /**
   * ინკასოს ხელით გადახდა (ხელით რეჟიმი) — UI + API:
   *   wallet `balance` → ინკასო `amount` → UI: Request amount from RS → Executions: Amount received · Manual · RS answer · "Treasury payments are manual…" →
   *   ადმინი აფიქსირებს გადახდას `pay` bankReference-ით UI-დან (Record manual payment) →
   *   UI: Overview Executed `pay`, Executions: Completed · Accomplished · MANUAL PAYMENT (**ჩვენი bankReference**) · TRANSFERS: wallet · თანხა · Success; ბიზნესის გვერდზე ბალანსი −pay
   */
  async manualPaymentFromUi(c: { balance: number; amount: number; pay: number }) {
    const w = await this.prepareWallets([c.balance]);
    const number = `QA-C-UI-PAY-${Date.now()}`;
    const res = await this.sim.collection(w.ctx.ident, c.amount, number);
    assertCondition('POST $SIM/orders/collection', res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია', res?.items);
    let done = false;
    try {
      const held = this.largestFirst(w.wallets, c.amount);
      const d0 = await this.waitAllocations(number, held);
      const restricted = round(Object.values(held).reduce((a, b) => a + b, 0));

      // 1. UI: Request amount from RS → RS პასუხობს (execution AMOUNT_RECEIVED)
      await this.expectOverview(w.ctx, number, { status: uiLabel(d0.restriction.status), requested: c.amount, restricted, remaining: c.amount });
      await this.ui.requestAmount();
      let exec: any;
      await this.poll(async () => {
        exec = (RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(d0.restriction.id)).executions || []).find((e: any) => e.status === 'AMOUNT_RECEIVED');
        return exec;
      });
      assertCondition(OP_RESTRICTION, !!exec, 'RS-ის პასუხი არ მოვიდა', 'UI-დან Request amount → execution AMOUNT_RECEIVED', null);
      const answer = Number(exec.rsAnswerAmount ?? exec.answerAmount ?? exec.amount);
      await this.ui.closeModal();

      // 2. UI Executions: Amount received · Manual · RS answer · ხელით რეჟიმის მინიშნება
      const before = await this.modalTabText('Executions', w.ctx, number);
      const need = ['Amount received', 'Manual', money(answer), 'Treasury payments are manual'];
      const miss = need.filter((x) => !before.includes(x));
      assertCondition(OP_RESTR, miss.length === 0, `Executions: ${before.slice(0, 400)}${miss.length ? ` · აკლია: ${miss.join(', ')}` : ''}`, need.join(' · '), exec);
      await this.ui.closeModal();

      // 3. ადმინი აფიქსირებს გადახდას UI-დან (11.11-დან ღილაკი "Record manual payment")
      const bankReference = `QA-BANK-${digits(6)}`;
      await this.recordFromUi(w.ctx, number, c.pay, bankReference);
      const d = await this.poll(async () => {
        const x = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(d0.restriction.id));
        return round(x.restriction.executedAmount) === round(c.pay) && (x.transfers || []).length > 0 && x.transfers.every((t: any) => t.status === 'SUCCESS') ? x : undefined;
      }, 120_000);
      assertCondition(OP_RESTRICTION, !!d, 'ჩამოჭრა არ დასრულდა', `executed ${c.pay}, transfer SUCCESS`, null);
      done = c.pay >= c.amount;

      // 4. UI: Overview (PAID TO TREASURY) → Executions: Completed · Accomplished · MANUAL PAYMENT (Bank reference, Paid at, Recorded by) · TRANSFERS
      //    (10.11-დან Treasury transfers ცალკე ტაბი აღარ არის — Executions-შია)
      const left = round(c.amount - c.pay);
      const heldAfter = round(d.allocations.reduce((a: number, x: any) => a + Number(x.held), 0));
      await this.expectOverview(w.ctx, number, { status: uiLabel(d.restriction.status), requested: c.amount, restricted: heldAfter, remaining: left, executed: c.pay });
      const after = await this.modalTabText('Executions');
      const wallet = w.wallets[0].name;
      const needAfter = ['Completed', `Accomplished | ${money(c.pay)}`, 'MANUAL PAYMENT', `Bank reference | ${bankReference}`, 'Paid at', 'Recorded by', 'TRANSFERS',
        `${wallet}`, money(c.pay), 'Success'];
      const missAfter = needAfter.filter((x) => !after.includes(x));
      assertCondition(OP_RESTR, missAfter.length === 0, `Executions: ${after.slice(0, 600)} · აკლია: ${missAfter.join(', ')}`, needAfter.join(' · '), { executions: d.executions, transfers: d.transfers });
      await this.ui.closeModal();
      await this.expectBusinessBalances({ ctx: w.ctx, wallets: w.wallets }, held, { [w.wallets[0].clientId]: c.pay });
      console.log(`✅ Manual payment from UI flow: requested from UI, RS answer ${answer}, paid ${c.pay} (${bankReference}) → ${d.restriction.status}`);
    } finally {
      if (!done) await this.sim.obtainCollection(number);
    }
  }

  /**
   * ⏳ ინკასო 2 დღეში — ერთი ტესტი, ორჯერ გაშვება:
   *   1-ლი გაშვება (STATE_FILE არ არის) → დღე 1: ნაწილობრივი გადახდა, ინკასო ღია რჩება, მონაცემები ინახება
   *   იგივე დღეს ხელახლა → გამოტოვება ("ხვალ გაუშვი")
   *   მომდევნო დღეს → დღე 2: შევსება → დარჩენილის გადახდა → Executed, ფაილი იშლება (შემდეგ გაშვებაზე ისევ დღე 1)
   */
  async collectionOverTwoDays(c: { balances: number[]; amount: number; pay: number; topUp: number }) {
    if (!fs.existsSync(STATE_FILE)) return this.collectionDay1(c);
    const s: Day2State = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    test.skip(s.day === tbilisiDay(), `დღე 1 დღეს (${s.day}) გაეშვა — ინკასო ${s.number}, დარჩენილი ${round(s.amount - s.paid)} ხვალ გადაიხდება (იგივე ტესტი გაუშვი ხვალ)`);
    return this.collectionDay2(s, c.topUp);
  }

  /**
   * დღე 1: 3 wallet (0.1 / 0.2 / 0.2 = 0.5) → ინკასო 0.8 → იყინება მთელი 0.5, აკლია 0.3 →
   *   Request amount → ადმინი იხდის 0.4 → ჩამოიჭრა 0.4, დარჩა 0.4 (გაყინული 0.1)
   *   ინკასო ღია რჩება (არ ვასუფთავებთ) → მონაცემები ინახება STATE_FILE-ში დღე 2-სთვის
   */
  private async collectionDay1(c: { balances: number[]; amount: number; pay: number; topUp: number }) {
    this.guard(c.topUp);
    const w = await this.prepareWallets(c.balances);
    const number = `QA-C-UI-2D-${Date.now()}`;
    const res = await this.sim.collection(w.ctx.ident, c.amount, number);
    assertCondition('POST $SIM/orders/collection', res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია', res?.items);
    const held = this.largestFirst(w.wallets, c.amount);
    const d0 = await this.waitAllocations(number, held);
    const d = await this.requestAndPay(w.ctx, number, d0.restriction.id, c.pay, c.pay);
    const executed = await this.expectPaidUi(w, number, d, { amount: c.amount, held, executedTotal: c.pay, executions: 1 });
    const state: Day2State = { day: tbilisiDay(), number, restrictionId: d0.restriction.id, amount: c.amount, paid: c.pay, ctx: w.ctx, wallets: w.wallets, held, executed };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`✅ Day 1: collection ${number} ${c.amount} — paid ${c.pay}, left ${round(c.amount - c.pay)} → run Day 2 tomorrow (${STATE_FILE})`);
  }

  /**
   * დღე 2 (ხვალ ან უფრო გვიან): დღე 1-ის ინკასო → ბალანსის შევსება `topUp` (უმცირეს wallet-ზე) → დარჩენილი მთლიანად იყინება →
   *   Request amount (ახალი დღე) → ადმინი იხდის დარჩენილს → Executed, Executed = მთელი თანხა;
   *   UI: მწკრივი, Holds per wallet, Executions (2 ბარათი + TRANSFERS), ბიზნესის გვერდზე ბალანსები = API
   */
  private async collectionDay2(s: Day2State, topUp: number) {
    const c = { topUp };
    const left = round(s.amount - s.paid);

    // ბალანსის შევსება → დარჩენილი მთლიანად იყინება
    const target = [...s.wallets].sort((a, b) => a.balance - b.balance)[0];
    RsHubApi.expectOk('PUT balance', await this.api.updateBalance(target.clientId, { amount: c.topUp, currency: 'GEL', description: 'QA RS front day 2' }));
    const wallets = s.wallets.map((x) => ({ ...x, balance: round(x.balance + (x.clientId === target.clientId ? c.topUp : 0)) }));
    const heldNow = await this.poll(async () => {
      const x = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(s.restrictionId));
      return round(x.allocations.reduce((a: number, b: any) => a + Number(b.held), 0)) === left ? x : undefined;
    }, 120_000, 3000);
    assertCondition(OP_RESTRICTION, !!heldNow, 'შევსების შემდეგ დარჩენილი სრულად არ გაიყინა', `გაყინული = დარჩენილი ${left}`, null);

    await this.ui.login();
    const d = await this.requestAndPay(s.ctx, s.number, s.restrictionId, left, s.amount);
    // ჯამური გაყინვა თითო wallet-ზე = რაც საბოლოოდ ჩამოიჭრა (ბოლოს გაყინული 0)
    const executedAll: Record<string, number> = {};
    for (const t of d.transfers) { const id = t.holderRef.split(':')[1]; executedAll[id] = round((executedAll[id] || 0) + Number(t.amount)); }
    await this.expectPaidUi({ ctx: s.ctx, wallets }, s.number, d, { amount: s.amount, held: executedAll, executedTotal: s.amount, executions: 2 });
    fs.unlinkSync(STATE_FILE);
    console.log(`✅ Day 2: collection ${s.number} — topped up ${c.topUp}, paid remaining ${left} → Executed ${s.amount}`);
  }

  // ─── Field changes ───

  /**
   * Not submitted: Edit data → სახელი, Known date, ალტ. ნომერი → "Registration updated" → Data განახლდა →
   *   Field changes: 2 მწკრივი (Owner full name, Known date — ძველი / ახალი, ვინ, როდის) = API fieldChanges
   * Approved: RS-ში გაგზავნილი ველები გამორთულია + მინიშნება; ალტ. ნომერი იცვლება
   */
  async fieldChanges() {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business', await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(RsClientHelper.buildBody('WALLET', business.id)));
    const reg = await this.poll(async () => (await this.api.lookupRegistration({ identNumber: business.identificationNumber })).value?.registration || undefined, 120_000, 4000);
    const newName = `${business.ownerFullName} Edited`;
    const newKnown = date(9);
    const alt = `9${digits(10)}`;
    await this.ui.login();
    await this.ui.openRegistration(reg.id);
    const e1 = await this.ui.editRegistration({ ownerFullName: newName, knownDate: newKnown, personalNumberAlt: alt });
    assertCondition(OP_FIELDS, e1.disabled.length === 0, `გამორთული: ${e1.disabled.join(', ')}`, 'Not submitted — ყველა ველი იცვლება', e1);
    assertCondition(OP_FIELDS, await this.ui.toast('Registration updated'), 'toast არ გამოჩნდა', 'toast "Registration updated"', null);

    await this.ui.openRegistration(reg.id);
    const t = await this.ui.pageText();
    const need = [`${newName} | Not submitted`, `Owner full name | ${newName}`, `Alternative personal number | ${alt}`, `Known date | ${day(newKnown)}`];
    const miss = need.filter((x) => !t.includes(x));
    assertCondition(OP_FIELDS, miss.length === 0, `Data-ში არ ჩანს: ${miss.join(' · ')}`, need.join(' · '), t.slice(0, 1200));

    const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(reg.id));
    assertCondition(OP_FIELDS, (await this.ui.pageText()).includes('Field changes | 2'), 'Field changes ტაბზე რიცხვი არ არის 2', 'Field changes 2', v.fieldChanges);
    await this.ui.openTab('Field changes');
    const rows = (await this.ui.tabRows()).map((r) => r.join(' | '));
    const label: Record<string, string> = { ownerFullName: 'Owner full name', knownDate: 'Known date' };
    for (const fc of v.fieldChanges) {
      const exp = `${label[fc.field] || fc.field} | ${fc.oldValue} | ${fc.newValue} | ${fc.changedBy} | ${dateTime(fc.changedAt)}`;
      assertCondition(OP_FIELDS, rows.includes(exp), `მწკრივები: ${rows.join(' || ')}`, exp, v.fieldChanges);
    }
    assertCondition(OP_FIELDS, v.fieldChanges.length === 2 && rows.length === 2, `API ${v.fieldChanges.length} / UI ${rows.length}`, '2 ცვლილება (სახელი, Known date)', v.fieldChanges);

    // Approved → RS-ში გაგზავნილი ველები გამორთულია
    RsHubApi.expectOk('POST submit', await this.api.submitRegistration(reg.id));
    await this.sim.approveTaxpayer(business.identificationNumber);
    await this.expectRegStatus(reg.id, 'Approved', 60_000);
    const e2 = await this.ui.editRegistration({ ownerFullName: `${newName} 2`, identNumber: '900000000', operDate: date(20), knownDate: date(5), personalNumberAlt: `9${digits(10)}` });
    assertCondition(OP_FIELDS, ['ownerFullName', 'identNumber', 'operDate', 'knownDate'].every((f) => e2.disabled.includes(f)) && !e2.disabled.includes('personalNumberAlt'),
      `გამორთული: ${e2.disabled.join(', ')}`, 'Approved — ownerFullName, identNumber, operDate, knownDate გამორთულია; personalNumberAlt იცვლება', e2);
    assertCondition(OP_FIELDS, e2.hint.startsWith("Sent to RS, can't be changed"), `მინიშნება: ${e2.hint}`, '"Sent to RS, can\'t be changed. To correct it, cancel the RS registration and register again."', e2);
    console.log('✅ Field changes — Not submitted edits listed, Approved RS fields locked');
  }

  // ─── RS messages ───

  /** Approved რეგისტრაცია → RS messages ტაბი = API messages (Message ID, Operation, Status, Attempts, RS error, Created, Acknowledged) */
  async rsMessages() {
    const ctx = await this.prepare(0);
    const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(ctx.regId));
    await this.ui.openRegistration(ctx.regId);
    await this.ui.openTab('RS messages');
    const rows = (await this.ui.tabRows()).map((r) => r.join(' | '));
    const opLabel: Record<string, string> = { NEW_CLIENT: 'New client', NEW_CLIENT_NR: 'New client NR' };
    for (const m of v.messages) {
      const exp = [m.messageId, opLabel[m.operation] || m.operation, m.status === 'ACKED' ? 'Acked' : m.status, String(m.attempts), day(m.createdAt), day(m.ackedAt)];
      const line = rows.find((l) => l.startsWith(m.messageId)) || '';
      const miss = exp.filter((x) => !line.includes(x));
      assertCondition(OP_MSG, miss.length === 0, `მწკრივი: ${line || 'არ ჩანს'}${miss.length ? ` · აკლია: ${miss.join(', ')}` : ''}`, exp.join(' | '), m);
    }
    assertCondition(OP_MSG, rows.length === v.messages.length && v.messages.some((m: any) => m.operation === 'NEW_CLIENT' && m.status === 'ACKED'),
      `UI ${rows.length} / API ${v.messages.length}`, 'NEW_CLIENT Acked; UI მწკრივები = API', v.messages);
    console.log(`✅ RS messages — ${rows.length} row(s) = API`);
  }

  // ─── History ───

  /** History: ყველა ნაბიჯი ჩანს, ახალი ზემოთ — Client created → Enrollment created → Queued new client → Submit → Rs answer acked → Rs acknowledged → Approved honest tax payer */
  async history() {
    const ctx = await this.prepare(0);
    await this.ui.openRegistration(ctx.regId);
    await this.ui.openTab('History');
    const t = (await this.poll(async () => { const x = await this.ui.pageText(); return x.includes('Client created') ? x : undefined; }, 15_000, 1000))
      || await this.ui.pageText();
    const oldestFirst = ['Client created', 'Enrollment created', 'Queued new client', 'Submit', 'Approved honest tax payer'];
    const idx = oldestFirst.map((e) => t.lastIndexOf(`| ${e} |`));
    const miss = oldestFirst.filter((_, i) => idx[i] < 0);
    assertCondition(OP_HIST, miss.length === 0, `არ ჩანს: ${miss.join(', ')}`, oldestFirst.join(' → '), t.slice(0, 1500));
    const newestFirst = idx.every((v, i) => i === 0 || v < idx[i - 1]);
    assertCondition(OP_HIST, newestFirst, `რიგი: ${oldestFirst.map((e, i) => `${e}@${idx[i]}`).join(', ')}`, 'ახალი მოვლენა ზემოთ (Approved პირველი, Client created ბოლო)', t.slice(0, 1500));
    assertCondition(OP_HIST, t.includes('User: 995591078180') && t.includes('Integrator: distributor-hub') && t.includes('RS: '),
      'ავტორები არ ჩანს', 'ავტორები: User (Submit), Integrator: distributor-hub (Client / Enrollment created), RS (Approved)', t.slice(0, 1500));
    console.log('✅ History — all steps, newest first, actors');
  }

  // ─── საერთო ───

  /** UI flow (1-ლი wallet UI-დან) + კიდევ wallet-ები API-ით ბიზნესის გარეშე → UI: Link clients → ყველა ACTIVE; ბალანსები */
  private async prepareWallets(balances: number[]): Promise<Wallets> {
    balances.forEach((b) => this.guard(b));
    const ctx = await this.prepare(balances[0]);
    const wallets = [{ clientId: ctx.wallet.clientId, name: ctx.wallet.name, balance: balances[0] }];
    for (const b of balances.slice(1)) wallets.push(await this.linkNewWallet(ctx, b));
    return this.expectAllEnrolled({ ctx, wallets });
  }

  /** ახალი wallet (API) `balance` ₾-ით → ბიზნესის გვერდი → Link clients (UI) */
  private async linkNewWallet(ctx: Ctx, balance: number) {
    const body = RsClientHelper.buildBody('WALLET', undefined, { clientName: `QA UI Wallet ${digits(6)}` });
    const c = RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(body));
    RsHubApi.expectOk('PUT balance', await this.api.updateBalance(c.clientId, { amount: balance, currency: 'GEL', description: 'QA RS front' }));
    await this.ui.openBusiness(ctx.businessId);
    await this.ui.linkClient(body.clientName);
    assertCondition('UI Link clients', await this.ui.toast('Clients linked'), 'toast არ გამოჩნდა', 'toast "Clients linked"', body.clientName);
    return { clientId: c.clientId, name: body.clientName, balance };
  }

  /** ყველა wallet ACTIVE რეგისტრაციაზე */
  private async expectAllEnrolled({ ctx, wallets }: Wallets): Promise<Wallets> {
    const ok = await this.poll(async () => {
      const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(ctx.regId));
      return wallets.every((x) => v.enrollments.some((e: any) => e.holderRef === `CLIENT:${x.clientId}` && e.status === 'ACTIVE')) ? true : undefined;
    }, 180_000, 5000);
    assertCondition(OP_REG, !!ok, 'ყველა wallet არ მიება', `${wallets.length} wallet ACTIVE რეგისტრაციაზე`, wallets);
    console.log(`✅ ${wallets.length} wallets on business: ${wallets.map((x) => `${x.name} (${x.balance})`).join(', ')}`);
    return { ctx, wallets };
  }

  /**
   * UI: Request amount from RS → RS პასუხი (AMOUNT_RECEIVED) → UI: Record manual payment `pay` (Bank reference) →
   *   ჩამოჭრა დასრულდა (ჯამში ჩამოჭრილი = `executedTotal`, ყველა გადარიცხვა SUCCESS)
   */
  protected async requestAndPay(ctx: Ctx, number: string, restrictionId: string, pay: number, executedTotal: number): Promise<any> {
    await this.ui.openRegistration(ctx.regId, 'restrictions');
    await this.ui.openRestriction(number);
    await this.ui.requestAmount();
    const exec = await this.poll(async () => {
      const e = (RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(restrictionId)).executions || []).find((x: any) => x.status === 'AMOUNT_RECEIVED');
      return e || undefined;
    });
    assertCondition(OP_RESTRICTION, !!exec, 'RS-ის პასუხი არ მოვიდა', 'UI-დან Request amount → execution AMOUNT_RECEIVED', null);
    await this.recordFromUi(ctx, number, pay, `QA-BANK-${digits(6)}`);
    let last: any;
    const d = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(restrictionId));
      const settled = round(last.restriction.executedAmount) === round(executedTotal) && (last.transfers || []).length > 0
        && last.transfers.every((t: any) => t.status === 'SUCCESS') && !['TRANSFERRING', 'PROCESSING'].includes(last.restriction.status);
      return settled ? last : undefined;
    }, 120_000);
    assertCondition(OP_RESTRICTION, !!d, `status ${last?.restriction?.status}, executed ${last?.restriction?.executedAmount}`, `ჩამოჭრა დასრულდა, ჯამში executed ${executedTotal}`, last?.restriction);
    return d;
  }

  /** UI: ფანჯარა (თავიდან) → Record manual payment → Amount paid `pay`, Bank reference → Record → toast "Payment recorded…" */
  private async recordFromUi(ctx: Ctx, number: string, pay: number, bankReference: string) {
    await this.ui.closeModal();
    await this.ui.openRegistration(ctx.regId, 'restrictions');
    await this.ui.openRestriction(number);
    await this.ui.openManualPaymentForm();
    await this.ui.fillManualPayment({ amount: String(pay), bankReference });
    const r = await this.ui.submitManualPayment();
    assertCondition(`${OP_RESTR} — Record manual payment`, r.closed && r.http === 200 && r.toast.includes('Payment recorded'),
      `HTTP ${r.http} · toast ${r.toast || '-'} · ${r.errors.join(' | ')}`, `${pay} ჩაიწერა: 200, "Payment recorded. Taking the money off the wallets."`, r);
    await this.ui.closeModal();
  }

  /**
   * გადახდის შემდეგ UI = API: მწკრივი (სტატუსი, Requested / Restricted / Remaining / Executed), Holds per wallet,
   *   Executions (`executions` ბარათი, Completed, Accomplished-ის ჯამი, MANUAL PAYMENT; TRANSFERS — თითო wallet-ის ჯამი, Success), ბიზნესის გვერდი
   *   აბრუნებს: clientId → ჯამში ჩამოჭრილი
   */
  private async expectPaidUi(w: Wallets, number: string, d: any, c: { amount: number; held: Record<string, number>; executedTotal: number; executions: number }) {
    const executed: Record<string, number> = {};
    for (const t of d.transfers) { const id = t.holderRef.split(':')[1]; executed[id] = round((executed[id] || 0) + Number(t.amount)); }
    const sumExec = round(Object.values(executed).reduce((a, b) => a + b, 0));
    assertCondition(OP_RESTRICTION, sumExec === round(c.executedTotal), `ჯამი ${sumExec}`, `wallet-ებიდან ჩამოჭრილი ჯამი = ${c.executedTotal}`, d.transfers);
    const restricted = round(d.allocations.reduce((a: number, b: any) => a + Number(b.held), 0));
    const status = uiLabel(d.restriction.status);

    await this.expectOverview(w.ctx, number, { status, requested: c.amount, restricted, remaining: round(c.amount - c.executedTotal), executed: c.executedTotal });
    await this.expectHolds(w, d, c.held, executed);
    // Executions (10.11-დან ბარათები): თითო ბარათი Completed, Accomplished-ის ჯამი = გადახდილი, MANUAL PAYMENT ბლოკი; TRANSFERS — თითო wallet-ის ჯამი, Success
    const ex = await this.ui.executions();
    const accomplished = round(ex.accomplished.reduce((a, b) => a + b, 0));
    const manual = (ex.text.match(/MANUAL PAYMENT/g) || []).length;
    assertCondition(OP_RESTR, ex.statuses.length === c.executions && ex.statuses.every((s) => s === 'Completed') && accomplished === round(c.executedTotal) && manual === c.executions,
      `Executions: ${ex.statuses.join(', ')} · Accomplished ${ex.accomplished.join(' + ')} · MANUAL PAYMENT ×${manual}`,
      `${c.executions} ბარათი, ყველა Completed, Accomplished ჯამში ${money(c.executedTotal)}, MANUAL PAYMENT ×${c.executions}`, ex.text);
    const tr = ex.transfers;
    for (const x of w.wallets.filter((x) => executed[x.clientId])) {
      const mine = tr.filter((r) => r[0] === x.name);
      const sum = round(mine.reduce((a, r) => a + parseMoney(r[1]), 0));
      assertCondition(OP_RESTR, sum === executed[x.clientId] && mine.every((r) => r.includes('Success')), `TRANSFERS: ${tr.map((r) => r.join(' | ')).join(' || ')}`,
        `${x.name}: ჯამში ${money(executed[x.clientId])}, ყველა Success`, tr);
    }
    assertCondition(OP_RESTR, tr.length === d.transfers.length, `${tr.length} მწკრივი`, `${d.transfers.length} მწკრივი (= API transfers)`, tr);
    await this.ui.closeModal();
    await this.expectBusinessBalances(w, c.held, executed);
    return executed;
  }

  /** ფანჯრის ტაბის ტექსტი (Executions — ბარათებია, არა ცხრილი); ctx + number → ჯერ რეგისტრაციის გვერდზე ფანჯარას ხსნის */
  private async modalTabText(tab: 'Executions' | 'Holds per wallet', ctx?: Ctx, number?: string): Promise<string> {
    if (ctx && number) {
      await this.ui.openRegistration(ctx.regId, 'restrictions');
      await this.ui.openRestriction(number);
    }
    await this.ui.modal().getByRole('tab', { name: tab }).click();
    await this.ui.page.waitForTimeout(800);
    return (await this.ui.modal().innerText()).replace(/\s*\n+\s*/g, ' | ');
  }

  /** LARGEST_AVAILABLE_FIRST: ჯერ ყველაზე დიდი ბალანსი → clientId → გაყინული */
  private largestFirst(wallets: { clientId: string; balance: number }[], amount: number): Record<string, number> {
    const out: Record<string, number> = {};
    let left = amount;
    for (const x of [...wallets].sort((a, b) => b.balance - a.balance)) {
      const take = round(Math.min(x.balance, left));
      if (take > 0) out[x.clientId] = take;
      left = round(left - take);
    }
    return out;
  }

  /** API: ყადაღის / ინკასოს allocations = მოსალოდნელი (ჯერ უდიდესი) */
  private async waitAllocations(number: string, expected: Record<string, number>): Promise<any> {
    let last: any;
    const ok = await this.poll(async () => {
      const x = RsHubApi.expectOk('GET restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0];
      if (!x) return undefined;
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(x.id));
      const placed = last.allocations.filter((a: any) => a.status === 'PLACED' && Number(a.held) > 0);
      const match = Object.entries(expected).every(([id, h]) => placed.some((a: any) => a.holderRef === `CLIENT:${id}` && round(Number(a.held)) === h))
        && placed.length === Object.keys(expected).length;
      return match ? last : undefined;
    });
    assertCondition(OP_RESTRICTION, !!ok, `allocations: ${JSON.stringify(last?.allocations?.map((a: any) => [a.holderName, a.held, a.status]))}`,
      `ჯერ ყველაზე დიდი ბალანსი: ${JSON.stringify(expected)}`, last?.allocations);
    return ok;
  }

  /** ფანჯარა → Holds per wallet: თითო wallet-ის Target / Held / Executed = API allocations */
  private async expectHolds(w: Wallets, d: any, held: Record<string, number>, executed: Record<string, number>) {
    const rows = (await this.ui.modalTab('Holds per wallet')).map((r) => r.join(' | '));
    for (const a of d.allocations.filter((x: any) => Number(x.target) > 0 || Number(x.executed) > 0)) {
      const name = w.wallets.find((x) => `CLIENT:${x.clientId}` === a.holderRef)?.name || a.holderName;
      const line = rows.find((l) => l.startsWith(name)) || '';
      const exp = `${name} | distributor-hub | ${money(Number(a.target))} | ${money(Number(a.held))} | ${money(Number(a.executed))}`;
      assertCondition(OP_RESTR, line.startsWith(exp), `Holds: ${rows.join(' || ')}`, exp, a);
    }
    for (const [id, h] of Object.entries(held)) {
      const a = d.allocations.find((x: any) => x.holderRef === `CLIENT:${id}`);
      const want = round(h - (executed[id] || 0));
      assertCondition(OP_RESTR, !!a && round(Number(a.held)) === want, `API held ${a?.held}`, `${id}: გაყინული ${want} (გაიყინა ${h}, ჩამოიჭრა ${executed[id] || 0})`, a);
    }
  }

  /** ბიზნესის გვერდი → Wallet clients: თითო wallet "₾ ბალანსი / ₾ გაყინული / ₾ თავისუფალი" */
  private async expectBusinessBalances(w: Wallets, held: Record<string, number>, executed: Record<string, number>) {
    await this.ui.openBusiness(w.ctx.businessId);
    const rows = (await this.ui.businessWalletRows()).map((r) => r.join(' | '));
    for (const x of w.wallets) {
      const ex = executed[x.clientId] || 0;
      const amount = round(x.balance - ex);
      const h = round((held[x.clientId] || 0) - ex);
      // ⚠️ ნულოვან ბალანსს UI "-"-ით აჩვენებს (API-ში ჩანაწერი 0 / 0 / 0 არსებობს) — FE ხარვეზი, ბაგების სიაშია
      const cell = amount === 0 ? `${x.name} | Active | - |` : `${money(amount)} / ${money(h)} / ${money(round(amount - h))}`;
      if (amount === 0) console.log(`⚠️ ${x.name}: ბალანსი 0 → UI-ში "-" ნაცვლად "₾ 0.00 / ₾ 0.00 / ₾ 0.00"`);
      const line = rows.find((l) => l.startsWith(x.name)) || '';
      assertCondition(OP_BIZ, line.includes(cell), `მწკრივი: ${line || 'არ ჩანს'}`, `${x.name}: ${cell} (ბალანსი / გაყინული / თავისუფალი)`, rows);
      await this.expectWallet({ ...w.ctx, wallet: { ...w.ctx.wallet, clientId: x.clientId } }, amount, h, `${x.name}: ბალანსი ${amount}, გაყინული ${h}`);
    }
  }
}
