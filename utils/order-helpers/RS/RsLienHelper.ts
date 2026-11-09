import { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { RsHubApi, RsSimulatorApi, DistributorApi, ApiResult } from './RsHubApi';
import { RsBusinessHelper } from './RsBusinessHelper';
import { RsClientHelper, gel } from './RsClientHelper';
import { RsRegistrationHelper } from './RsRegistrationHelper';
import { assertCondition, assertField } from '../../assertions';

const OP_SIM_LIEN = 'POST $SIM/orders/lien (RS → ყადაღა)';
const OP_SIM_OBTAIN = 'POST $SIM/orders/obtain-lien (RS → მოხსნა)';
const OP_SIM_RESEND = 'POST $SIM/orders/resend/{rsMessageId} (RS → იგივე შეტყობინება)';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions?rsNumber=';
const OP_REALLOCATE = 'POST /api/v1/rs/restrictions/{id}/reallocate';
const OP_REG = 'GET /api/v1/rs/registrations/{id}';
const OP_CLIENT = 'GET /api/distributor-hub-client/{id} (balances GEL)';
const OP_TOPUP = 'PUT /api/distributor-hub-client/{id} (ბალანსი)';
const OP_TRANSFER = 'POST distributor /api/distributor/ (wallet-ის გადარიცხვა)';
const OP_UNLINK = 'DELETE /api/distributor-hub-business/{id}/clients/{clientId}';

/** ⚠️ STANDARD კლიენტი = რეალური გადარიცხვები → ბალანსი არასდროს > 1 ₾, ყადაღა / გადარიცხვა ≤ 1 ₾ */
const MAX_AMOUNT = 1;
/** ყადაღის შემდეგ hold wallet-ზე რამდენიმე წამში ჩნდება (rs-service → hub) */
const HOLD_TIMEOUT = 30_000;
const APPROVE_TIMEOUT = 60_000;
/** docs: დაკლებული (shortfall) თანხა თავიდან მოწმდება ყოველ 15 წუთში */
const RECHECK_TIMEOUT = 17 * 60_000;

/** გადარიცხვის მიმღები (wallet → IBAN), მომხმარებლის მიწოდებული სატესტო მონაცემები */
const TRANSFER_TO = {
  currency: 'GEL',
  description: '48001015578',
  toIban: 'GE95TB7197445064300003',
  beneficiaryName: 'დავით კარტოზია',
};

type Status = 'PENDING' | 'PARTIALLY_RESTRICTED' | 'FULLY_RESTRICTED' | 'WITHDRAWN';

/** ბიზნესის საწყისი მდგომარეობა: 1 WALLET კლიენტი, ბალანსი (₾) და მასზე დადებული ყადაღა (₾) */
/** wallet-ის საკომისიო გადარიცხვაზე (currencyConfigs.GEL.commissionTiers) */
export interface Commission {
  type: 'FIXED' | 'PERCENTAGE';
  value: number;
}

export interface LienSetup {
  balance: number;
  lien: number;
  /** wallet-ის საკომისიო — გადარიცხვისას თავისუფალმა თანხამ უნდა დაფაროს თანხა + საკომისიო */
  commission?: Commission;
}

export interface WalletTransferCase extends LienSetup {
  /** wallet-ის გადარიცხვის თანხა (₾) */
  transfer: number;
  /** OK — გადის, held ხელუხლებელია · REJECTED — 400 / 5038, ბალანსი უცვლელი */
  expect: 'OK' | 'REJECTED';
}

interface Wallet {
  clientId: string;
  clientSecret: string;
  commission?: Commission;
}

interface Biz {
  ident: string;
  businessId: string;
  regId: string;
  registration: any;
  wallet: Wallet;
}

interface Ctx extends Biz {
  clientId: string;
  clientSecret: string;
  lienNumber: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ბალანსი / ყადაღა → hold-ის მოსალოდნელი სტატუსი */
const statusFor = (held: number, lien: number): Status => (held === 0 ? 'PENDING' : held >= lien ? 'FULLY_RESTRICTED' : 'PARTIALLY_RESTRICTED');

/**
 * RS ყადაღა (Lien) — wallet-ის გადარიცხვა / ადმინის debit / შევსება / მოხსნა / unlink / რამდენიმე ყადაღა და wallet.
 *   📋 RS ყადაღას ბიზნესის ident-ზე აგზავნის; ფული იყინება ბიზნესის RS რეგისტრაციაზე მიბმულ WALLET-ებზე (held).
 *   📋 Available = ბალანსი − held. ნებისმიერი გასავალი ოპერაცია იღებს მხოლოდ Available-ს (5038), ჩარიცხვა არ იბლოკება.
 *   📋 ფული < ყადაღა → PARTIALLY_RESTRICTED (ახალი ჩარიცხვა ავსებს hold-ს), ფული ≥ ყადაღა → FULLY_RESTRICTED, ფული 0 → PENDING.
 *   📋 რამდენიმე wallet: ჯერ ყველაზე დიდი თავისუფალი ბალანსი (LARGEST_AVAILABLE_FIRST); Reallocate — თავიდან განაწილება.
 *   📋 მეორე wallet რეგისტრაციაზე: იმავე ident-ით Register to RS ახალი wallet-ით → იმავე რეგისტრაციას ემატება.
 * Docs: RS Integration Test Guide → data.js (HLD-*), api.js (sim-orders-*, panel-restr-*); docs/RS-LIEN-CHECKLIST.md
 */
export class RsLienHelper {
  private api: RsHubApi;
  private sim: RsSimulatorApi;
  private dist: DistributorApi;

  constructor(private request: APIRequestContext) {
    this.api = new RsHubApi(request);
    this.sim = new RsSimulatorApi(request);
    this.dist = new DistributorApi(request);
  }

  // ─── 1 wallet: გადარიცხვა / ადმინი / შევსება ───

  /**
   * wallet ცდილობს გადარიცხვას ყადაღის დროს:
   *   REJECTED → 400 / 5038 "Insufficient balance amount", ბალანსი და held უცვლელი
   *   OK       → 2xx, ბალანსი −transfer, held უცვლელი (გაყინულ ფულს არ შეეხო)
   */
  async walletTransfer(c: WalletTransferCase) {
    this.guard(c.balance, c.lien, c.transfer);
    const ctx = await this.setup(c);
    await this.transfer(ctx, c.transfer, c.expect);
  }

  /** ადმინი ბალანსიდან ჩამოჭრის ყადაღის დროს — იგივე წესი: მხოლოდ თავისუფალი (Available) */
  async adminDebit(c: LienSetup & { debit: number; expect: 'OK' | 'REJECTED' }) {
    this.guard(c.balance, c.lien, c.debit);
    const ctx = await this.setup(c);
    const before = await this.gel(ctx.clientId);
    const res = await this.api.updateBalance(ctx.clientId, { amount: -c.debit, currency: 'GEL', description: 'QA RS lien debit' });

    if (c.expect === 'REJECTED') {
      this.expectRejected(OP_TOPUP, res, 400, 5038);
      await this.expectBalance(ctx.clientId, before.amount, before.held, 'უარის შემდეგ ბალანსი და held უცვლელია');
    } else {
      const v = RsHubApi.expectOk(OP_TOPUP, res);
      assertField(OP_TOPUP, v, 'status', 'APPLIED');
      await this.expectBalance(ctx.clientId, round(before.amount - c.debit), before.held, `ბალანსი −${c.debit}, held უცვლელი`);
    }
    console.log(`✅ Admin debit ${c.debit} ₾ — ${c.expect}`);
  }

  /**
   * ფული < ყადაღა (PARTIALLY_RESTRICTED) → ადმინი ავსებს ბალანსს → ახალი ფული ავტომატურად იყინება →
   * wallet ვერ გადარიცხავს (თავისუფალი 0) → ყადაღა FULLY_RESTRICTED (🐞 KD-2616: ყადაღა არ ახლდება)
   */
  async topUpFillsHold(c: LienSetup & { topUp: number; transfer: number }) {
    this.guard(c.balance + c.topUp, c.lien, c.transfer);
    const ctx = await this.setup(c);
    RsHubApi.expectOk(OP_TOPUP, await this.api.updateBalance(ctx.clientId, { amount: c.topUp, currency: 'GEL', description: 'QA RS fill-up' }));

    const total = round(c.balance + c.topUp);
    const held = round(Math.min(total, c.lien));
    await this.expectBalance(ctx.clientId, total, held, 'ახალი ფული ჯერ hold-ს ავსებს');
    if (held === total) await this.transfer(ctx, c.transfer, 'REJECTED');
    await this.expectRestriction(ctx.lienNumber, statusFor(held, c.lien), held, c.lien);
    console.log(`✅ Fill-up — +${c.topUp} ₾ held`);
  }

  // ─── მოხსნა ───

  /** RS ხსნის ყადაღას → WITHDRAWN, held 0 → wallet-ის გადარიცხვა გადის */
  async withdrawThenTransfer(c: LienSetup & { transfer: number }) {
    this.guard(c.balance, c.lien, c.transfer);
    const ctx = await this.setup(c);
    await this.withdraw(ctx.lienNumber);
    await this.expectBalance(ctx.clientId, c.balance, 0, 'მოხსნის შემდეგ held = 0');
    await this.transfer(ctx, c.transfer, 'OK');
  }

  /** ნაწილობრივ გაყინული ყადაღის მოხსნა → WITHDRAWN, მთელი ბალანსი თავისუფლდება */
  async withdrawPartial(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const ctx = await this.setup(c);
    await this.withdraw(ctx.lienNumber);
    await this.expectBalance(ctx.clientId, c.balance, 0, 'მოხსნის შემდეგ held = 0');
    console.log('✅ Partially restricted lien withdrawn — held 0');
  }

  /**
   * ერთ wallet-ზე 2 ყადაღა → held = ჯამი, ორივე FULLY_RESTRICTED →
   * პირველის მოხსნა → held = მეორე, მეორე ხელუხლებელია → იგივე ყადაღის მოხსნა მეორედ → არაფერი იცვლება
   */
  async twoLiensOneWithdrawn(c: { balance: number; liens: [number, number] }) {
    this.guard(c.balance, ...c.liens);
    const [l1, l2] = c.liens;
    const ctx = await this.setup({ balance: c.balance, lien: l1 });
    const second = `${ctx.lienNumber}B`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien(ctx.ident, l2, second));

    await this.expectBalance(ctx.clientId, c.balance, round(l1 + l2), 'held = ორივე ყადაღის ჯამი');
    await this.expectRestriction(second, 'FULLY_RESTRICTED', l2, l2);

    await this.withdraw(ctx.lienNumber);
    await this.expectBalance(ctx.clientId, c.balance, l2, 'პირველი მოიხსნა — გაყინული რჩება მხოლოდ მეორე');
    await this.expectRestriction(second, 'FULLY_RESTRICTED', l2, l2);

    this.expectAccepted(`${OP_SIM_OBTAIN} — მეორედ`, await this.sim.obtainLien(ctx.lienNumber));
    await this.expectBalance(ctx.clientId, c.balance, l2, 'მეორედ მოხსნა არაფერს ცვლის');
    console.log(`✅ Two liens ${l1} + ${l2} → withdraw first → held ${l2}`);
  }

  /** RS ხსნის ყადაღას, რომელიც ჩვენთან არ არსებობს → code 22 "Lien number not found" */
  async withdrawUnknown() {
    this.expectItemCode(OP_SIM_OBTAIN, await this.sim.obtainLien(`QA-L-NOPE-${Date.now()}`), '22');
    console.log('✅ Unknown lien withdraw → code 22');
  }

  // ─── Unlink ───

  /** ყადაღის დროს wallet-ს ბიზნესიდან ვერ მოხსნი → 409 / 1492, კლიენტი ბიზნესზე რჩება */
  async unlinkBlocked(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const ctx = await this.setup(c);
    this.expectRejected(OP_UNLINK, await this.api.unlinkClient(ctx.businessId, ctx.clientId), 409, 1492);
    const client = RsHubApi.expectOk(OP_CLIENT, await this.api.getClient(ctx.clientId));
    assertField(OP_CLIENT, client, 'businessId', ctx.businessId);
    console.log('✅ Unlink blocked (1492) — client stays on business');
  }

  /** ყადაღის მოხსნის შემდეგ Unlink → გადის (wallet ბიზნესიდან იხსნება) */
  async unlinkAfterWithdraw(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const ctx = await this.setup(c);
    await this.withdraw(ctx.lienNumber);
    await this.expectBalance(ctx.clientId, c.balance, 0, 'მოხსნის შემდეგ held = 0');
    RsHubApi.expectOk(OP_UNLINK, await this.api.unlinkClient(ctx.businessId, ctx.clientId));
    const client = RsHubApi.expectOk(OP_CLIENT, await this.api.getClient(ctx.clientId));
    assertCondition(OP_CLIENT, client.businessId == null, `businessId = ${client.businessId}`, 'businessId = null (wallet ბიზნესიდან მოიხსნა)', client);
    console.log('✅ Unlink after withdraw — OK');
  }

  // ─── დუბლიკატი / resend / არავალიდური თანხა ───

  /**
   * იგივე ყადაღის ნომერი მეორედ → code 21, restriction ერთია, held არ გაორმაგდა.
   *   newAmount — RS ცდილობს არსებული ყადაღის თანხის შეცვლას იმავე ნომრით → უარი, თანხა უცვლელი
   */
  async duplicateLien(c: LienSetup & { newAmount?: number }) {
    this.guard(c.balance, c.lien, c.newAmount ?? 0);
    const ctx = await this.setup(c);
    this.expectItemCode(OP_SIM_LIEN, await this.sim.lien(ctx.ident, c.newAmount ?? c.lien, ctx.lienNumber), '21');
    await this.expectSingleRestriction(ctx, c);
    const held = round(Math.min(c.balance, c.lien));
    await this.expectRestriction(ctx.lienNumber, statusFor(held, c.lien), held, c.lien);
    console.log(`✅ Duplicate lien${c.newAmount ? ` (${c.lien} → ${c.newAmount})` : ''} → code 21, amount unchanged`);
  }

  /**
   * RS-მა შეცდომით სხვა თანხა გამოაგზავნა → ყადაღას ხსნის → იმავე ident-ზე აგზავნის ახალს (ახალი ნომრით):
   *   ძველი WITHDRAWN, ახალი აქტიური, held = მხოლოდ ახალი (ორმაგი ბლოკის გარეშე)
   */
  async replaceLien(c: { balance: number; wrong: number; correct: number }) {
    this.guard(c.balance, c.wrong, c.correct);
    const ctx = await this.setup({ balance: c.balance, lien: c.wrong });
    await this.withdraw(ctx.lienNumber);
    await this.expectBalance(ctx.clientId, c.balance, 0, 'ძველი ყადაღა მოიხსნა — held 0');

    const fresh = `${ctx.lienNumber}N`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien(ctx.ident, c.correct, fresh));
    const held = round(Math.min(c.balance, c.correct));
    await this.expectBalance(ctx.clientId, c.balance, held, `გაყინულია მხოლოდ ახალი ყადაღა (${held})`);
    await this.expectRestriction(fresh, statusFor(held, c.correct), held, c.correct);
    await this.expectRestriction(ctx.lienNumber, 'WITHDRAWN', 0);
    console.log(`✅ Lien ${c.wrong} withdrawn → new lien ${c.correct} — held ${held}`);
  }

  /** RS იგივე შეტყობინებას ხელახლა აგზავნის (resend) → იგივე პასუხი, ახალი ყადაღა არ იქმნება, held არ გაორმაგდა */
  async resendSameMessage(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const biz = await this.business(c.balance);
    const lienNumber = `QA-L-${Date.now()}`;
    const first = await this.sim.lien(biz.ident, c.lien, lienNumber);
    this.expectAccepted(OP_SIM_LIEN, first);
    const ctx = { ...biz, ...biz.wallet, lienNumber };
    await this.expectBalance(ctx.clientId, c.balance, round(Math.min(c.balance, c.lien)), 'ყადაღის შემდეგ');

    this.expectAccepted(OP_SIM_RESEND, await this.sim.resend(first.rsMessageId));
    await sleep(3000);
    await this.expectSingleRestriction(ctx, c);
    console.log('✅ Resend — no duplicate lien');
  }

  /** არავალიდური თანხა (0 / უარყოფითი / 1 თეთრზე ნაკლები / ტექსტი) → code 6, არაფერი შეინახა, ბალანსი არ გაიყინა */
  async invalidAmount(amount: string) {
    const biz = await this.business(MAX_AMOUNT);
    const lienNumber = `QA-L-${Date.now()}`;
    this.expectItemCode(OP_SIM_LIEN, await this.sim.lien(biz.ident, amount, lienNumber), '6');
    const list = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: lienNumber })).content;
    assertCondition(OP_RESTRICTION, list.length === 0, `შეინახა ${list.length} restriction`, 'არაფერი შეინახა', list);
    await this.expectBalance(biz.wallet.clientId, MAX_AMOUNT, 0, 'არაფერი გაიყინა');
    console.log(`✅ Lien amount "${amount}" → code 6`);
  }

  // ─── ყადაღა ვერ ედება / რეგისტრაციის სტატუსი ───

  /**
   * ყადაღა ვერ ედება:
   *   noRegistration — ბიზნესს RS რეგისტრაცია არ აქვს → code 1 "Taxpayer not found"
   *   noWallet       — რეგისტრაცია Approved, wallet არ აქვს → code 13 "no open account"
   *   cancelled      — რეგისტრაცია გაუქმდა (Cancel) → code 1
   */
  async lienNotApplied(kind: 'noRegistration' | 'noWallet' | 'cancelled') {
    let ident: string;
    if (kind === 'cancelled') {
      const biz = await this.business(MAX_AMOUNT);
      RsHubApi.expectOk('POST /api/v1/rs/registrations/{id}/cancel', await this.api.cancelRegistration(biz.regId, { confirmation: 'delete', note: 'QA lien' }));
      ident = biz.ident;
    } else {
      const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
        await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
      ident = business.identificationNumber;
      if (kind === 'noWallet') await this.register(business);
    }

    const lienNumber = `QA-L-${Date.now()}`;
    this.expectItemCode(OP_SIM_LIEN, await this.sim.lien(ident, MAX_AMOUNT, lienNumber), kind === 'noWallet' ? '13' : '1');
    const list = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: lienNumber })).content;
    assertCondition(OP_RESTRICTION, list.length === 0, `შეინახა ${list.length} restriction`, 'არაფერი შეინახა', list);
    console.log(`✅ Lien not applied — ${kind}`);
  }

  /**
   * რეგისტრაცია ჯერ არ არის Approved (submitted — PENDING_RS_APPROVAL / notSubmitted — NOT_SUBMITTED) და მოდის ყადაღა →
   * docs: ითვლება RS-ის დადასტურებად → APPROVED (approvalSource LIEN), ყადაღა იდება
   */
  async lienApprovesRegistration(state: 'submitted' | 'notSubmitted', c: LienSetup) {
    this.guard(c.balance, c.lien);
    const biz = await this.business(c.balance, { submit: state === 'submitted', approve: false });
    const lienNumber = `QA-L-${Date.now()}`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien(biz.ident, c.lien, lienNumber));

    const v = await this.poll(OP_REG, HOLD_TIMEOUT, 'status APPROVED (ყადაღა = RS-ის დადასტურება)', async () => {
      const r = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(biz.regId));
      return r.registration.status === 'APPROVED' ? r : undefined;
    });
    assertField(OP_REG, v!.registration, 'approvalSource', 'LIEN');
    const held = round(Math.min(c.balance, c.lien));
    await this.expectBalance(biz.wallet.clientId, c.balance, held, 'ყადაღა დაედო');
    await this.expectRestriction(lienNumber, statusFor(held, c.lien), held, c.lien);
    console.log(`✅ ${state} registration → APPROVED by LIEN`);
  }

  // ─── რამდენიმე wallet ───

  /**
   * ბიზნესს 2 wallet (A, B) → ყადაღა → იყინება ჯერ ყველაზე დიდი ბალანსის wallet:
   *   expectHeld — მოსალოდნელი held თითო wallet-ზე [A, B]
   */
  async twoWallets(c: { a: number; b: number; lien: number; expectHeld: [number, number] }) {
    this.guard(c.a, c.b, c.lien);
    const biz = await this.business(c.a);
    const b = await this.addWallet(biz, c.b);
    const lienNumber = `QA-L-${Date.now()}`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien(biz.ident, c.lien, lienNumber));

    await this.expectBalance(biz.wallet.clientId, c.a, c.expectHeld[0], 'wallet A');
    await this.expectBalance(b.clientId, c.b, c.expectHeld[1], 'wallet B');
    const held = round(c.expectHeld[0] + c.expectHeld[1]);
    await this.expectRestriction(lienNumber, statusFor(held, c.lien), held, c.lien);
    console.log(`✅ Two wallets A ${c.a} / B ${c.b}, lien ${c.lien} → held A ${c.expectHeld[0]} / B ${c.expectHeld[1]}`);
  }

  /**
   * ყადაღა ფულზე მეტია (A მთლიანად გაყინულია) → ბიზნესს ემატება wallet B →
   *   A ცდილობს გადარიცხვას → უარი (A-ს თავისუფალი 0, B-ზე არსებული ფული A-ს არ ეხება)
   *   reallocate: 'admin' — ადმინი აჭერს Reallocate → იყინება ჯერ უფრო დიდი B, A თავისუფლდება
   *               'auto'  — ვერაფერს ვაჭერთ, ველით 15-წუთიან ავტომატურ შემოწმებას → დაკლებული B-ზე იყინება
   */
  async secondWalletAfterLien(c: { a: number; b: number; lien: number; transfer: number; reallocate: 'admin' | 'auto'; transferAfter?: number }) {
    this.guard(c.a, c.b, c.lien, c.transfer, c.transferAfter ?? 0);
    const ctx = await this.setup({ balance: c.a, lien: c.lien });
    const b = await this.addWallet(ctx, c.b);
    await this.expectBalance(b.clientId, c.b, 0, 'B ახლად დაემატა — ჯერ არაფერი გაყინულა');
    await this.transfer(ctx, c.transfer, 'REJECTED');

    // admin — ადმინი აჭერს Reallocate; auto — 15-წუთიანი შემოწმება იგივეს აკეთებს (სრულად თავიდან ანაწილებს)
    if (c.reallocate === 'admin') {
      const r = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: ctx.lienNumber })).content[0];
      RsHubApi.expectOk(OP_REALLOCATE, await this.api.reallocate(r.id));
    }
    // LARGEST_AVAILABLE_FIRST: ჯერ B (უფრო დიდი), დანარჩენი A-ზე; ჯამი = ყადაღა (არა მეტი)
    const why = c.reallocate === 'admin' ? 'Reallocate' : '15-წუთიანი ავტომატური შემოწმება';
    const timeout = c.reallocate === 'admin' ? HOLD_TIMEOUT : RECHECK_TIMEOUT;
    const onB = round(Math.min(c.b, c.lien));
    const onA = round(Math.min(c.a, c.lien - onB));
    await this.expectBalance(b.clientId, c.b, onB, `${why} — ჯერ უფრო დიდი ბალანსი (B)`, timeout);
    await this.expectBalance(ctx.clientId, c.a, onA, `${why} — A-ზე რჩება მხოლოდ დანარჩენი`);
    await this.expectRestriction(ctx.lienNumber, statusFor(round(onA + onB), c.lien), round(onA + onB), c.lien);
    // transferAfter: A-ს ახლა თავისუფალი აქვს → გადარიცხვა გადის (⚠️ რეალური ფული IBAN-ზე)
    if (c.transferAfter) await this.transfer(ctx, c.transferAfter, 'OK');
    console.log(`✅ Second wallet after lien — ${c.reallocate}`);
  }

  // ─── ვალუტა / wallet-ის ტიპი ───

  /**
   * ყადაღა მხოლოდ ლარს ეხება:
   *   usdOnly      — wallet-ს მხოლოდ USD აქვს → არაფერი იყინება, ყადაღა PENDING, USD ხელუხლებელი
   *   usdTransfer  — GEL მთლიანად გაყინულია → USD-ით გადარიცხვა გადის (💸 რეალური USD IBAN-ზე)
   */
  async otherCurrency(kind: 'usdOnly' | 'usdTransfer', c: { gel: number; usd: number; lien: number; transfer?: number }) {
    this.guard(c.gel, c.usd, c.lien, c.transfer ?? 0);
    const usd = { ...gel(), USD: gel().GEL };
    const currencies = kind === 'usdOnly' ? { enabledCurrencies: ['USD'], currencyConfigs: { USD: gel().GEL } } : { enabledCurrencies: ['GEL', 'USD'], currencyConfigs: usd };
    const biz = await this.customBusiness(currencies, [['GEL', c.gel], ['USD', c.usd]]);
    const lienNumber = `QA-L-${Date.now()}`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien(biz.ident, c.lien, lienNumber));

    const held = round(Math.min(c.gel, c.lien));
    await this.expectBalance(biz.wallet.clientId, c.gel, held, `GEL — გაყინულია ${held}`);
    await this.expectBalance(biz.wallet.clientId, c.usd, 0, 'USD — არ იყინება (ყადაღა მხოლოდ ლარშია)', HOLD_TIMEOUT, 'USD');
    await this.expectRestriction(lienNumber, statusFor(held, c.lien), held, c.lien);
    if (kind === 'usdTransfer') await this.transfer(biz.wallet, c.transfer!, 'OK', 'USD');
    console.log(`✅ Other currency (${kind}) — GEL held ${held}, USD untouched`);
  }

  /** Unlimited wallet (unlimitedGel: true) — რეალური ფული არ აქვს → hold არ ედება, ყადაღა PENDING "can't hold" */
  async unlimitedWallet(c: { lien: number }) {
    this.guard(c.lien);
    const biz = await this.customBusiness({ unlimitedGel: true }, []);
    const lienNumber = `QA-L-${Date.now()}`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien(biz.ident, c.lien, lienNumber));
    await this.expectRestriction(lienNumber, 'PENDING', 0, c.lien);
    const r = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: lienNumber })).content[0];
    assertCondition(OP_RESTRICTION + lienNumber, /can't hold/i.test(r.statusReason || ''), `statusReason: ${r.statusReason}`,
      'statusReason — "Only wallets that can\'t hold money (… unlimited) hold this business"', r);
    await this.expectBalance(biz.wallet.clientId, 0, 0, 'unlimited wallet-ზე არაფერი გაიყინა');
    console.log('✅ Unlimited wallet — no hold');
  }

  /** wallet-ს ყადაღის დროს გამორთავენ (status false) → გაყინული ფული გაყინული რჩება, ყადაღა უცვლელი */
  async deactivatedWalletKeepsHold(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const ctx = await this.setup(c);
    const client = RsHubApi.expectOk(OP_CLIENT, await this.api.getClient(ctx.clientId));
    RsHubApi.expectOk('POST /api/distributor-hub-client (status false)', await this.api.createClient({ ...client, integratorId: ctx.clientId, status: false }));
    const after = RsHubApi.expectOk(OP_CLIENT, await this.api.getClient(ctx.clientId));
    assertField(OP_CLIENT, after, 'status', false);

    await sleep(5000);
    const held = round(Math.min(c.balance, c.lien));
    await this.expectBalance(ctx.clientId, c.balance, held, 'გამორთვის შემდეგ ფული ისევ გაყინულია');
    await this.expectRestriction(ctx.lienNumber, statusFor(held, c.lien), held, c.lien);
    console.log('✅ Deactivated wallet — hold kept');
  }

  /** ბიზნესის მონაცემების ცვლილება (სახელი) ყადაღის დროს → ყადაღა და გაყინული ფული ადგილზე რჩება */
  async businessEditKeepsLien(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const ctx = await this.setup(c);
    const business = RsHubApi.expectOk('GET /api/distributor-hub-business/{id}', await this.api.getBusiness(ctx.businessId));
    RsHubApi.expectOk('PUT /api/distributor-hub-business/{id}',
      await this.api.updateBusiness(ctx.businessId, { ...RsBusinessHelper.updateBody(business), ownerFullName: `${business.ownerFullName} Edited` }));

    await sleep(5000);
    const held = round(Math.min(c.balance, c.lien));
    await this.expectBalance(ctx.clientId, c.balance, held, 'ბიზნესის ცვლილების შემდეგ ფული ისევ გაყინულია');
    await this.expectRestriction(ctx.lienNumber, statusFor(held, c.lien), held, c.lien);
    console.log('✅ Business edited — lien kept');
  }

  /** რეგისტრაცია ჯერ არ არის Approved (ყადაღა არ ადევს) → docs BLK-01: ბლოკი მხოლოდ log-შია → wallet-ის გადარიცხვა გადის (💸) */
  async transferBeforeApproval(c: { balance: number; transfer: number }) {
    this.guard(c.balance, c.transfer);
    const biz = await this.business(c.balance, { submit: false, approve: false });
    await this.transfer(biz.wallet, c.transfer, 'OK');
  }

  // ─── უსაფრთხოება / RS-ის შეტყობინებები ───

  /** ყალბი RS ხელმოწერა → მთელი შეტყობინება უარყოფილია (code 4), ყადაღა არ ინახება, ფული არ იყინება */
  async forgedSignature(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const biz = await this.business(c.balance);
    const lienNumber = `QA-L-${Date.now()}`;
    const res = await this.sim.rawOrder([{ type: 'Lien', fields: { PersonId: biz.ident, LienNumber: lienNumber, Amount: String(c.lien) } }], true);
    assertCondition('POST $SIM/orders (forgeSignature)', res.accepted === false, `accepted: ${res.accepted}`, 'accepted: false (მთელი შეტყობინება უარყოფილია)', res);
    this.expectItemCode('POST $SIM/orders (forgeSignature)', res, '4');

    await sleep(3000);
    const list = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: lienNumber })).content;
    assertCondition(OP_RESTRICTION, list.length === 0, `შეინახა ${list.length} restriction`, 'არაფერი შეინახა', list);
    await this.expectBalance(biz.wallet.clientId, c.balance, 0, 'არაფერი გაიყინა');
    console.log('✅ Forged signature → code 4, nothing stored');
  }

  /** არასწორი ident (8 / 10 ციფრი, ასოები, ცარიელი) → code 1 "Taxpayer not found", არაფერი ინახება */
  async invalidIdent(personId: string) {
    const lienNumber = `QA-L-${Date.now()}`;
    this.expectItemCode(OP_SIM_LIEN, await this.sim.lien(personId, MAX_AMOUNT, lienNumber), '1');
    const list = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: lienNumber })).content;
    assertCondition(OP_RESTRICTION, list.length === 0, `შეინახა ${list.length} restriction`, 'არაფერი შეინახა', list);
    console.log(`✅ Lien on "${personId}" → code 1`);
  }

  /** Reallocate უკვე მოხსნილ ყადაღაზე → 200 (known issue #41), მაგრამ არაფერი იცვლება: WITHDRAWN, held 0 */
  async reallocateWithdrawn(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const ctx = await this.setup(c);
    await this.withdraw(ctx.lienNumber);
    await this.expectBalance(ctx.clientId, c.balance, 0, 'მოხსნის შემდეგ held 0');
    const r = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: ctx.lienNumber })).content[0];
    RsHubApi.expectOk(OP_REALLOCATE, await this.api.reallocate(r.id));

    await sleep(4000);
    await this.expectRestriction(ctx.lienNumber, 'WITHDRAWN', 0);
    await this.expectBalance(ctx.clientId, c.balance, 0, 'მოხსნილი ყადაღა თავიდან არ გაიყინა');
    console.log('✅ Reallocate on withdrawn lien — nothing re-held');
  }

  /** Foreign ბიზნესი: RS ყადაღას აგზავნის ალტერნატიული პირადი ნომრით (personIdAlt) → wallet-ზე იყინება */
  async foreignLien(c: LienSetup) {
    this.guard(c.balance, c.lien);
    const alt = `9${String(Date.now()).slice(-10)}`;
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
      await this.api.createBusiness({ ...RsBusinessHelper.buildBody({ residency: 'FOREIGN' }), personalNumberAlt: alt }));
    const wallet = await this.newWallet(business.id, c.balance);
    const data = RsRegistrationHelper.buildData('FOREIGN', { identNumber: business.identificationNumber, personalNumberAlt: alt, ownerFullName: business.ownerFullName });
    const reg = RsHubApi.expectOk('POST /api/v1/rs/registrations',
      await this.api.createRegistration({ ...RsRegistrationHelper.body(data, wallet.clientId), submit: true }));
    await this.poll(OP_REG, APPROVE_TIMEOUT, 'status APPROVED (Foreign — CLIENT_NR)', async () => {
      const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(reg.id));
      return v.registration.status === 'APPROVED' ? v : undefined;
    });

    const lienNumber = `QA-L-${Date.now()}`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien('', c.lien, lienNumber, alt));
    const held = round(Math.min(c.balance, c.lien));
    await this.expectBalance(wallet.clientId, c.balance, held, `Foreign — გაყინულია ${held}`);
    await this.expectRestriction(lienNumber, statusFor(held, c.lien), held, c.lien);
    console.log(`✅ Foreign lien by personIdAlt ${alt} — held ${held}`);
  }

  /**
   * RS ეკითხება "ეს გადამხდელი ჩვენი კლიენტია?" (CheckPayer) → ჩვენ ვპასუხობთ (CHECK_PAYER_RESPONSE):
   *   ours     — Approved + wallet → პასუხში CheckPayer, შეცდომის გარეშე
   *   unknown  — ident ჩვენთან არ არის → Error code 1
   *   noWallet — რეგისტრაცია Approved, wallet არ აქვს → Error code 13
   */
  async checkPayer(kind: 'ours' | 'unknown' | 'noWallet') {
    let ident: string;
    if (kind === 'ours') ident = (await this.business(MAX_AMOUNT)).ident;
    else {
      const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
        await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
      ident = business.identificationNumber;
      if (kind === 'noWallet') await this.register(business);
    }
    this.expectAccepted('POST $SIM/orders/check-payer', await this.sim.checkPayer(ident));

    const op = 'GET $SIM/messages (CHECK_PAYER_RESPONSE)';
    const msg = await this.poll(op, HOLD_TIMEOUT, `CHECK_PAYER_RESPONSE ident ${ident}-ზე`, async () =>
      (await this.sim.messages(20)).find((m) => m.operation === 'CHECK_PAYER_RESPONSE' && String(m.signedXml).includes(ident)));
    const xml = String(msg.signedXml);
    const code = xml.match(/<Error><Code>(\d+)<\/Code>/)?.[1];
    const expected = kind === 'ours' ? undefined : kind === 'unknown' ? '1' : '13';
    assertCondition(op, code === expected, code ? `Error code ${code}` : 'შეცდომის გარეშე',
      expected ? `Error code ${expected}` : 'CheckPayer — შეცდომის გარეშე (ჩვენი კლიენტია)', xml.replace(/<Signature.*?<Object[^>]*>/s, '').slice(0, 600));
    console.log(`✅ CheckPayer ${kind} → ${code ? `code ${code}` : 'ours'}`);
  }

  // ─── ერთდროულად ───

  /**
   * HLD-12: wallet-ის გადარიცხვა (მთელი ბალანსი) და ყადაღა ერთდროულად → ან hold იღებს დარჩენილს, ან გადარიცხვა 5038;
   *   ინვარიანტი: held ≤ ბალანსი (თავისუფალი არასდროს < 0) (💸 თუ გადარიცხვამ გაასწრო)
   */
  async raceTransferAndLien(c: { balance: number; lien: number }) {
    this.guard(c.balance, c.lien);
    const biz = await this.business(c.balance);
    const token = await this.dist.token(biz.wallet.clientId, biz.wallet.clientSecret);
    const lienNumber = `QA-L-${Date.now()}`;
    const [tr, lien] = await Promise.all([
      this.dist.transfer(token, { amount: c.balance, uniqueId: randomUUID(), ...TRANSFER_TO }),
      this.sim.lien(biz.ident, c.lien, lienNumber),
    ]);
    this.expectAccepted(OP_SIM_LIEN, lien);
    await sleep(6000);

    const b = await this.gel(biz.wallet.clientId);
    const transferred = tr.status >= 200 && tr.status < 300;
    assertCondition(OP_CLIENT, b.held <= b.amount && b.amount >= 0, `ბალანსი ${b.amount} / held ${b.held}`, 'held ≤ ბალანსი (თავისუფალი ≥ 0)', b);
    if (transferred) await this.expectBalance(biz.wallet.clientId, 0, 0, 'გადარიცხვამ გაასწრო — გასაყინი აღარაფერია');
    else {
      this.expectRejected(OP_TRANSFER, tr, 400, 5038);
      await this.expectBalance(biz.wallet.clientId, c.balance, round(Math.min(c.balance, c.lien)), 'ყადაღამ გაასწრო — გადარიცხვა უარყოფილია');
    }
    console.log(`✅ Race — ${transferred ? 'transfer won' : 'lien won (5038)'}; held ${b.held} ≤ balance ${b.amount}`);
  }

  // ─── მომზადება ───

  /** ბიზნესი + WALLET სპეციალური body-ით (ვალუტა / unlimited) + შევსებები → Register to RS → APPROVED */
  private async customBusiness(walletOverrides: any, topups: [string, number][]): Promise<Biz> {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
      await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const created = RsHubApi.expectOk('POST /api/distributor-hub-client',
      await this.api.createClient(RsClientHelper.buildBody('WALLET', business.id, walletOverrides)));
    for (const [currency, amount] of topups) {
      if (amount > 0) RsHubApi.expectOk(OP_TOPUP, await this.api.updateBalance(created.clientId, { amount, currency, description: 'QA RS lien' }));
    }
    const reg = await this.register(business, created.clientId);
    return { ident: business.identificationNumber, businessId: business.id, regId: reg.id, registration: reg,
      wallet: { clientId: created.clientId, clientSecret: created.clientSecret } };
  }

  /** ბიზნესი + WALLET A (STANDARD) → Register to RS ამ wallet-ით → (approve) APPROVED → ბალანსი */
  private async business(balance: number, opts: { submit?: boolean; approve?: boolean; commission?: Commission } = {}): Promise<Biz> {
    const { submit = true, approve = true } = opts;
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
      await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const wallet = await this.newWallet(business.id, balance, opts.commission);
    const reg = await this.register(business, wallet.clientId, { submit, approve });
    return { ident: business.identificationNumber, businessId: business.id, regId: reg.id, registration: reg, wallet };
  }

  /** WALLET (STANDARD) ბიზნესზე + ბალანსი (+ საკომისიო) → clientId + clientSecret */
  private async newWallet(businessId: string, balance: number, commission?: Commission): Promise<Wallet> {
    const overrides = commission ? { currencyConfigs: gel({}, { commission: commission.value, commissionRateType: commission.type }) } : {};
    const created = RsHubApi.expectOk('POST /api/distributor-hub-client',
      await this.api.createClient(RsClientHelper.buildBody('WALLET', businessId, overrides)));
    if (balance > 0) {
      RsHubApi.expectOk(OP_TOPUP, await this.api.updateBalance(created.clientId, { amount: balance, currency: 'GEL', description: 'QA RS lien' }));
    }
    return { clientId: created.clientId, clientSecret: created.clientSecret, commission };
  }

  /** მეორე wallet: იმავე ident-ით Register to RS ახალი wallet-ით → იმავე რეგისტრაციას ემატება (enrollment ACTIVE) */
  private async addWallet(biz: Biz, balance: number): Promise<Wallet> {
    const wallet = await this.newWallet(biz.businessId, balance);
    const reg = RsHubApi.expectOk('POST /api/v1/rs/registrations (იგივე ident + ახალი wallet)',
      await this.api.createRegistration(RsRegistrationHelper.body(biz.registration.data, wallet.clientId)));
    assertField('POST /api/v1/rs/registrations (იგივე ident + ახალი wallet)', reg, 'id', biz.regId);
    const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(biz.regId));
    const e = v.enrollments.find((x: any) => x.holderRef === `CLIENT:${wallet.clientId}`);
    assertCondition(OP_REG, e?.status === 'ACTIVE', e ? `enrollment ${e.status}` : 'enrollment არ არის',
      `CLIENT:${wallet.clientId} — ACTIVE`, v.enrollments);
    return wallet;
  }

  /** ბიზნესი + 1 wallet + ბალანსი → RS აგზავნის ყადაღას → hold (held = min(ბალანსი, ყადაღა)) + restriction-ის სტატუსი */
  private async setup(c: LienSetup): Promise<Ctx> {
    const biz = await this.business(c.balance, { commission: c.commission });
    const lienNumber = `QA-L-${Date.now()}`;
    this.expectAccepted(OP_SIM_LIEN, await this.sim.lien(biz.ident, c.lien, lienNumber));
    const held = round(Math.min(c.balance, c.lien));
    await this.expectBalance(biz.wallet.clientId, c.balance, held, `ყადაღის შემდეგ held = ${held}`);
    await this.expectRestriction(lienNumber, statusFor(held, c.lien), held, c.lien);

    console.log(`✅ Lien ${c.lien} ₾ on ${biz.ident} — wallet ${biz.wallet.clientId}: balance ${c.balance} / held ${held}`);
    return { ...biz, ...biz.wallet, lienNumber };
  }

  /** Register to RS (walletId → enrollment) → submit → RS ადასტურებს → APPROVED */
  private async register(business: any, walletId?: string, opts: { submit?: boolean; approve?: boolean } = {}) {
    const { submit = true, approve = true } = opts;
    const data = RsRegistrationHelper.buildData('RESIDENT', {
      identNumber: business.identificationNumber, ownerFullName: business.ownerFullName,
      operDate: business.operDate, knownDate: business.knownDate,
    });
    const reg = RsHubApi.expectOk('POST /api/v1/rs/registrations',
      await this.api.createRegistration({ ...RsRegistrationHelper.body(data, walletId), submit }));
    if (!approve) return reg;
    await this.sim.approveTaxpayer(business.identificationNumber);
    await this.poll(OP_REG, APPROVE_TIMEOUT, 'status APPROVED', async () => {
      const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(reg.id));
      return v.registration.status === 'APPROVED' ? v : undefined;
    });
    return reg;
  }

  // ─── ნაბიჯები ───

  /**
   * wallet-ის გადარიცხვა IBAN-ზე: REJECTED → 400 / 5038, ბალანსი უცვლელი · OK → 2xx, ბალანსი −(amount + საკომისიო), held უცვლელი
   *   საკომისიო: FIXED — value; PERCENTAGE — amount × value% (თეთრამდე დამრგვალებული, 0.009 → 0.01)
   */
  private async transfer(w: Wallet, amount: number, expect: 'OK' | 'REJECTED', currency = 'GEL') {
    const fee = !w.commission ? 0 : w.commission.type === 'FIXED' ? w.commission.value : round((amount * w.commission.value) / 100);
    const before = await this.gel(w.clientId, currency);
    const token = await this.dist.token(w.clientId, w.clientSecret);
    const res = await this.dist.transfer(token, { amount, uniqueId: randomUUID(), ...TRANSFER_TO, currency });

    if (expect === 'REJECTED') {
      this.expectRejected(OP_TRANSFER, res, 400, 5038);
      await this.expectBalance(w.clientId, before.amount, before.held, 'უარის შემდეგ ბალანსი და held უცვლელია', HOLD_TIMEOUT, currency);
      console.log(`✅ Transfer ${amount} ₾ rejected (5038) — available ${round(before.amount - before.held)} ₾`);
    } else {
      assertCondition(OP_TRANSFER, res.status >= 200 && res.status < 300, `HTTP ${res.status}`, 'HTTP 2xx — თავისუფალი თანხა საკმარისია', res.body);
      await this.expectBalance(w.clientId, round(before.amount - amount - fee), before.held,
        `${currency} ბალანსი −${amount}${fee ? ` − საკომისიო ${fee}` : ''}, held უცვლელი`, HOLD_TIMEOUT, currency);
      console.log(`✅ Transfer ${amount} ₾${fee ? ` + fee ${fee}` : ''} OK — held ${before.held} ₾ untouched`);
    }
  }

  /** RS ხსნის ყადაღას → accepted, restriction WITHDRAWN, restricted 0 */
  private async withdraw(lienNumber: string) {
    this.expectAccepted(OP_SIM_OBTAIN, await this.sim.obtainLien(lienNumber));
    await this.expectRestriction(lienNumber, 'WITHDRAWN', 0);
  }

  // ─── შემოწმებები ───

  private guard(...amounts: number[]) {
    assertCondition('ტესტის კონფიგი', amounts.every((a) => a <= MAX_AMOUNT),
      `თანხა > ${MAX_AMOUNT} ₾: ${amounts.join(', ')}`, `STANDARD კლიენტი — ყველა თანხა ≤ ${MAX_AMOUNT} ₾ (რეალური გადარიცხვები)`, amounts);
  }

  /** wallet-ის ბალანსი ვალუტაში (default GEL): amount / held */
  private async gel(clientId: string, currency = 'GEL'): Promise<{ amount: number; held: number }> {
    const client = RsHubApi.expectOk(OP_CLIENT, await this.api.getClient(clientId));
    const b = (client.balances || []).find((x: any) => x.currency === currency) || { amount: 0, held: 0 };
    return { amount: round(b.amount), held: round(b.held) };
  }

  /** ბალანსი / held — poll (hold ასინქრონულად ჩნდება) */
  private async expectBalance(clientId: string, amount: number, held: number, why: string, timeout = HOLD_TIMEOUT, currency = 'GEL') {
    let last: any;
    const ok = await this.poll(OP_CLIENT, timeout, '', async () => {
      last = await this.gel(clientId, currency);
      return last.amount === round(amount) && last.held === round(held) ? last : undefined;
    }, false);
    assertCondition(OP_CLIENT, !!ok, `ბალანსი ${last?.amount} / held ${last?.held}`,
      `ბალანსი ${round(amount)} / held ${round(held)} — ${why}`, last);
  }

  /**
   * ყადაღის status + restricted (poll); requested-ით დამატებით (აქტიურ ყადაღაზე):
   *   requestedAmount = ყადაღა, remainingAmount = requested (ყადაღა არაფერს რიცხავს), executedAmount = 0,
   *   PARTIALLY_RESTRICTED → statusReason "Waiting for funds: <აკლია> GEL short"
   */
  private async expectRestriction(lienNumber: string, status: Status, restricted: number, requested?: number) {
    const op = OP_RESTRICTION + lienNumber;
    let last: any;
    const ok = await this.poll(OP_RESTRICTION, HOLD_TIMEOUT, '', async () => {
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: lienNumber })).content[0];
      return last?.status === status && round(last.restrictedAmount) === round(restricted) ? last : undefined;
    }, false);
    assertCondition(op, !!ok,
      last ? `status ${last.status}, restricted ${last.restrictedAmount}, ${last.statusReason || ''}` : 'restriction არ არსებობს',
      `status ${status}, restricted ${round(restricted)}`, last);
    if (requested === undefined || status === 'WITHDRAWN') return;

    assertCondition(op, round(last.requestedAmount) === round(requested), `requested ${last.requestedAmount}`, `requested ${round(requested)} (RS-ის ყადაღა)`, last);
    assertCondition(op, round(last.remainingAmount) === round(requested), `remaining ${last.remainingAmount}`,
      `remaining ${round(requested)} = requested (ყადაღა ფულს არ რიცხავს)`, last);
    assertCondition(op, round(last.executedAmount) === 0, `executed ${last.executedAmount}`, 'executed 0 (ყადაღა ფულს არ რიცხავს)', last);
    if (status === 'PARTIALLY_RESTRICTED') {
      const short = `${(requested - restricted).toFixed(2)} GEL short`;
      assertCondition(op, String(last.statusReason || '').includes(short), `statusReason: ${last.statusReason}`, `statusReason "Waiting for funds: ${short}"`, last);
    }
  }

  /** ამ ident-ზე ზუსტად 1 restriction და held არ გაორმაგდა */
  private async expectSingleRestriction(ctx: { ident: string; clientId: string }, c: LienSetup) {
    const list = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ personId: ctx.ident })).content;
    assertCondition(OP_RESTRICTION, list.length === 1, `ამ ident-ზე ${list.length} restriction`, 'ზუსტად 1 (დუბლიკატი არ შეინახა)', list);
    await this.expectBalance(ctx.clientId, c.balance, round(Math.min(c.balance, c.lien)), 'held არ გაორმაგდა');
  }

  private expectAccepted(op: string, res: any) {
    const item = res?.items?.[0];
    assertCondition(op, res?.accepted === true && item?.code === null,
      `code ${item?.code}: ${item?.description}`, 'accepted: true, items[0].code = null (მიღებულია)', res?.items);
  }

  private expectItemCode(op: string, res: any, code: string) {
    const item = res?.items?.[0];
    assertCondition(op, String(item?.code) === code, `code ${item?.code}: ${item?.description}`, `items[0].code = ${code}`, res?.items);
  }

  private expectRejected(op: string, res: ApiResult, http: number, code: number) {
    assertCondition(op, res.status === http && res.body?.statusCode === code,
      `HTTP ${res.status}, code ${res.body?.statusCode}`, `HTTP ${http} / code ${code}`, res.body);
  }

  /** fn → მნიშვნელობა (მზადაა) ან undefined; timeout → error (strict) ან undefined */
  private async poll<T>(op: string, timeout: number, expected: string, fn: () => Promise<T | undefined>, strict = true): Promise<T | undefined> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const v = await fn();
      if (v !== undefined) return v;
      await sleep(2000);
    }
    if (strict) assertCondition(op, false, `${timeout / 1000} წმ-ში არ მოხდა`, expected, null);
    return undefined;
  }
}
