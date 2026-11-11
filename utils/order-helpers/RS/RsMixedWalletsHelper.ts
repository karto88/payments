import { APIRequestContext } from '@playwright/test';
import { RsHubApi, digits } from './RsHubApi';
import { RsBusinessHelper } from './RsBusinessHelper';
import { RsLienHelper, RestrictionKind, Wallet } from './RsLienHelper';
import { RsFreshMerchant } from './RsFreshMerchant';
import { assertCondition } from '../../assertions';

const OP_REG_CREATE = 'POST /api/v1/rs/registrations (Register to RS — merchant-ის wallet-ით)';
const OP_REG = 'GET /api/v1/rs/registrations/{id}';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions/{id} (allocations — MERCHANT / CLIENT)';
const OP_REALLOCATE = 'POST /api/v1/rs/restrictions/{id}/reallocate';
const OP_BIZ = 'POST /api/distributor-hub-business (merchant-ის ident-ით)';
const HOLD_TIMEOUT = 30_000;
const ENROLL_TIMEOUT = 3 * 60_000;
const APPROVE_TIMEOUT = 60_000;

const round = (n: number) => Math.round(n * 100) / 100;


/** ერთი ქეისი: ახალი ბიზნესი — ახალი merchant (merchantBalance) + ახალი hub wallet (hubBalance), ერთ RS რეგისტრაციაზე */
export interface Mixed {
  regId: string;
  businessId: string;
  ident: string;
  merchant: RsFreshMerchant;
  merchantBalance: number;
  hub: Wallet;
  hubBalance: number;
}

/** ვინ რამდენს ყინავს: LARGEST_AVAILABLE_FIRST — ჯერ ვისაც მეტი აქვს, დანარჩენი — მეორეზე */
const plan = (merchant: number, hub: number, amount: number) => {
  const first = merchant >= hub ? 'merchant' : 'hub';
  const big = Math.max(merchant, hub), small = Math.min(merchant, hub);
  const a = round(Math.min(big, amount)), b = round(Math.min(small, amount - a));
  return first === 'merchant' ? { merchant: a, hub: b } : { merchant: b, hub: a };
};

/**
 * RS — ერთი გადამხდელი, ორი wallet: Distributor Hub-ის WALLET კლიენტი + payment-service-ის merchant (docs ENR-10, HLD-02/03/04, HLD-11, Example 1).
 *   📋 მიბმა 2 გზით: (1) merchant-ს ვუწერთ ბიზნესის Identification Number-ს → Register to RS merchant-ის wallet-ით → იგივე რეგისტრაცია
 *                    (2) merchant უკვე RS-შია → ბიზნესს ვუწერთ merchant-ის ident-ს → hub wallet იგივე რეგისტრაციას ებმის
 *   📋 ყადაღა / ინკასო იყინება ჯერ იქ, სადაც მეტი თავისუფალი ფულია (LARGEST_AVAILABLE_FIRST); merchant BALANCE flow — გაყინულს ვერ გაიტანს (2501)
 *   📋 Reallocate — ხელახლა ითვლის: ვისაც ახლა მეტი აქვს, იქ იყინება; მეორე თავისუფლდება
 *   ⚠️ ყოველი ქეისი — ახალი ბიზნესი: ახალი merchant (ნომერი 995300000001…, Temporary Verified, BALANCE flow) + ახალი hub wallet (სულ 2 wallet);
 *      merchant-ის ფული — add money 💳 (ბანკის OTP, ქეისზე 1); ბოლოს merchant იტანს მთელ ბალანსს, hub → 0 და იხსნება
 */
export class RsMixedWalletsHelper extends RsLienHelper {
  constructor(protected req: APIRequestContext, kind: RestrictionKind = 'LIEN') {
    super(req, kind);
  }

  // ─── მიბმა ───

  /**
   * გზა 1: ბიზნესი + hub wallet → რეგისტრაცია (Not submitted) → ახალი merchant ბიზნესის Identification Number-ით →
   *   Register to RS merchant-ის wallet-ით → იგივე რეგისტრაცია (ID არ იცვლება), 2 wallet: MERCHANT (payment-service) + CLIENT (distributor-hub)
   */
  async linkMerchantToBusiness() {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business', await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const hub = await this.newWallet(business.id, 0);
    const reg = await this.register(business, hub.clientId, { submit: false, approve: false });
    const merchant = await new RsFreshMerchant(this.req, business.identificationNumber, business.ownerFullName).create();
    const linked = await this.registerMerchant(reg.data, merchant);
    assertCondition(OP_REG_CREATE, linked.id === reg.id, `ახალი რეგისტრაცია ${linked.id}`, `იგივე რეგისტრაცია ${reg.id} (ერთი გადამხდელი — ერთი ღია რეგისტრაცია)`, linked);
    await this.expectTwoWallets(reg.id, merchant.id, hub.clientId);
    await this.onLinked(reg.id);
    console.log(`✅ Way 1: merchant ${merchant.name} → business ${business.identificationNumber} registration ${reg.id} — 2 wallets`);
  }

  /**
   * გზა 2: ახალი merchant → Register to RS (merchant-ის wallet-ით) → ბიზნესი merchant-ის Identification Number-ით + hub wallet →
   *   hub wallet თავისით ებმის merchant-ის რეგისტრაციას (ახალი არ იქმნება), 2 wallet
   */
  async linkBusinessToMerchant() {
    const { merchant, reg, business } = await this.merchantFirst();
    const hub = await this.newWallet(business.id, 0);
    await this.expectEnrolled(reg.id, hub.clientId);
    await this.expectTwoWallets(reg.id, merchant.id, hub.clientId);
    const again = RsHubApi.expectOk(OP_REG, await this.api.lookupRegistration({ identNumber: merchant.ident }));
    assertCondition(OP_REG, again.registration.id === reg.id, `lookup → ${again.registration.id}`, `ident ${merchant.ident} → იგივე რეგისტრაცია ${reg.id}`, again);
    await this.onLinked(reg.id);
    console.log(`✅ Way 2: business with merchant ident ${merchant.ident} → hub wallet joined registration ${reg.id} — 2 wallets`);
  }

  // ─── ყადაღა / ინკასო ორ wallet-ზე ───

  /**
   * merchant `merchant` ₾ + hub `hub` ₾ → ყადაღა / ინკასო `amount` → იყინება ჯერ უფრო დიდზე, დანარჩენი — მეორეზე (plan) →
   *   hub გადარიცხავს `hubTransfer`-ს: თავისუფალზე ნაკლები → ✅, მეტი → 5038 · merchant გაიტანს `merchantCashOut`-ს: თავისუფალზე ნაკლები → ✅, მეტი → 2501
   *   → RS ხსნის → ორივე თავისუფლდება
   */
  async holdCase(c: { merchant: number; hub: number; amount: number; hubTransfer?: number; merchantCashOut?: number }) {
    await this.withCase(c, async (m, number) => {
      const exp = plan(m.merchantBalance, m.hubBalance, c.amount);
      const status = round(exp.merchant + exp.hub) >= c.amount ? 'FULLY_RESTRICTED' : 'PARTIALLY_RESTRICTED';
      this.expectAccepted(this.opSend, await this.send(m.ident, c.amount, number));
      await this.expectHolds(number, m, exp, status);
      await this.onHeld(m, number);
      await this.checkMoves(m, exp, c.hubTransfer, c.merchantCashOut);
      this.expectAccepted(this.opObtain, await this.obtain(number));
      await this.expectHolds(number, m, { merchant: 0, hub: 0 }, 'WITHDRAWN');
      // მოხსნის შემდეგ ფული მართლა თავისუფალია: hub გადარიცხავს, merchant გაიტანს (0.01)
      await this.refreshBalances(m);
      await this.checkMoves(m, { merchant: 0, hub: 0 }, 0.01, 0.01);
      console.log(`✅ ${this.kind} ${c.amount}: merchant held ${exp.merchant}, hub held ${exp.hub}; after withdraw both move money`);
    });
  }

  /** ფული ორივეზე ნაკლებია ყადაღაზე → Partially restricted (ორივე მთლიანად) → hub-ს +`topUp` → hold თავისით ივსება (HLD-03) */
  async shortThenHubTopUp(c: { merchant: number; hub: number; amount: number; topUp: number }) {
    this.guard(c.topUp);
    await this.withCase(c, async (m, number) => {
      assertCondition('ტესტის კონფიგი', c.merchant + c.hub < c.amount, `${c.merchant} + ${c.hub}`, `ჯამი < ${c.amount}`, c);
      this.expectAccepted(this.opSend, await this.send(m.ident, c.amount, number));
      await this.expectHolds(number, m, { merchant: c.merchant, hub: c.hub }, 'PARTIALLY_RESTRICTED');
      await this.onHeld(m, number);
      await this.checkMoves(m, { merchant: c.merchant, hub: c.hub }, 0.01, 0.01);
      RsHubApi.expectOk('PUT balance', await this.api.updateBalance(m.hub.clientId, { amount: c.topUp, currency: 'GEL', description: 'QA RS mixed top-up' }));
      m.hubBalance = round(m.hubBalance + c.topUp);
      const hubHeld = round(Math.min(m.hubBalance, c.amount - c.merchant));
      await this.expectHolds(number, m, { merchant: c.merchant, hub: hubHeld }, round(c.merchant + hubHeld) >= c.amount ? 'FULLY_RESTRICTED' : 'PARTIALLY_RESTRICTED');
      await this.onHeld(m, number);
      console.log(`✅ ${this.kind} ${c.amount} short → hub +${c.topUp} → hub held ${c.hub} → ${hubHeld}`);
    });
  }

  /** ორივეს თანაბარი ბალანსი → ერთი მთლიანად, მეორე — დანარჩენი (ვინ — integrator-ის პრიორიტეტი, HLD-04) */
  async equalBalances(c: { balance: number; amount: number }) {
    await this.withCase({ merchant: c.balance, hub: c.balance }, async (m, number) => {
      this.expectAccepted(this.opSend, await this.send(m.ident, c.amount, number));
      const d = await this.poll(OP_RESTRICTION, HOLD_TIMEOUT, `allocations ჯამი ${c.amount}`, async () => {
        const x = await this.restriction(number);
        return x && round(this.held(x, `MERCHANT:${m.merchant.id}`) + this.held(x, `CLIENT:${m.hub.clientId}`)) === c.amount ? x : undefined;
      });
      const mh = this.held(d, `MERCHANT:${m.merchant.id}`), hh = this.held(d, `CLIENT:${m.hub.clientId}`);
      const rest = round(c.amount - c.balance);
      assertCondition(OP_RESTRICTION, (mh === c.balance && hh === rest) || (hh === c.balance && mh === rest), `merchant ${mh}, hub ${hh}`,
        `ერთზე მთლიანად ${c.balance}, მეორეზე ${rest}`, d.allocations);
      await this.onHeld(m, number);
      // ვინც მთლიანად გაიყინა — ვერაფერს; მეორეს თავისუფალი რჩება → 0.01 გადის
      await this.checkMoves(m, { merchant: mh, hub: hh }, 0.01, 0.01);
      console.log(`✅ Equal ${c.balance} / ${c.balance}, ${this.kind} ${c.amount} → ${mh === c.balance ? 'merchant' : 'hub'} first (merchant ${mh}, hub ${hh})`);
    });
  }

  /**
   * ჯერ მხოლოდ hub (`hub`), ყადაღა / ინკასო `amount` > hub → hub მთლიანად, აკლია →
   *   მერე ბიზნესს ემატება ახალი merchant (`merchant` ₾) → მიბმისთანავე რა ხდება (ლოგში) → Reallocate →
   *   ჯამი = min(ყადაღა, ორივე), ჯერ უფრო დიდზე (plan) → ვისაც რჩება, იმას შეუძლია გატანა / გადარიცხვა
   */
  async merchantAddedLater(c: { hub: number; amount: number; merchant: number }) {
    this.guard(c.hub, c.amount, c.merchant);
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business', await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const hub = await this.newWallet(business.id, c.hub);
    const reg = await this.register(business, hub.clientId);
    const number = `${this.prefix}-LATE-${Date.now()}`;
    const merchant = new RsFreshMerchant(this.req, business.identificationNumber, business.ownerFullName);
    const m: Mixed = { regId: reg.id, businessId: business.id, ident: business.identificationNumber, merchant, merchantBalance: 0, hub, hubBalance: c.hub };
    try {
      this.expectAccepted(this.opSend, await this.send(m.ident, c.amount, number));
      await this.expectHolds(number, m, { hub: c.hub }, 'PARTIALLY_RESTRICTED');
      await this.transfer(hub, 0.01, 'REJECTED');

      await merchant.create();
      await this.registerMerchant(reg.data, merchant);
      await this.expectTwoWallets(reg.id, merchant.id, hub.clientId);
      await merchant.setBalance(c.merchant);
      m.merchantBalance = c.merchant;
      const now = await this.restriction(number);
      console.log(`ℹ️ Merchant linked after ${this.kind} — before Reallocate: merchant held ${this.held(now, `MERCHANT:${merchant.id}`)}, hub held ${this.held(now, `CLIENT:${hub.clientId}`)}`);

      const r = RsHubApi.expectOk('GET restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0];
      await this.reallocate(m, number, r.id);
      const exp = plan(c.merchant, c.hub, c.amount);
      await this.expectHolds(number, m, exp, round(exp.merchant + exp.hub) >= c.amount ? 'FULLY_RESTRICTED' : 'PARTIALLY_RESTRICTED');
      await this.onHeld(m, number);
      await this.checkMoves(m, exp, round(c.hub - exp.hub) > 0 ? round(c.hub - exp.hub) : 0.01, round(c.merchant - exp.merchant) > 0 ? round(c.merchant - exp.merchant) : 0.01);
      console.log(`✅ Merchant added later → Reallocate → merchant held ${exp.merchant}, hub held ${exp.hub}`);
    } finally {
      await this.obtain(number).catch(() => undefined);
      await this.expectHolds(number, m, { hub: 0 }, undefined).catch(() => undefined);
      if (merchant.id) await merchant.drain().catch(() => undefined);
      await this.detach(business.id, hub.clientId).catch(() => undefined);
    }
  }

  /**
   * ჯერ მხოლოდ merchant (`merchant`), ყადაღა / ინკასო `amount` > merchant → merchant მთლიანად, აკლია → merchant ვერ გაიტანს →
   *   მერე ბიზნესს ემატება hub wallet (`hub` ₾) → მიბმისთანავე რა ხდება (ლოგში) → Reallocate →
   *   ჯამი = min(ყადაღა, ორივე), ჯერ უფრო დიდზე (plan) → ვისაც რჩება, იმას შეუძლია გადარიცხვა / გატანა
   */
  async hubAddedLater(c: { merchant: number; amount: number; hub: number }) {
    this.guard(c.merchant, c.amount, c.hub);
    const m = await this.freshBusiness({ merchant: c.merchant, hub: null });
    const number = `${this.prefix}-LATE-${Date.now()}`;
    await this.cleanupAfter(m, number, async () => {
      this.expectAccepted(this.opSend, await this.send(m.ident, c.amount, number));
      await this.expectHolds(number, m, { merchant: c.merchant }, 'PARTIALLY_RESTRICTED');
      await m.merchant.expectCashOutRejected(0.01);

      m.hub = await this.newWallet(m.businessId, c.hub);
      m.hubBalance = c.hub;
      await this.expectEnrolled(m.regId, m.hub.clientId);
      await this.expectTwoWallets(m.regId, m.merchant.id, m.hub.clientId);
      const now = await this.restriction(number);
      console.log(`ℹ️ Hub linked after ${this.kind} — before Reallocate: merchant held ${this.held(now, `MERCHANT:${m.merchant.id}`)}, hub held ${this.held(now, `CLIENT:${m.hub.clientId}`)}`);

      const r = RsHubApi.expectOk('GET restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0];
      await this.reallocate(m, number, r.id);
      const exp = plan(c.merchant, c.hub, c.amount);
      await this.expectHolds(number, m, exp, round(exp.merchant + exp.hub) >= c.amount ? 'FULLY_RESTRICTED' : 'PARTIALLY_RESTRICTED');
      await this.onHeld(m, number);
      await this.checkMoves(m, exp, round(c.hub - exp.hub) > 0 ? round(c.hub - exp.hub) : 0.01, round(c.merchant - exp.merchant) > 0 ? round(c.merchant - exp.merchant) : 0.01);
      console.log(`✅ Hub added later → Reallocate → merchant held ${exp.merchant}, hub held ${exp.hub}`);
    });
  }

  /**
   * ინკასო merchant + hub-ზე → Request amount → ადმინი იხდის `pay`-ს → ჩამოიჭრება გაყინულიდან (API transfers-ის მიხედვით),
   *   ჯამი = pay; თითო wallet-ის ბალანსი −მისი წილი
   */
  async collectionPaidFromBoth(c: { merchant: number; hub: number; amount: number; pay: number }) {
    this.guard(c.pay);
    await this.withCase(c, async (m, number) => {
      const exp = plan(m.merchantBalance, m.hubBalance, c.amount);
      this.expectAccepted(this.opSend, await this.send(m.ident, c.amount, number));
      const r = await this.expectHolds(number, m, exp, 'FULLY_RESTRICTED');
      await this.payCollection(m, number, r.id, c.pay);
      const d = await this.poll(OP_RESTRICTION, 120_000, `ჩამოჭრა დასრულდა: executed ${c.pay}, ყველა transfer SUCCESS`, async () => {
        const x = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(r.id));
        const done = round(x.restriction.executedAmount) === c.pay && (x.transfers || []).length > 0 && x.transfers.every((t: any) => t.status === 'SUCCESS');
        return done ? x : undefined;
      });
      const part = (ref: string) => round(d.transfers.filter((t: any) => t.holderRef === ref).reduce((a: number, t: any) => a + Number(t.amount), 0));
      const fromMerchant = part(`MERCHANT:${m.merchant.id}`);
      const fromHub = part(`CLIENT:${m.hub.clientId}`);
      assertCondition(OP_RESTRICTION, round(fromMerchant + fromHub) === c.pay, `merchant ${fromMerchant} + hub ${fromHub}`, `ჯამი = გადახდა ${c.pay}`, d.transfers);
      await this.expectBalance(m.hub.clientId, round(m.hubBalance - fromHub), round(exp.hub - fromHub), `hub: −${fromHub} ჩამოიჭრა`);
      const mb = await this.poll('GET walletportal /wallet/balances', HOLD_TIMEOUT, `merchant: ${m.merchantBalance} − ${fromMerchant}`, async () => {
        const b = await m.merchant.balance();
        return b === round(m.merchantBalance - fromMerchant) ? b : undefined;
      });
      await this.onPaid(m, number, d);
      // გადახდის შემდეგ ვის რა შეუძლია: დარჩენილი გაყინულია, თავისუფალი — გადის
      m.merchantBalance = mb;
      m.hubBalance = round(m.hubBalance - fromHub);
      const left = { merchant: this.held(d, `MERCHANT:${m.merchant.id}`), hub: this.held(d, `CLIENT:${m.hub.clientId}`) };
      await this.checkMoves(m, left, 0.01, 0.01);
      console.log(`✅ Collection ${c.amount} paid ${c.pay}: merchant −${fromMerchant} (now ${mb}, held ${left.merchant}), hub −${fromHub} (held ${left.hub})`);
    });
  }

  // ─── Reallocate ───

  /**
   * ორივე მთლიანად გაყინულია (ყადაღა = merchant + hub) → hub ვერ გადარიცხავს →
   *   merchant-ს add money `topUp` (💳 OTP) — ახალი ფული თავისუფალია (ყადაღა უკვე დაფარულია) →
   *   Reallocate → merchant-ს ახლა მეტი აქვს → მთელი თანხა merchant-ზე, **hub თავისუფლდება** → hub გადარიცხავს `hubTransfer`-ს ✅
   */
  async reallocateToMerchant(c: { merchant: number; hub: number; topUp: number; hubTransfer: number }) {
    this.guard(c.topUp, c.hubTransfer);
    await this.withCase(c, async (m, number) => {
      const amount = round(c.merchant + c.hub);
      this.expectAccepted(this.opSend, await this.send(m.ident, amount, number));
      const r = await this.expectHolds(number, m, { merchant: c.merchant, hub: c.hub }, 'FULLY_RESTRICTED');
      await this.transfer(m.hub, c.hubTransfer, 'REJECTED');
      m.merchantBalance = await m.merchant.addMoney(c.topUp);
      assertCondition('ტესტის წინაპირობა', m.merchantBalance >= amount, `merchant ${m.merchantBalance}`, `add money-ს შემდეგ merchant ≥ ${amount} (მთლიანად დაფარავს)`, null);
      await this.expectHolds(number, m, { merchant: c.merchant, hub: c.hub }, 'FULLY_RESTRICTED');
      await this.reallocate(m, number, r.id);
      await this.expectHolds(number, m, { merchant: amount, hub: 0 }, 'FULLY_RESTRICTED');
      await this.onHeld(m, number);
      await this.expectBalance(m.hub.clientId, c.hub, 0, 'Reallocate — hub თავისუფალია');
      await this.transfer(m.hub, c.hubTransfer, 'OK');
      await m.merchant.expectCashOutRejected(round(m.merchantBalance - amount + 0.05));
      console.log(`✅ Reallocate → merchant: whole ${amount} on merchant (${m.merchantBalance}), hub released and transferred ${c.hubTransfer}`);
    });
  }

  /**
   * ორივე მთლიანად გაყინულია → hub-ს ემატება `hubTopUp` (ადმინი) → Reallocate → hub-ს ახლა მეტი აქვს →
   *   მთელი თანხა hub-ზე, **merchant თავისუფლდება** → merchant იტანს `merchantCashOut`-ს თავის ანგარიშზე ✅
   */
  async reallocateToHub(c: { merchant: number; hub: number; hubTopUp: number; merchantCashOut: number }) {
    this.guard(c.hubTopUp, c.merchantCashOut);
    await this.withCase(c, async (m, number) => {
      const amount = round(c.merchant + c.hub);
      this.expectAccepted(this.opSend, await this.send(m.ident, amount, number));
      const r = await this.expectHolds(number, m, { merchant: c.merchant, hub: c.hub }, 'FULLY_RESTRICTED');
      await m.merchant.expectCashOutRejected(c.merchantCashOut);
      RsHubApi.expectOk('PUT balance', await this.api.updateBalance(m.hub.clientId, { amount: c.hubTopUp, currency: 'GEL', description: 'QA RS realloc' }));
      m.hubBalance = round(m.hubBalance + c.hubTopUp);
      assertCondition('ტესტის კონფიგი', m.hubBalance >= amount && m.hubBalance > c.merchant, `hub ${m.hubBalance}`, `hub ≥ ${amount} და > merchant`, c);
      await this.expectHolds(number, m, { merchant: c.merchant, hub: c.hub }, 'FULLY_RESTRICTED');
      await this.reallocate(m, number, r.id);
      await this.expectHolds(number, m, { merchant: 0, hub: amount }, 'FULLY_RESTRICTED');
      await this.onHeld(m, number);
      await m.merchant.expectCashOutOk(c.merchantCashOut);
      await this.transfer(m.hub, round(m.hubBalance - amount + 0.01), 'REJECTED');
      console.log(`✅ Reallocate → hub: whole ${amount} on hub (${m.hubBalance}), merchant released and cashed out ${c.merchantCashOut}`);
    });
  }

  // ─── შემოწმების წერტილები (ფრონტის helper აქ UI-ს ამოწმებს; API-ის ტესტში — არაფერი) ───

  /** wallet-ები მიბმულია (რეგისტრაციაზე 2 ACTIVE wallet) */
  protected async onLinked(_regId: string): Promise<void> {}
  /** ყადაღა / ინკასო გაიყინა (allocations = მოსალოდნელი) */
  protected async onHeld(_m: Mixed, _number: string): Promise<void> {}
  /** ინკასოს გადახდა დასრულდა (d = GET restriction: executions, transfers, allocations) */
  protected async onPaid(_m: Mixed, _number: string, _d: any): Promise<void> {}
  /** ინკასოს გადახდა: Request amount → RS-ის პასუხი → ხელით გადახდის ჩაწერა `pay` (API-ის ტესტში — API; ფრონტის helper-ში — ღილაკები) */
  protected async payCollection(_m: Mixed, _number: string, restrictionId: string, pay: number): Promise<void> {
    RsHubApi.expectOk('POST /api/v1/rs/restrictions/{id}/request-amount', await this.api.requestAmount(restrictionId));
    const exec = await this.poll(OP_RESTRICTION, 60_000, 'RS-ის პასუხი (execution AMOUNT_RECEIVED)', async () =>
      (RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(restrictionId)).executions || []).find((e: any) => e.status === 'AMOUNT_RECEIVED'));
    RsHubApi.expectOk('POST /api/v1/rs/restrictions/{id}/manual-payment', await this.api.manualPayment(restrictionId,
      { executionId: exec.id, amount: pay, paidAt: new Date().toISOString(), bankReference: `QA-MIX-${digits(6)}` }));
  }

  /** Reallocate: API-ის ტესტში — POST …/reallocate; ფრონტის helper-ში — ღილაკი "Reallocate holds" */
  protected async reallocate(_m: Mixed, _number: string, restrictionId: string): Promise<void> {
    RsHubApi.expectOk(OP_REALLOCATE, await this.api.reallocate(restrictionId));
  }

  /** ბალანსები თავიდან: merchant (walletportal) + hub (admin) */
  private async refreshBalances(m: Mixed) {
    if (m.merchant.id) m.merchantBalance = await m.merchant.balance();
    if (m.hub.clientId) m.hubBalance = (await this.gel(m.hub.clientId)).amount;
  }

  // ─── შიდა ───

  /**
   * ქეისი — ყოველთვის ახალი ბიზნესი: ახალი merchant (გზა 2) + Approved რეგისტრაცია + ახალი hub wallet (სულ 2 wallet) →
   *   ბალანსები: merchant `merchant` (add money 💳 OTP, თუ > 0), hub `hub` → fn →
   *   ბოლოს: ყადაღა / ინკასო იხსნება, merchant იტანს მთელ ბალანსს, hub → 0 და იხსნება ბიზნესიდან
   */
  private async withCase(c: { merchant: number; hub: number }, fn: (m: Mixed, number: string) => Promise<void>) {
    this.guard(c.merchant, c.hub);
    const m = await this.freshBusiness({ merchant: c.merchant, hub: c.hub });
    const number = `${this.prefix}-MIX-${Date.now()}`;
    await this.cleanupAfter(m, number, () => fn(m, number));
  }

  /** ახალი ბიზნესი: merchant (გზა 2) → Approved → ბალანსი; hub wallet (`hub` = null → hub-ის გარეშე, ემატება მოგვიანებით) */
  private async freshBusiness(c: { merchant: number; hub: number | null }): Promise<Mixed> {
    const { merchant, reg, business } = await this.merchantFirst();
    await this.sim.approveTaxpayer(merchant.ident);
    await this.poll(OP_REG, APPROVE_TIMEOUT, 'რეგისტრაცია APPROVED', async () =>
      RsHubApi.expectOk(OP_REG, await this.api.getRegistration(reg.id)).registration.status === 'APPROVED' || undefined);
    if (c.merchant > 0) await merchant.setBalance(c.merchant);
    let hub: Wallet = { clientId: '', clientSecret: '' };
    if (c.hub !== null) {
      hub = await this.newWallet(business.id, c.hub);
      await this.expectEnrolled(reg.id, hub.clientId);
      await this.expectTwoWallets(reg.id, merchant.id, hub.clientId);
    }
    console.log(`✅ Business ${merchant.ident}: merchant 995${merchant.phone} ${c.merchant} ₾${c.hub !== null ? ` + hub ${c.hub} ₾` : ' (hub — მოგვიანებით)'} (registration ${reg.id})`);
    return { regId: reg.id, businessId: business.id, ident: merchant.ident, merchant, merchantBalance: c.merchant, hub, hubBalance: c.hub ?? 0 };
  }

  /** fn → ბოლოს (ჩავარდნაზეც): ყადაღა / ინკასო იხსნება, merchant → 0, hub → 0 და იხსნება (გაწმენდის შეცდომა ტესტის შეცდომას არ ფარავს) */
  private async cleanupAfter(m: Mixed, number: string, fn: () => Promise<void>) {
    let failed = false;
    try {
      await fn();
    } catch (e) {
      failed = true;
      throw e;
    } finally {
      await this.obtain(number).catch(() => undefined);
      await this.expectHolds(number, m, { merchant: 0, hub: 0 }, undefined).catch(() => undefined);
      const clean = async () => {
        if (m.merchant.id) await m.merchant.drain();
        if (m.hub.clientId) await this.detach(m.businessId, m.hub.clientId);
      };
      if (failed) await clean().catch(() => undefined);
      else await clean();
    }
  }

  /** ახალი merchant (ახალი ident) → Register to RS → ბიზნესი იგივე ident-ით (wallet-ის გარეშე) */
  private async merchantFirst() {
    const body = { ...RsBusinessHelper.buildBody({ residency: 'RESIDENT' }), identificationNumber: `9${digits(8)}` };
    const merchant = await new RsFreshMerchant(this.req, body.identificationNumber, body.ownerFullName).create();
    const reg = await this.registerMerchant({ residency: 'RESIDENT', identNumber: merchant.ident, ownerFullName: body.ownerFullName, operDate: body.operDate, knownDate: body.knownDate }, merchant);
    assertCondition(OP_REG_CREATE, reg.status === 'NOT_SUBMITTED', `status ${reg.status}`, 'NOT_SUBMITTED', reg);
    const business = RsHubApi.expectOk(OP_BIZ, await this.api.createBusiness(body));
    return { merchant, reg, business };
  }

  /** Register to RS merchant-ის wallet-ით (merchant-ის RS ტაბიდან) → რეგისტრაცია (არსებობს → merchant მას ებმის) */
  private async registerMerchant(data: any, merchant: RsFreshMerchant): Promise<any> {
    return RsHubApi.expectOk(OP_REG_CREATE, await this.api.createRegistration({ partnerCode: 'keepz', data, enrollment: merchant.enrollment(), submit: false }));
  }

  /** hub-ის გადარიცხვა / merchant-ის გატანა: თავისუფალზე (ბალანსი − გაყინული) ნაკლები → ✅, მეტი → უარი */
  private async checkMoves(m: Mixed, held: { merchant: number; hub: number }, hubTransfer?: number, merchantCashOut?: number) {
    if (hubTransfer) await this.transfer(m.hub, hubTransfer, hubTransfer <= round(m.hubBalance - held.hub) ? 'OK' : 'REJECTED');
    if (merchantCashOut) {
      if (merchantCashOut <= round(m.merchantBalance - held.merchant)) await m.merchant.expectCashOutOk(merchantCashOut);
      else await m.merchant.expectCashOutRejected(merchantCashOut);
    }
  }

  /** hub wallet → ბალანსი 0 და ბიზნესიდან მოხსნა */
  private async detach(businessId: string, clientId: string) {
    const b = await this.gel(clientId);
    if (b.amount > 0) RsHubApi.expectOk('PUT balance (debit)', await this.api.updateBalance(clientId, { amount: -b.amount, currency: 'GEL', description: 'QA RS mixed cleanup' }));
    // ყადაღა / ინკასო მოხსნილია, held 0 → wallet ბიზნესიდან უნდა მოიხსნას (🐞 ჩამოჭრის შემდეგ → 5114 "Money is held on this client for RS")
    const res = await this.api.unlinkClient(businessId, clientId);
    assertCondition('DELETE /api/distributor-hub-business/{id}/clients/{clientId}', res.status >= 200 && res.status < 300,
      `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`, `wallet (held ${b.held}) ბიზნესიდან იხსნება — RS-მა ყველაფერი მოხსნა`, res.body);
  }

  /** რეგისტრაციაზე ზუსტად 2 ACTIVE wallet: MERCHANT (payment-service) + CLIENT (distributor-hub) */
  private async expectTwoWallets(regId: string, merchantId: string, clientId: string) {
    const v = await this.poll(OP_REG, ENROLL_TIMEOUT, 'MERCHANT + CLIENT ACTIVE', async () => {
      const x = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(regId));
      const active = x.enrollments.filter((e: any) => e.status === 'ACTIVE');
      return active.some((e: any) => e.holderRef === `MERCHANT:${merchantId}`) && active.some((e: any) => e.holderRef === `CLIENT:${clientId}`) ? x : undefined;
    });
    const active = v.enrollments.filter((e: any) => e.status === 'ACTIVE');
    const m = active.find((e: any) => e.holderRef === `MERCHANT:${merchantId}`);
    const h = active.find((e: any) => e.holderRef === `CLIENT:${clientId}`);
    assertCondition(OP_REG, active.length === 2 && m.integrator === 'payment-service' && h.integrator === 'distributor-hub',
      `${active.length} wallet: ${active.map((e: any) => `${e.holderRef} (${e.integrator})`).join(', ')}`,
      `2 wallet: MERCHANT:${merchantId} (payment-service) + CLIENT:${clientId} (distributor-hub)`, v.enrollments);
    return v;
  }

  protected async restriction(number: string): Promise<any> {
    const x = RsHubApi.expectOk('GET restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0];
    return x ? RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(x.id)) : undefined;
  }

  private held(d: any, ref: string) {
    return round(Number(d.allocations.find((a: any) => a.holderRef === ref)?.held ?? 0));
  }

  /** allocations: MERCHANT / CLIENT held = მოსალოდნელი; status (თუ მითითებულია) → restriction */
  private async expectHolds(number: string, m: Mixed, exp: { merchant?: number; hub?: number }, status?: string): Promise<any> {
    let last: any;
    const ok = await this.poll(OP_RESTRICTION, HOLD_TIMEOUT, '', async () => {
      last = await this.restriction(number);
      if (!last) return undefined;
      const match = (exp.merchant === undefined || this.held(last, `MERCHANT:${m.merchant.id}`) === round(exp.merchant))
        && (exp.hub === undefined || this.held(last, `CLIENT:${m.hub.clientId}`) === round(exp.hub)) && (!status || last.restriction.status === status);
      return match ? last.restriction : undefined;
    }, false);
    assertCondition(OP_RESTRICTION, !!ok,
      `${last?.restriction?.status} · ${(last?.allocations || []).map((a: any) => `${a.holderRef.split(':')[0]} held ${a.held}`).join(', ')}`,
      `${status ?? ''} · merchant held ${exp.merchant ?? '-'} · hub held ${exp.hub ?? '-'}`, last?.allocations);
    return ok;
  }
}
