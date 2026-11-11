import { APIRequestContext } from '@playwright/test';
import { RsHubApi, RsSimulatorApi } from './RsHubApi';
import { RsBusinessHelper } from './RsBusinessHelper';
import { RsClientHelper } from './RsClientHelper';
import { assertCondition, assertField } from '../../assertions';

const OP_SIM_COLLECTION = 'POST $SIM/orders/collection (RS → ინკასო)';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions/{id} (ინკასო)';
const OP_REQUEST = 'POST /api/v1/rs/restrictions/{id}/request-amount';
const OP_HISTORY = 'GET /api/v1/rs/restrictions/{id}/history';
const OP_MANUAL = 'POST /api/v1/rs/restrictions/{id}/manual-payment';
const OP_REG = 'GET /api/v1/rs/registrations/{id}';
const OP_CLIENT = 'GET /api/distributor-hub-client/{id} (balances GEL)';
const OP_RETURN = 'POST /api/v1/rs/restrictions/{id}/return';
const OP_ENFORCE = 'POST /api/v1/rs/restrictions/{id}/start-enforcement';

/** ⚠️ hub კლიენტი STANDARD = რეალური ფული → ბალანსი / ინკასო ≤ 1 ₾ */
const MAX_AMOUNT = 1;
const TIMEOUT = 30_000;
/** ბიზნესის wallet RS რეგისტრაციას თავისით ებმის (~2 წთ) */
const ENROLL_TIMEOUT = 3 * 60_000;
/** ხელით გადახდის შემდეგ ჩამოჭრა (settlement): retry 5 / 10 / 15 წმ → 2 წთ */
const SETTLE_TIMEOUT = 120_000;

const round = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Hub {
  ident: string;
  clientId: string;
}

/**
 * RS ინკასო (Collection) — ხელით რეჟიმი (treasury payments: MANUAL), hub WALLET კლიენტზე.
 *   📋 RS აგზავნის ინკასოს → wallet-ზე იყინება თანხა (FULLY_RESTRICTED)
 *   📋 ადმინი: Request amount → RS-ს მიდის CheckCollectionAmount → RS პასუხობს თანხით
 *   📋 სისტემა თვითონ არ რიცხავს: execution AMOUNT_RECEIVED, history MANUAL_PAYMENT_NEEDED (Ops-ს მეილი "RS asks X GEL")
 *   📋 Ops ხაზინაზე რიცხავს ბანკიდან ხელით → ადმინი აფიქსირებს: manual-payment → wallet ჩამოჭრის (paidOutside, მეორედ არ იხდება)
 *      → execution COMPLETED, ინკასო EXECUTED; იმავე დღეს RS-ს CollectionAccomplish
 *   ⚠️ merchant-ზე (payment-service) ხელით გადახდა არ მუშაობს — მხოლოდ hub wallet
 * Docs: KD-2241, RS Integration Test Guide → data.js (COL-15 … COL-18), api.js (panel-restr-manual-payment)
 */
export class RsCollectionHelper {
  private api: RsHubApi;
  private sim: RsSimulatorApi;

  constructor(request: APIRequestContext) {
    this.api = new RsHubApi(request);
    this.sim = new RsSimulatorApi(request);
  }

  /**
   * COL-15: wallet-ზე `balance` → ინკასო `amount` → Request amount → RS პასუხობს → ადმინი აფიქსირებს ხელით გადახდას
   *   (სიმულაცია — "ხაზინაზე ბანკიდან გადავრიცხე") → wallet ჩამოჭრის → ინკასო EXECUTED, ბალანსი −amount, გაყინული 0
   */
  async manualPayment(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    let recorded = false;
    try {
      const { id, exec } = await this.collectionAnswered(hub, number, c.balance, c.amount);
      recorded = true;
      await this.recordAndSettle(id, exec.id, c.amount, 'EXECUTED');
      await this.expectWallet(hub.clientId, round(c.balance - c.amount), 0, `ჩამოიჭრა ${c.amount}, გაყინვა მოიხსნა`);
      console.log(`✅ Collection EXECUTED — wallet ${c.balance} → ${round(c.balance - c.amount)}, held 0`);
    } finally {
      if (!recorded) await this.sim.obtainCollection(number);
    }
  }

  /**
   * COL-18: ფული ინკასოზე ნაკლებია (Partially restricted) → RS პასუხობს მთელ ინკასოს → `over` (გაყინულზე მეტი) → 400 7032
   *   → `pay` (გაყინულზე ნაკლები) → COMPLETED, ინკასო PARTIALLY_EXECUTED: ვალი = ინკასო − pay, wallet-ზე გაყინული რჩება held − pay
   */
  async partialManualPayment(c: { balance: number; amount: number; over: number; pay: number }) {
    this.guard(c.balance, c.over, c.pay);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    try {
      const { id, exec } = await this.collectionAnswered(hub, number, c.balance, c.amount);
      await this.expectRejected(id, { executionId: exec.id, amount: c.over }, 400, 7032, `${c.over} ₾ > გაყინული ${c.balance} ₾`);
      await this.recordAndSettle(id, exec.id, c.pay, 'PARTIALLY_EXECUTED');
      const r = (await this.restriction(id)).restriction;
      const owed = round(c.amount - c.pay);
      assertCondition(OP_RESTRICTION, round(r.remainingAmount) === owed, `remaining ${r.remainingAmount}`, `ვალი რჩება ${owed} (${c.amount} − ${c.pay})`, r);
      await this.expectWallet(hub.clientId, round(c.balance - c.pay), round(c.balance - c.pay), `ჩამოიჭრა ${c.pay}; დარჩენილი ${round(c.balance - c.pay)} ისევ გაყინულია ვალზე`);
      console.log(`✅ Partial manual payment ${c.pay} ₾ — PARTIALLY_EXECUTED, owed ${owed}, wallet still held ${round(c.balance - c.pay)}`);
    } finally {
      await this.sim.obtainCollection(number); // დარჩენილი ვალი იხსნება — wallet-ზე ფული გაყინული არ რჩება
    }
  }

  /** COL-17: ხელით გადახდა RS-ის პასუხამდე (Request amount-მდე) → 409 7031, არაფერი ჩამოიჭრა */
  async manualPaymentBeforeAnswer(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    try {
      const id = await this.sendCollection(hub, number, c.balance, c.amount);
      await this.expectRejected(id, { amount: c.amount }, 409, 7031, 'RS-ის პასუხი (Request amount) ჯერ არ არის');
      await this.expectWallet(hub.clientId, c.balance, round(Math.min(c.balance, c.amount)), 'არაფერი ჩამოიჭრა');
    } finally {
      await this.sim.obtainCollection(number);
    }
  }

  /**
   * COL-17: RS-ის პასუხის შემდეგ არასწორი გადახდა → უარი, არაფერი ჩამოიჭრა, execution ისევ AMOUNT_RECEIVED:
   *   over — RS-ის პასუხზე მეტი (400 7032) · zero — 0 · decimals — 3 ციფრი (0.055) · noReference — ცარიელი bankReference ·
   *   future — paidAt მომავალში (400 ვალიდაცია)
   */
  async manualPaymentInvalid(kind: 'over' | 'zero' | 'decimals' | 'noReference' | 'future', c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    try {
      const { id, exec } = await this.collectionAnswered(hub, number, c.balance, c.amount);
      const cases = {
        over: { body: { amount: round(c.amount + 0.01) }, code: 7032, why: `${round(c.amount + 0.01)} ₾ > RS-ის პასუხი ${c.amount} ₾` },
        zero: { body: { amount: 0 }, code: undefined, why: 'თანხა 0 (უნდა იყოს > 0)' },
        decimals: { body: { amount: 0.055 }, code: undefined, why: '3 ციფრი მძიმის შემდეგ (0.055)' },
        noReference: { body: { amount: c.amount, bankReference: '' }, code: undefined, why: 'ცარიელი bankReference' },
        future: { body: { amount: c.amount, paidAt: new Date(Date.now() + 86_400_000).toISOString() }, code: 7033, why: 'paidAt ხვალ (მომავალში) — თარიღის კოდი 7033' },
      }[kind];
      await this.expectRejected(id, { executionId: exec.id, ...cases.body }, 400, cases.code, cases.why);
      const e = (await this.restriction(id)).executions[0];
      assertCondition(OP_RESTRICTION, e.status === 'AMOUNT_RECEIVED' && !e.manualPayment, `execution ${e.status}, manualPayment ${e.manualPayment}`,
        'execution ისევ AMOUNT_RECEIVED, manualPayment false (არაფერი დაფიქსირდა)', e);
      await this.expectWallet(hub.clientId, c.balance, c.amount, 'არაფერი ჩამოიჭრა');
    } finally {
      await this.sim.obtainCollection(number);
    }
  }

  /** COL-17: სწორი გადახდა → EXECUTED → იგივე გადახდა მეორედ → 409 7031, მეორედ არ ჩამოიჭრა */
  async manualPaymentTwice(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    let recorded = false;
    try {
      const { id, exec } = await this.collectionAnswered(hub, number, c.balance, c.amount);
      recorded = true;
      await this.recordAndSettle(id, exec.id, c.amount, 'EXECUTED');
      await this.expectRejected(id, { executionId: exec.id, amount: c.amount }, 409, 7031, 'გადახდა უკვე დაფიქსირებულია (recorded already)');
      await this.expectWallet(hub.clientId, round(c.balance - c.amount), 0, `ჩამოიჭრა მხოლოდ ერთხელ (${c.amount})`);
    } finally {
      if (!recorded) await this.sim.obtainCollection(number);
    }
  }

  // ─── ინკასოს საკუთარი ქცევა (ყადაღას არ აქვს) ───

  /** ადმინის Return, როცა ინკასო PROCESSING-ზეა (RS-ის პასუხს ელოდება — სცენარი delayMs) → 409 / 7011, ინკასო არ ბრუნდება */
  async returnWhileProcessing(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    try {
      const id = await this.sendCollection(hub, number, c.balance, c.amount);
      await this.sim.scenario({ match: number, collectionNumber: number, amount: c.amount, delayMs: 30_000 });
      RsHubApi.expectOk(OP_REQUEST, await this.api.requestAmount(id));
      await this.waitRestriction(number, (r) => r.status === 'PROCESSING', 'PROCESSING (RS-ის პასუხს ელოდება)');
      this.expectError(OP_RETURN, await this.api.returnCollection(id, 'QA return while processing'), 409, 7011, 'PROCESSING-ის დროს Return აკრძალულია');
      const r = (await this.restriction(id)).restriction;
      assertCondition(OP_RESTRICTION, r.status !== 'RETURNED', `status ${r.status}`, 'ინკასო არ დაბრუნდა', r);
      await this.expectWallet(hub.clientId, c.balance, c.amount, 'ფული ისევ გაყინულია');
    } finally {
      await this.sim.clearScenarios();
      await this.sim.obtainCollection(number);
    }
  }

  /**
   * RS ხსნის ინკასოს ხელით გადახდის ჩამოჭრისას (TRANSFERRING) → მოხსნა მიიღება (§5.7.4a), მაგრამ hold გადახდის დასრულებამდე რჩება:
   *   ჩამოჭრა სრულდება (transfer SUCCESS), wallet −amount, held 0, ინკასო WITHDRAWN (FAILED-ში აღარ გადადის)
   */
  async withdrawDuringSettlement(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    const { id, exec } = await this.collectionAnswered(hub, number, c.balance, c.amount);
    RsHubApi.expectOk(OP_MANUAL, await this.api.manualPayment(id, { executionId: exec.id, amount: c.amount, paidAt: new Date().toISOString(), bankReference: `QA-BANK-${Date.now()}` }));
    const res = await this.sim.obtainCollection(number); // მაშინვე — ჩამოჭრა ჯერ მიმდინარეობს
    assertCondition('POST $SIM/orders/obtain-collection', res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მოხსნა მიღებულია (code null)', res?.items);
    let last: any;
    const ok = await this.poll(async () => {
      last = await this.restriction(id);
      const t = last.transfers?.[0];
      return t?.status === 'SUCCESS' && last.restriction.status === 'WITHDRAWN' ? true : undefined;
    }, SETTLE_TIMEOUT);
    const t = last?.transfers?.[0];
    assertCondition(OP_RESTRICTION, !!ok, `status ${last?.restriction?.status}; transfer ${t?.status}, lastError ${t?.lastError}`,
      'WITHDRAWN; ჩამოჭრა დასრულდა (transfer SUCCESS) — hold გადახდამდე არ გათავისუფლდა', { restriction: last?.restriction, transfers: last?.transfers });
    await this.expectWallet(hub.clientId, round(c.balance - c.amount), 0, `ჩამოიჭრა ${c.amount}, დანარჩენი გათავისუფლდა`);
    console.log('✅ Withdrawn during settlement — payment finished, collection WITHDRAWN');
  }

  /** COL-11: ადმინი აბრუნებს ინკასოს RS-ში (Return) → RETURNED, გაყინული თავისუფლდება, RS-ს მიდის ReturnCollection */
  async returnToRs(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    const id = await this.sendCollection(hub, number, c.balance, c.amount);
    RsHubApi.expectOk(OP_RETURN, await this.api.returnCollection(id, 'QA return to RS'));
    await this.waitRestriction(number, (r) => r.status === 'RETURNED' && round(r.restrictedAmount) === 0, 'RETURNED, restricted 0');
    await this.expectWallet(hub.clientId, c.balance, 0, 'დაბრუნების შემდეგ ფული თავისუფალია');
    await this.expectMessageOut('RETURN_COLLECTION', number);
    console.log('✅ Collection returned to RS — RETURNED, held 0, ReturnCollection sent');
  }

  /** COL-12: RS ასწორებს ინკასოს (kind 2, note = #ძველი) → ძველი იცვლება ახლით, გაყინულია მხოლოდ ახალი თანხა (ორმაგად არა) */
  async correction(c: { balance: number; amount: number; corrected: number }) {
    this.guard(c.balance, c.amount, c.corrected);
    const hub = await this.hubBusiness(c.balance);
    const old = `QA-C-${Date.now()}`;
    const fresh = `${old}-FIX`;
    try {
      await this.sendCollection(hub, old, c.balance, c.amount);
      const res = await this.sim.correction(hub.ident, c.corrected, fresh, old);
      assertCondition(OP_SIM_COLLECTION, res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}: ${res?.items?.[0]?.description}`, 'კორექცია მიღებულია (code null)', res?.items);
      const held = round(Math.min(c.balance, c.corrected));
      await this.waitRestriction(fresh, (r) => round(r.restrictedAmount) === held && round(r.requestedAmount) === round(c.corrected),
        `ახალი ინკასო: requested ${c.corrected}, restricted ${held}`);
      const prev = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: old })).content[0];
      const prevHolds = (await this.restriction(prev.id)).allocations.filter((a: any) => a.status === 'PLACED');
      assertCondition(OP_RESTRICTION, prev.status === 'REPLACED' && !!prev.replacedById && prevHolds.length === 0,
        `ძველი: ${prev.status}, replacedById ${prev.replacedById}, აქტიური hold ${prevHolds.length}`,
        'ძველი ინკასო REPLACED (replacedById), მასზე ფული აღარ არის გაყინული', { prev, prevHolds });
      // ❓ ძველ (REPLACED) ინკასოზე restrictedAmount არ ნულდება — კითხვა დეველოპერთან (იგივეა EXECUTED-ზე)
      await this.expectWallet(hub.clientId, c.balance, held, `გაყინულია მხოლოდ ახალი თანხა (${held})`);
      console.log(`✅ Correction ${c.amount} → ${c.corrected} — held ${held}, old replaced`);
    } finally {
      await this.sim.obtainCollection(fresh);
      await this.sim.obtainCollection(old);
    }
  }

  /** COL-13: მესამე პირის ინკასო (kind 3) → ფული თავისით არ იყინება ("needs a manual decision") → ადმინი: Start enforcement → იყინება */
  async thirdPerson(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    try {
      const res = await this.sim.thirdPersonCollection(hub.ident, c.amount, number, `9${String(Date.now()).slice(-8)}`);
      assertCondition(OP_SIM_COLLECTION, res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია (code null)', res?.items);
      const id = await this.waitRestriction(number, (r) => /third-person/i.test(r.statusReason || '') || r.enforcementEnabled === false,
        'statusReason "Third-person collection: needs a manual decision"');
      await sleep(4000);
      await this.expectWallet(hub.clientId, c.balance, 0, 'მესამე პირის ინკასო თავისით არ ყინავს');
      RsHubApi.expectOk(OP_ENFORCE, await this.api.startEnforcement(id));
      const held = round(Math.min(c.balance, c.amount));
      await this.waitRestriction(number, (r) => round(r.restrictedAmount) === held, `Start enforcement-ის შემდეგ restricted ${held}`);
      await this.expectWallet(hub.clientId, c.balance, held, `Start enforcement → გაიყინა ${held}`);
      console.log(`✅ Third-person collection — no hold until Start enforcement, then held ${held}`);
    } finally {
      await this.sim.obtainCollection(number);
    }
  }

  /** COL-02: Request amount იმავე დღეს მეორედ → 409 / 7018 */
  async requestAmountTwice(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    try {
      const { id } = await this.collectionAnswered(hub, number, c.balance, c.amount);
      this.expectError(OP_REQUEST, await this.api.requestAmount(id), 409, 7018, 'დღეში ერთხელ (already requested today)');
    } finally {
      await this.sim.obtainCollection(number);
    }
  }

  /** COL-02: Request amount, როცა არაფერია გაყინული (ცარიელი wallet — Pending) → 409 / 7011 */
  async requestAmountNothingHeld(c: { amount: number }) {
    this.guard(c.amount);
    const hub = await this.hubBusiness(0);
    const number = `QA-C-${Date.now()}`;
    try {
      const id = await this.sendCollection(hub, number, 0, c.amount);
      this.expectError(OP_REQUEST, await this.api.requestAmount(id), 409, 7011, 'No funds are restricted for this collection yet');
    } finally {
      await this.sim.obtainCollection(number);
    }
  }

  /** Request amount დაბრუნებულ (RETURNED) ინკასოზე → 409 / 7011 */
  async requestAmountReturned(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    const id = await this.sendCollection(hub, number, c.balance, c.amount);
    RsHubApi.expectOk(OP_RETURN, await this.api.returnCollection(id, 'QA return'));
    await this.waitRestriction(number, (r) => r.status === 'RETURNED', 'RETURNED');
    this.expectError(OP_REQUEST, await this.api.requestAmount(id), 409, 7011, 'ინკასო აქტიური აღარ არის');
  }

  /**
   * COL-05 / COL-06: RS-ის პასუხი სცენარით (Request amount-მდე):
   *   answer 0 → execution NO_AMOUNT, ინკასო ისევ გაყინულია, ჩამოსაჭრელი არაფერია
   *   answer < ინკასო → AMOUNT_RECEIVED answer → ხელით გადახდა answer → PARTIALLY_EXECUTED, ვალი = ინკასო − answer
   */
  async rsAnswers(c: { balance: number; amount: number; answer: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    let recorded = false;
    try {
      const id = await this.sendCollection(hub, number, c.balance, c.amount);
      await this.sim.scenario({ match: number, collectionNumber: number, amount: c.answer });
      RsHubApi.expectOk(OP_REQUEST, await this.api.requestAmount(id));
      const held = round(Math.min(c.balance, c.amount));
      if (c.answer === 0) {
        const e = await this.waitExecution(id, (x) => x.status !== 'REQUESTED', 'RS-მა უპასუხა 0');
        assertCondition(OP_RESTRICTION, e.status === 'NO_AMOUNT', `execution ${e.status}, answer ${e.answerAmount}`, 'execution NO_AMOUNT (RS: გადასახდელი 0)', e);
        await this.waitRestriction(number, (r) => /RESTRICTED/.test(r.status) && round(r.restrictedAmount) === held, `ინკასო ისევ გაყინულია (${held})`);
        this.expectError(OP_MANUAL, await this.api.manualPayment(id, { amount: 0.01, paidAt: new Date().toISOString(), bankReference: 'QA-ZERO' }), 409, 7031, 'RS-მა 0 თქვა — გადასახდელი არაფერია');
        await this.expectWallet(hub.clientId, c.balance, held, 'არაფერი ჩამოიჭრა, ფული ისევ გაყინულია');
        console.log('✅ RS answered 0 — NO_AMOUNT, collection stays held');
      } else {
        const e = await this.waitExecution(id, (x) => x.status === 'AMOUNT_RECEIVED', 'execution AMOUNT_RECEIVED');
        assertCondition(OP_RESTRICTION, round(e.answerAmount) === round(c.answer), `answerAmount ${e.answerAmount}`, `RS-ის პასუხი ${c.answer} (სცენარი)`, e);
        recorded = true;
        await this.recordAndSettle(id, e.id, c.answer, 'PARTIALLY_EXECUTED');
        const r = (await this.restriction(id)).restriction;
        assertCondition(OP_RESTRICTION, round(r.remainingAmount) === round(c.amount - c.answer), `remaining ${r.remainingAmount}`, `ვალი ${round(c.amount - c.answer)}`, r);
        await this.expectWallet(hub.clientId, round(c.balance - c.answer), round(held - c.answer), `ჩამოიჭრა ${c.answer}`);
        console.log(`✅ RS answered ${c.answer} of ${c.amount} — partially executed`);
      }
    } finally {
      await this.sim.clearScenarios();
      await this.sim.obtainCollection(number);
      void recorded;
    }
  }

  /** COL-14: ინკასო უცნობი ხაზინის კოდით (revAccount) → code 24, არაფერი ინახება და იყინება */
  async badTreasury(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const hub = await this.hubBusiness(c.balance);
    const number = `QA-C-${Date.now()}`;
    const res = await this.sim.collection(hub.ident, c.amount, number, 1, '999999999');
    assertCondition(OP_SIM_COLLECTION, String(res?.items?.[0]?.code) === '24', `code ${res?.items?.[0]?.code}: ${res?.items?.[0]?.description}`, 'code 24 "Treasury code not found"', res?.items);
    const list = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content;
    assertCondition(OP_RESTRICTION, list.length === 0, `შეინახა ${list.length}`, 'არაფერი შეინახა', list);
    await this.expectWallet(hub.clientId, c.balance, 0, 'არაფერი გაიყინა');
    console.log('✅ Unknown treasury code → 24');
  }

  /** ბიზნესი RS-ში Approved, wallet არ ჰყავს → code 13 + RS-ს ავტომატურად ეგზავნება ReturnCollection */
  async noWalletReturns(c: { amount: number }) {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business', await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const reg = RsHubApi.expectOk('POST /api/v1/rs/registrations', await this.api.createRegistration({
      partnerCode: 'keepz', enrollment: null, submit: true,
      data: { residency: 'RESIDENT', identNumber: business.identificationNumber, ownerFullName: business.ownerFullName, operDate: business.operDate, knownDate: business.knownDate },
    }));
    await this.sim.approveTaxpayer(business.identificationNumber);
    await this.poll(async () => (RsHubApi.expectOk(OP_REG, await this.api.getRegistration(reg.id)).registration.status === 'APPROVED' ? true : undefined));
    const number = `QA-C-${Date.now()}`;
    const res = await this.sim.collection(business.identificationNumber, c.amount, number);
    assertCondition(OP_SIM_COLLECTION, String(res?.items?.[0]?.code) === '13', `code ${res?.items?.[0]?.code}`, 'code 13 "no open account"', res?.items);
    await this.expectMessageOut('RETURN_COLLECTION', number);
    console.log('✅ No wallet → code 13 + ReturnCollection sent to RS');
  }

  // ─── ნაბიჯები ───

  /** RS აგზავნის ინკასოს → wallet-ზე იყინება min(ბალანსი, ინკასო) → restriction id */
  private async sendCollection(hub: Hub, number: string, balance: number, amount: number): Promise<string> {
    const res = await this.sim.collection(hub.ident, amount, number);
    const item = res?.items?.[0];
    assertCondition(OP_SIM_COLLECTION, res?.accepted === true && item?.code === null,
      `code ${item?.code}: ${item?.description}`, 'accepted: true, items[0].code = null (მიღებულია)', res?.items);
    const held = round(Math.min(balance, amount));
    const status = held === 0 ? 'PENDING' : held >= amount ? 'FULLY_RESTRICTED' : 'PARTIALLY_RESTRICTED';
    const id = await this.waitRestriction(number, (r) => r.status === status && round(r.restrictedAmount) === held, `${status}, restricted ${held}`);
    await this.expectWallet(hub.clientId, balance, held, `ინკასომ გაყინა ${held}`);
    console.log(`✅ Collection ${amount} ₾ on hub wallet (${balance} ₾) — ${status}, held ${held} (${number})`);
    return id;
  }

  /** ინკასო → Request amount → RS პასუხობს მთელ ინკასოს → AMOUNT_RECEIVED, MANUAL_PAYMENT_NEEDED, ავტომატური გადარიცხვა არ არის */
  private async collectionAnswered(hub: Hub, number: string, balance: number, amount: number): Promise<{ id: string; exec: any }> {
    const id = await this.sendCollection(hub, number, balance, amount);
    const req = RsHubApi.expectOk(OP_REQUEST, await this.api.requestAmount(id));
    assertField(OP_REQUEST, req, 'status', 'REQUESTED');
    assertField(OP_REQUEST, req, 'source', 'MANUAL');

    const exec = await this.waitExecution(id, (e) => e.status === 'AMOUNT_RECEIVED', 'execution AMOUNT_RECEIVED (RS-მა უპასუხა)');
    assertCondition(OP_RESTRICTION, round(exec.answerAmount) === round(amount), `answerAmount ${exec.answerAmount}`, `answerAmount ${amount} (RS-ის პასუხი)`, exec);
    const details = await this.restriction(id);
    assertCondition(OP_RESTRICTION, (details.transfers || []).length === 0, `transfers ${details.transfers?.length}`,
      'ხაზინაზე ავტომატური გადარიცხვა არ არის (ხელით რეჟიმი)', details.transfers);
    const history = RsHubApi.expectOk(OP_HISTORY, await this.api.restrictionHistory(id));
    assertCondition(OP_HISTORY, history.some((h: any) => h.action === 'MANUAL_PAYMENT_NEEDED'), 'MANUAL_PAYMENT_NEEDED არ არის',
      'history: MANUAL_PAYMENT_NEEDED (Ops-ს ეგზავნება მეილი "RS asks X GEL")', history.map((h: any) => h.action));
    console.log(`✅ RS answered ${exec.answerAmount} ₾ — manual payment needed (no auto transfer)`);
    return { id, exec };
  }

  /** ადმინი აფიქსირებს ხელით გადახდას (სიმულაცია) → TRANSFERRING → wallet ჩამოჭრის (paidOutside) → execution COMPLETED, ინკასო `status` */
  private async recordAndSettle(id: string, executionId: string, amount: number, status: 'EXECUTED' | 'PARTIALLY_EXECUTED') {
    const bankReference = `QA-BANK-${Date.now()}`;
    const paid = RsHubApi.expectOk(OP_MANUAL, await this.api.manualPayment(id, {
      executionId, amount, paidAt: new Date().toISOString(), bankReference, note: 'QA manual treasury payment',
    }));
    assertField(OP_MANUAL, paid, 'manualPayment', true);
    assertField(OP_MANUAL, paid, 'manualPaymentReference', bankReference);

    let last: any;
    const done = await this.poll(async () => {
      last = await this.restriction(id);
      return last.restriction.status === status && round(last.restriction.executedAmount) === round(amount) ? last : undefined;
    }, SETTLE_TIMEOUT);
    const t = last?.transfers?.[0];
    assertCondition(OP_RESTRICTION, !!done,
      `status ${last?.restriction?.status}, executed ${last?.restriction?.executedAmount}; execution ${last?.executions?.[0]?.status}; ` +
      `transfer ${t ? `${t.status}, attempts ${t.attempts}, lastError: ${t.lastError}` : 'არ არის'}`,
      `${SETTLE_TIMEOUT / 1000} წმ-ში: ${status}, executed ${amount}; execution COMPLETED; transfer paidOutside SUCCESS`,
      { restriction: last?.restriction, executions: last?.executions, transfers: last?.transfers });
    assertCondition(OP_RESTRICTION, done.executions[0].status === 'COMPLETED' && t?.paidOutside === true && t?.status === 'SUCCESS' && /^S-/.test(t.transferId),
      `execution ${done.executions[0].status}, transfer ${t?.status} paidOutside ${t?.paidOutside}`,
      'execution COMPLETED; transfer S-… paidOutside true, SUCCESS (ხაზინაზე სისტემა არ იხდის)', done.transfers);
    if (status === 'EXECUTED') {
      const r = await this.poll(async () => ((await this.restriction(id)).restriction.restrictedAmount === 0 ? true : undefined));
      assertCondition(OP_RESTRICTION, !!r, `restricted ${(await this.restriction(id)).restriction.restrictedAmount}`, 'EXECUTED-ის შემდეგ restrictedAmount 0 (გამოსწორდა 10.11)', null);
    }
    console.log(`✅ Manual payment ${amount} ₾ recorded (${bankReference}) — ${status}`);
  }

  /** manual-payment უარყოფილი: HTTP `http` (+ statusCode `code`), არაფერი ჩაიწერა */
  private async expectRejected(id: string, body: { executionId?: string; amount: number; paidAt?: string; bankReference?: string }, http: number, code: number | undefined, why: string) {
    const res = await this.api.manualPayment(id, { paidAt: new Date().toISOString(), bankReference: `QA-BANK-${Date.now()}`, ...body });
    assertCondition(OP_MANUAL, res.status === http && (code === undefined || res.body?.statusCode === code),
      `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`, `HTTP ${http}${code ? ` / ${code}` : ''} — ${why}`, res.body);
    console.log(`✅ Manual payment rejected — HTTP ${res.status}${res.body?.statusCode ? ` / ${res.body.statusCode}` : ''} (${why})`);
  }

  /** API შეცდომა: HTTP + statusCode */
  private expectError(op: string, res: { status: number; body: any }, http: number, code: number, why: string) {
    assertCondition(op, res.status === http && res.body?.statusCode === code, `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`, `HTTP ${http} / ${code} — ${why}`, res.body);
    console.log(`✅ ${op} → ${http} / ${code}`);
  }

  /** RS-ს გაეგზავნა `operation` ამ ინკასოზე (messages/out) */
  private async expectMessageOut(operation: string, number: string) {
    let last: any[] = [];
    const ok = await this.poll(async () => {
      last = (RsHubApi.expectOk('GET /api/v1/rs/messages/out', await this.api.messagesOut({ operation, pageIndex: 1, pageSize: 10 })).content || []);
      for (const m of last) {
        const d = RsHubApi.expectOk('GET /api/v1/rs/messages/out/{id}', await this.api.messageOut(m.id));
        if (String(d.payload || '').includes(number)) return true; // payload: {"collectionNumber": …}
      }
      return undefined;
    });
    assertCondition('GET /api/v1/rs/messages/out', !!ok, `${operation} ამ ინკასოზე არ ჩანს`, `${operation} — ${number}`, last.slice(0, 3));
  }

  private async restriction(id: string): Promise<any> {
    return RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(id));
  }

  private guard(...amounts: number[]) {
    assertCondition('ტესტის კონფიგი', amounts.every((a) => a > 0 && a <= MAX_AMOUNT),
      `თანხა: ${amounts.join(', ')}`, `0 < თანხა ≤ ${MAX_AMOUNT} ₾ (hub STANDARD — რეალური ფული)`, amounts);
  }

  // ─── მომზადება ───

  /** API: ბიზნესი + WALLET (ბიზნესზე) + ბალანსი → RS რეგისტრაცია (wallet თავისით ებმის) → RS ადასტურებს → wallet ACTIVE */
  private async hubBusiness(balance: number): Promise<Hub> {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
      await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const wallet = RsHubApi.expectOk('POST /api/distributor-hub-client',
      await this.api.createClient(RsClientHelper.buildBody('WALLET', business.id)));
    if (balance > 0) RsHubApi.expectOk('PUT /api/distributor-hub-client/{id} (ბალანსი)',
      await this.api.updateBalance(wallet.clientId, { amount: balance, currency: 'GEL', description: 'QA RS collection' }));

    // wallet-ის მიბმისას ბიზნესს RS რეგისტრაცია თავისით ექმნება (NOT_SUBMITTED) → ვპოულობთ → Submit → RS ადასტურებს
    let found: any;
    await this.poll(async () => {
      found = (await this.api.lookupRegistration({ identNumber: business.identificationNumber })).value?.registration;
      return found?.id ? true : undefined;
    }, ENROLL_TIMEOUT, 5000);
    assertCondition('GET /api/v1/rs/registrations/lookup', !!found?.id, 'რეგისტრაცია არ შეიქმნა',
      'wallet-ის მიბმის შემდეგ ბიზნესს RS რეგისტრაცია თავისით ექმნება', found);
    const reg = found;
    RsHubApi.expectOk('POST /api/v1/rs/registrations/{id}/submit', await this.api.submitRegistration(reg.id));
    await this.sim.approveTaxpayer(business.identificationNumber);

    let last: any;
    const ok = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(reg.id));
      const e = last.enrollments.find((x: any) => x.holderRef === `CLIENT:${wallet.clientId}`);
      return last.registration.status === 'APPROVED' && e?.status === 'ACTIVE' ? true : undefined;
    }, ENROLL_TIMEOUT, 5000);
    assertCondition(OP_REG, !!ok, `${last?.registration?.status}, enrollments ${JSON.stringify(last?.enrollments?.map((x: any) => [x.holderRef, x.status]))}`,
      `APPROVED + CLIENT:${wallet.clientId} ACTIVE (wallet თავისით ებმის)`, last);
    console.log(`✅ Hub business ${business.identificationNumber} — wallet ${balance} ₾, registration Approved, wallet enrolled`);
    return { ident: business.identificationNumber, clientId: wallet.clientId };
  }

  // ─── შემოწმებები ───

  private async waitRestriction(number: string, ok: (r: any) => boolean, expected: string): Promise<string> {
    let last: any;
    const r = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content[0];
      return last && ok(last) ? last : undefined;
    });
    assertCondition(OP_RESTRICTION, !!r,
      last ? `status ${last.status}, restricted ${last.restrictedAmount}, executed ${last.executedAmount}` : 'ინკასო არ არსებობს', expected, last);
    return r.id;
  }

  private async waitExecution(id: string, ok: (e: any) => boolean, expected: string): Promise<any> {
    let last: any;
    const e = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(id)).executions?.[0];
      return last && ok(last) ? last : undefined;
    });
    assertCondition(OP_RESTRICTION, !!e, last ? `execution ${last.status}` : 'execution არ არის', expected, last);
    return e;
  }

  /** wallet-ის GEL ბალანსი / held (poll) */
  private async expectWallet(clientId: string, amount: number, held: number, why: string) {
    let last: any;
    const ok = await this.poll(async () => {
      const client = RsHubApi.expectOk(OP_CLIENT, await this.api.getClient(clientId));
      last = (client.balances || []).find((b: any) => b.currency === 'GEL') || { amount: 0, held: 0 };
      return round(last.amount) === round(amount) && round(last.held) === round(held) ? true : undefined;
    });
    assertCondition(OP_CLIENT, !!ok, `ბალანსი ${last?.amount} / held ${last?.held}`, `ბალანსი ${amount} / held ${held} — ${why}`, last);
  }

  private async poll<T>(fn: () => Promise<T | undefined>, timeout = TIMEOUT, every = 2000): Promise<T | undefined> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const v = await fn();
      if (v !== undefined) return v;
      await sleep(every);
    }
    return undefined;
  }
}
