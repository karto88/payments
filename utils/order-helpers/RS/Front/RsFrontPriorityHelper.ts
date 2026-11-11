import { RsFrontTabsHelper } from './RsFrontTabsHelper';
import { Ctx } from './RsFrontHelper';
import { RsHubApi } from '../RsHubApi';
import { assertCondition } from '../../../assertions';

const OP_MODAL = 'UI Liens & collections — ინკასოს ფანჯარა';
const OP_REQ = 'POST /api/v1/rs/restrictions/{id}/request-amount';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions/{id}';

const round = (n: number) => Math.round(n * 100) / 100;
/** RS პროტოკოლი §7 — UI-ის ტექსტები */
const PRIORITY_LABEL: Record<number, string> = { 1: 'Principal debt', 2: 'Sanction', 3: 'Late interest' };
const LABEL: Record<string, string> ={ FULLY_RESTRICTED: 'Fully restricted', PARTIALLY_RESTRICTED: 'Partially restricted', PENDING: 'Pending' };

interface Col { number: string; priority: number; arrived: number; held: number }

/**
 * RS ფრონტი — ინკასოს პრიორიტეტი (RS პროტოკოლი 5.4.3, §7; KD-2682, KD-2683):
 *   📋 Priority: 1 – ძირითადი თანხა · 2 – სანქცია · 3 – საურავი (მხოლოდ ინკასოზე, ყადაღას არ აქვს)
 *   📋 ერთ გადამხდელზე რამდენიმე ინკასო, ფული ყველას არ ჰყოფნის → ფული იყინება და იხდება priority-ის რიგით (1 → 2 → 3),
 *      ერთნაირ priority-ში — ჯერ უფრო ძველი; ახალი ფულიც ჯერ priority 1-ს მიდის
 *   📋 სანამ priority 1 ღიაა — priority 2 / 3-ზე Request amount / ხელით გადახდა არ უნდა შეიძლებოდეს
 *      (გამონაკლისი: RS-მა priority 1-ზე "0" უპასუხა → იმავე დღეს შემდეგზე გადასვლა, 5.7.3)
 *   ⚠️ 11.11: ფული შემოსვლის რიგით იყინება (KD-2682), ღილაკები ყველა priority-ზე მუშაობს (KD-2683) → ტესტები ჩავარდება გასწორებამდე
 *   ⚠️ hub wallet STANDARD → თანხები ≤ 1 ₾
 */
export class RsFrontPriorityHelper extends RsFrontTabsHelper {
  /**
   * wallet `balance` → ინკასოები (თითო `amount`) შემოდის `arrive` რიგით (priority-ები) →
   *   ფანჯარაში Priority = გაგზავნილი; სტატუსი / გაყინული — priority-ის რიგით (1 → 2 → 3, ერთნაირში ძველი პირველი)
   */
  async holdsByPriority(c: { balance: number; amount: number; arrive: number[] }) {
    this.guard(c.balance, c.amount);
    const ctx = await this.prepare(c.balance);
    const cols: Col[] = [];
    try {
      for (const priority of c.arrive) cols.push(await this.send(ctx, c.amount, priority));
      this.plan(cols, c.balance, c.amount);
      await this.expectCollections(ctx, cols, c.amount);
      console.log(`✅ Holds by priority: ${this.describe(cols)}`);
    } finally {
      for (const x of cols) await this.cleanup(x.number);
    }
  }

  /** ცარიელი wallet → ინკასოები `arrive` რიგით (ყველა Pending) → wallet-ს ერიცხება `topUp` → ფული მიდის priority 1-ს, არა უფრო ძველს */
  async topUpGoesToPriority(c: { amount: number; arrive: number[]; topUp: number }) {
    this.guard(c.amount, c.topUp);
    const ctx = await this.prepare(0);
    const cols: Col[] = [];
    try {
      for (const priority of c.arrive) cols.push(await this.send(ctx, c.amount, priority));
      this.plan(cols, 0, c.amount);
      await this.expectCollections(ctx, cols, c.amount);
      RsHubApi.expectOk('PUT /api/distributor-hub-client/{id} (ბალანსი)', await this.api.updateBalance(ctx.wallet.clientId, { amount: c.topUp, currency: 'GEL', description: 'QA RS priority top-up' }));
      this.plan(cols, c.topUp, c.amount);
      await this.expectCollections(ctx, cols, c.amount);
      console.log(`✅ Top-up ${c.topUp} went by priority: ${this.describe(cols)}`);
    } finally {
      for (const x of cols) await this.cleanup(x.number);
    }
  }

  /**
   * wallet `balance` → priority 1 და 2 (ორივე სრულად გაყინული) →
   *   priority 2: "Request amount from RS" არ ჩანს, API → უარი (priority 1 ღიაა) →
   *   priority 1: UI Request amount → Record manual payment → Executed →
   *   priority 2: ღილაკი ჩნდება → Request amount → Record manual payment → Executed
   */
  async payInPriorityOrder(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const ctx = await this.prepare(c.balance);
    const cols: Col[] = [];
    try {
      for (const priority of [1, 2]) cols.push(await this.send(ctx, c.amount, priority));
      this.plan(cols, c.balance, c.amount);
      await this.expectCollections(ctx, cols, c.amount);
      const [p1, p2] = cols;

      await this.expectRequestLocked(ctx, p2, 'priority 1 ჯერ გადაუხდელია');
      const id2 = await this.restrictionId(p2.number);
      const res = await this.api.requestAmount(id2);
      assertCondition(OP_REQ, res.status >= 400, `HTTP ${res.status}`, 'უარი (4xx) — ჯერ priority 1 უნდა გადაიხადოს (5.4.3)', res.body);

      await this.requestAndPay(ctx, p1.number, await this.restrictionId(p1.number), c.amount, c.amount);
      await this.expectApiStatus(p1.number, 'EXECUTED', 0);
      console.log(`✅ Priority 1 paid first (${p1.number})`);

      await this.ui.openRegistration(ctx.regId, 'restrictions');
      await this.ui.openRestriction(p2.number);
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_MODAL, buttons.includes('Request amount from RS'), `ღილაკები: ${buttons.join(' · ')}`, 'priority 1 Executed → priority 2-ზე "Request amount from RS" ჩანს', buttons);
      await this.ui.closeModal();
      await this.requestAndPay(ctx, p2.number, id2, c.amount, c.amount);
      await this.expectApiStatus(p2.number, 'EXECUTED', 0);
      await this.expectWallet(ctx, round(c.balance - 2 * c.amount), 0, 'ჩამოიჭრა priority 1, მერე priority 2');
      console.log(`✅ Priority 2 unlocked and paid after priority 1 (${p2.number})`);
    } finally {
      for (const x of cols) await this.cleanup(x.number);
    }
  }

  /**
   * priority 1 და 2 გაყინული → UI: priority 1-ზე Request amount → RS პასუხობს "0" (NO_AMOUNT) →
   *   სისტემა **თვითონ** ეკითხება RS-ს მომდევნოზე (priority 2: AMOUNT_REQUESTED_AUTO, source AUTO) → RS პასუხობს 0.3 →
   *   UI priority 2: TODAY "Amount received | RS asks ₾ 0.30", ღილაკი "Record manual payment" (5.7.3)
   */
  async zeroAnswerMovesToNext(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const ctx = await this.prepare(c.balance);
    const cols: Col[] = [];
    try {
      for (const priority of [1, 2]) cols.push(await this.send(ctx, c.amount, priority));
      this.plan(cols, c.balance, c.amount);
      await this.expectCollections(ctx, cols, c.amount);
      const [p1, p2] = cols;

      await this.sim.scenario({ match: p1.number, collectionNumber: p1.number, amount: 0 });
      try {
        await this.ui.openRegistration(ctx.regId, 'restrictions');
        await this.ui.openRestriction(p1.number);
        await this.ui.requestAmount();
        await this.waitExecution(p1.number, 'NO_AMOUNT');
      } finally {
        await this.sim.clearScenarios();
      }
      await this.ui.closeModal();

      const e = await this.waitExecution(p2.number, 'AMOUNT_RECEIVED');
      assertCondition(OP_RESTRICTION, e.source === 'AUTO' && round(e.answerAmount) === c.amount, `source ${e.source}, answer ${e.answerAmount}`,
        `priority 2: სისტემამ თვითონ იკითხა (source AUTO), RS answer ${c.amount}`, e);

      await this.ui.openRegistration(ctx.regId, 'restrictions');
      await this.ui.openRestriction(p2.number);
      const today = await this.ui.todayText();
      const exp = `Amount received | RS asks ₾ ${c.amount.toFixed(2)} today.`;
      assertCondition(OP_MODAL, today.startsWith(exp), `TODAY: ${today}`, exp, today);
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_MODAL, buttons.includes('Record manual payment') && !buttons.includes('Request amount from RS'), `ღილაკები: ${buttons.join(' · ')}`,
        'priority 2: "Record manual payment" ჩანს, "Request amount from RS" — არა (უკვე იკითხა)', buttons);
      await this.ui.closeModal();
      console.log(`✅ Priority 1 answered 0 → system asked RS for priority 2 automatically, RS asks ${c.amount} (${p2.number})`);
    } finally {
      for (const x of cols) await this.cleanup(x.number);
    }
  }

  // ─── შიდა ───

  private async send(ctx: Ctx, amount: number, priority: number): Promise<Col> {
    const number = await this.sendCollection(ctx, amount, priority);
    // შემოსვლის რიგი მკაფიო იყოს (receivedAt) და hold-ი წინა ინკასოზე მოესწროს
    await new Promise((r) => setTimeout(r, 4000));
    return { number, priority, arrived: Date.now(), held: 0 };
  }

  /** მოსალოდნელი გაყინვა: ფული ნაწილდება priority-ით (1 → 2 → 3), ერთნაირ priority-ში — შემოსვლის რიგით */
  private plan(cols: Col[], balance: number, amount: number) {
    let left = balance;
    for (const x of [...cols].sort((a, b) => a.priority - b.priority || a.arrived - b.arrived)) {
      x.held = round(Math.min(amount, Math.max(left, 0)));
      left = round(left - x.held);
    }
  }

  /**
   * ჯერ API — ყველა ინკასო ერთად (ჩავარდნისას ჩანს მთელი სურათი: ვის რამდენი გაეყინა), მერე UI — თითო ფანჯარა:
   *   Priority, სტატუსი, Requested / Restricted / Remaining = მოსალოდნელი (priority-ის რიგით)
   */
  private async expectCollections(ctx: Ctx, cols: Col[], amount: number) {
    let actual: any[] = [];
    const ok = await this.poll(async () => {
      actual = await this.apiState(cols);
      return actual.every((a, i) => round(Number(a.restricted)) === cols[i].held) ? true : undefined;
    }, 30_000, 3000);
    assertCondition(OP_RESTRICTION, !!ok, actual.map((a) => `P${a.priority} ${a.status} ${a.restricted}`).join(' · '),
      `ფული priority-ის რიგით (1 → 2 → 3, ერთნაირში ძველი): ${this.describe(cols)}`, actual);
    for (const x of cols) {
      const status = x.held === 0 ? 'Pending' : x.held >= amount ? 'Fully restricted' : 'Partially restricted';
      await this.expectOverview(ctx, x.number, { status, requested: amount, restricted: x.held, remaining: amount, executed: 0 });
      const p = await this.ui.modalField('Priority');
      // 11.11-დან UI წერს ციფრს + სახელს: "1 · Principal debt", Collection status "1 · New"
      const label = `${x.priority} · ${PRIORITY_LABEL[x.priority]}`;
      assertCondition(OP_MODAL, p === label, `Priority "${p}"`, `Priority "${label}"`, x.number);
      const s = await this.ui.modalField('Collection status');
      assertCondition(OP_MODAL, s === '1 · New', `Collection status "${s}"`, 'Collection status "1 · New"', x.number);
      await this.ui.closeModal();
    }
  }

  /** ფანჯარაში "Request amount from RS" არ ჩანს */
  private async expectRequestLocked(ctx: Ctx, x: Col, why: string) {
    await this.ui.openRegistration(ctx.regId, 'restrictions');
    await this.ui.openRestriction(x.number);
    const buttons = await this.ui.modalButtons();
    await this.ui.closeModal();
    assertCondition(OP_MODAL, !buttons.includes('Request amount from RS'), `priority ${x.priority}: ღილაკები ${buttons.join(' · ')}`,
      `priority ${x.priority}-ზე "Request amount from RS" არ ჩანს — ${why}`, buttons);
  }

  private async waitExecution(number: string, status: string): Promise<any> {
    const id = await this.restrictionId(number);
    let last: any;
    const e = await this.poll(async () => {
      last = (RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(id)).executions || [])[0];
      return last?.status === status ? last : undefined;
    }, 60_000);
    assertCondition(OP_RESTRICTION, !!e, `execution ${last?.status}`, `execution ${status}`, last);
    return e;
  }

  private async restrictionId(number: string): Promise<string> {
    return RsHubApi.expectOk('GET /api/v1/rs/restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0].id;
  }

  /** API-ს მდგომარეობა ყველა ინკასოზე — ჩავარდნისას სრული სურათისთვის */
  private async apiState(cols: Col[]) {
    const out = [];
    for (const x of cols) {
      const r = (await this.api.getRestrictions({ rsNumber: x.number })).value?.content?.[0];
      out.push({ priority: x.priority, number: x.number, status: LABEL[r?.status] || r?.status, restricted: r?.restrictedAmount, receivedAt: r?.receivedAt });
    }
    return out;
  }

  private describe(cols: Col[]) {
    return [...cols].sort((a, b) => a.priority - b.priority || a.arrived - b.arrived).map((x) => `P${x.priority} ${x.held}`).join(' · ');
  }
}
