import { RsFrontHelper, Ctx } from './RsFrontHelper';
import { RsHubApi, digits } from '../RsHubApi';
import { assertCondition } from '../../../assertions';

const OP_TODAY = 'UI ინკასოს ფანჯარა — Overview → TODAY';
const OP_FORM = 'UI ინკასოს ფანჯარა — Record manual payment ფორმა';
const OP_EXEC = 'UI ინკასოს ფანჯარა — Executions';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions/{id}';
const OP_MANUAL = 'POST /api/v1/rs/restrictions/{id}/manual-payment';

const TREASURY = 'treasury account 101001000 (code 220101222)';
const RECORDED = 'Payment recorded. Taking the money off the wallets.';
const NOT_ASKED = 'Not asked today.';

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `₾ ${round(n).toFixed(2)}`;
/** PARTIALLY_EXECUTED → "Partially executed" */
const uiLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

interface Asked { ctx: Ctx; number: string; id: string; balance: number; held: number; answer: number }

/**
 * RS ფრონტი — ინკასოს ხელით გადახდა UI-დან (11.11-დან ღილაკი "Record manual payment", permission RS_COLLECTION_MANUAL_PAYMENT_RECORD):
 *   📋 Request amount from RS → RS პასუხობს (TODAY: "RS asks ₾X today…") → ადმინი ხაზინაში იხდის → Record manual payment:
 *      Amount paid (წინასწარ = RS-ის პასუხი), Paid at (წინასწარ = ახლა), Bank reference *, Note (≤ 500) → wallet-ები ჩამოიჭრება
 *   📋 ლიმიტი: 0 < თანხა ≤ min(RS-ის პასუხი, გაყინული); Paid at — არა მომავალში; ერთ პასუხზე — ერთი ჩაწერა
 *   📋 RS პასუხობს 0 → "No amount", ჩასაწერი არაფერია (ღილაკი არ ჩანს)
 *   ⚠️ hub wallet STANDARD → თანხები ≤ 1 ₾; RS — სიმულატორი (ნაკლები / 0 პასუხი — scenario)
 */
export class RsFrontManualPaymentHelper extends RsFrontHelper {
  /** Paid at ველის ფორმატი (datetime-local, ბრაუზერის დრო): ახლა + `hours` → "2026-11-11T15:30" */
  static paidAt(hours: number): string {
    const d = new Date(Date.now() + hours * 3_600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ─── პოზიტიური ───

  /**
   * wallet `balance` → ინკასო `amount` → UI: Request amount → TODAY "RS asks ₾amount" → Record manual payment:
   *   ფორმაში amount = პასუხი; გაყინულზე ნაკლები ფული (held < პასუხი) → პასუხის ჩაწერა → "Must be at most held" → `pay` →
   *   toast "Payment recorded…" → Overview (სტატუსი, Paid, Still owed, TODAY Completed), Executions (Completed, MANUAL PAYMENT ჩვენი Bank reference, TRANSFERS Success),
   *   ღილაკი ქრება, wallet −pay
   */
  async recordFromUi(c: { balance: number; amount: number; pay: number }) {
    const a = await this.askRs(c.balance, c.amount);
    try {
      const form = await this.ui.openManualPaymentForm();
      this.expectForm(form, a);
      if (a.held < a.answer) {
        await this.ui.fillManualPayment({ bankReference: 'QA-OVER' });
        const r = await this.ui.submitManualPayment();
        this.expectRejectedInForm(r, `Must be at most ${a.held}`, `პასუხი ${a.answer}, მაგრამ გაყინულია მხოლოდ ${a.held}`);
      }
      await this.recordAndCheck(a, c.pay, `QA-UI-PAY-${digits(6)}`);
    } finally {
      await this.cleanup(a.number);
    }
  }

  /** RS პასუხობს ნაკლებს (`answer` < ინკასო — გადამხდელმა ნაწილი სხვაგან გადაიხადა) → TODAY / ფორმა = answer; answer + 0.01 → "Must be at most answer"; answer-ის ჩაწერა → Partially executed */
  async rsAnswersLess(c: { balance: number; amount: number; answer: number }) {
    const a = await this.askRs(c.balance, c.amount, c.answer);
    try {
      const form = await this.ui.openManualPaymentForm();
      this.expectForm(form, a);
      await this.ui.fillManualPayment({ amount: String(round(c.answer + 0.01)), bankReference: 'QA-OVER' });
      this.expectRejectedInForm(await this.ui.submitManualPayment(), `Must be at most ${c.answer}`, `RS-მა უპასუხა ${c.answer}`);
      await this.ui.fillManualPayment({ amount: String(c.answer) });
      await this.recordAndCheck(a, c.answer, `QA-UI-LESS-${digits(6)}`);
    } finally {
      await this.cleanup(a.number);
    }
  }

  /** RS პასუხობს 0 → TODAY "No amount | RS asks nothing today. The money stays held." → Record ღილაკი არ ჩანს → Executions: No amount, RS answer ₾ 0.00 → ფული ისევ გაყინულია */
  async rsAnswersZero(c: { balance: number; amount: number }) {
    const a = await this.askRs(c.balance, c.amount, 0);
    try {
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_FORM, !buttons.includes('Record manual payment'), `ღილაკები: ${buttons.join(' · ')}`, '"Record manual payment" არ ჩანს — RS-მა 0 თქვა', buttons);
      const ex = await this.ui.executions();
      assertCondition(OP_EXEC, ex.statuses.includes('No amount') && ex.text.includes('RS answer | ₾ 0.00') && !ex.text.includes('MANUAL PAYMENT'),
        `Executions: ${ex.statuses.join(', ')} · ${ex.text.slice(0, 300)}`, 'No amount · RS answer ₾ 0.00 · გადახდა არ არის', ex.statuses);
      await this.expectWallet(a.ctx, c.balance, a.held, 'RS-მა 0 თქვა — არაფერი ჩამოიჭრა, ფული ისევ გაყინულია');
      console.log(`✅ RS answered 0 → "No amount", no Record button, ${a.held} stays held`);
    } finally {
      await this.cleanup(a.number);
    }
  }

  // ─── ნეგატიური ───

  /** Request amount-მდე: TODAY "Not asked today…", ღილაკი "Record manual payment" არ ჩანს → API-ით ჩაწერა → 409 / 7031, არაფერი ჩამოიჭრა */
  async recordBeforeRequest(c: { balance: number; amount: number }) {
    this.guard(c.balance, c.amount);
    const ctx = await this.prepare(c.balance);
    const number = await this.sendCollection(ctx, c.amount);
    const held = round(Math.min(c.balance, c.amount));
    try {
      await this.expectOverview(ctx, number, { status: held >= c.amount ? 'Fully restricted' : 'Partially restricted', requested: c.amount, restricted: held, remaining: c.amount, executed: 0 });
      const today = await this.ui.todayText();
      assertCondition(OP_TODAY, today.startsWith(NOT_ASKED), `TODAY: ${today}`, `"${NOT_ASKED} …"`, today);
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_FORM, !buttons.includes('Record manual payment') && buttons.includes('Request amount from RS'), `ღილაკები: ${buttons.join(' · ')}`,
        'მხოლოდ "Request amount from RS" — ჩასაწერი ჯერ არაფერია', buttons);
      const res = await this.api.manualPayment(await this.restrictionId(number), { amount: held, paidAt: new Date().toISOString(), bankReference: 'QA-NO-ANSWER' });
      assertCondition(OP_MANUAL, res.status === 409 && res.body?.statusCode === 7031, `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`, '409 / 7031 — RS-ის პასუხი არ არის', res.body);
      await this.expectWallet(ctx, c.balance, held, 'არაფერი ჩამოიჭრა');
      console.log('✅ Before Request amount: "Not asked today", no Record button; API → 7031');
    } finally {
      await this.cleanup(number);
    }
  }

  /** ფორმის ვალიდაცია: `input` → ველთან `error`, ბექზე არაფერი იგზავნება, ფორმა ღიაა, wallet უცვლელი */
  async formRejects(c: { balance: number; amount: number; input: { amount?: string; paidAt?: string; bankReference?: string }; error: string | RegExp | (string | RegExp)[]; why: string }) {
    const a = await this.askRs(c.balance, c.amount);
    try {
      await this.ui.openManualPaymentForm();
      await this.ui.fillManualPayment(c.input);
      const r = await this.ui.submitManualPayment();
      for (const e of [c.error].flat()) this.expectRejectedInForm(r, e, c.why);
      const need = [c.error].flat().length;
      assertCondition(OP_FORM, r.errors.length === need, `შეცდომები: ${r.errors.join(' | ')}`, `ზუსტად ${need}: ${[c.error].flat().join(' | ')}`, r.errors);
      await this.expectWallet(a.ctx, c.balance, a.held, 'არასწორი ფორმა — არაფერი ჩამოიჭრა');
      console.log(`✅ Form rejected (${c.why}): ${r.errors.join(' | ')} — nothing sent`);
    } finally {
      await this.cleanup(a.number);
    }
  }

  /** Amount paid ნიღბიანია: აკრეფა `typed` → ველში რჩება `kept` (მაგ. "-0.1" → "0.1", "abc" → "") — ფორმას არ ვაგზავნით, wallet უცვლელი */
  async amountMask(c: { balance: number; amount: number; typed: string; kept: string }) {
    const a = await this.askRs(c.balance, c.amount);
    try {
      await this.ui.openManualPaymentForm();
      await this.ui.fillManualPayment({ amount: c.typed });
      const value = await this.ui.manualPaymentAmount();
      assertCondition(OP_FORM, value === c.kept, `აკრიფა "${c.typed}" → ველში "${value}"`, `ველში "${c.kept}" — არასწორი სიმბოლოები არ იწერება`, value);
      await this.expectWallet(a.ctx, c.balance, a.held, 'არაფერი გაიგზავნა');
      console.log(`✅ Amount mask: typed "${c.typed}" → "${value}"`);
    } finally {
      await this.cleanup(a.number);
    }
  }

  /** ჩაწერის შემდეგ: ღილაკი ქრება → API-ით იგივე პასუხზე მეორედ → 409 / 7031, მეორედ არ ჩამოიჭრა */
  async recordOnlyOnce(c: { balance: number; amount: number; pay: number }) {
    const a = await this.askRs(c.balance, c.amount);
    try {
      await this.ui.openManualPaymentForm();
      await this.ui.fillManualPayment({ amount: String(c.pay), bankReference: `QA-UI-ONCE-${digits(6)}` });
      const r = await this.ui.submitManualPayment();
      assertCondition(OP_FORM, r.closed && r.http === 200 && r.toast.includes(RECORDED), `HTTP ${r.http} · ${r.toast} · ${r.errors.join(' | ')}`, `200 · "${RECORDED}"`, r);
      const d = await this.waitSettled(a.id, c.pay);
      await this.ui.closeModal();
      await this.ui.openRegistration(a.ctx.regId, 'restrictions');
      await this.ui.openRestriction(a.number);
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_FORM, !buttons.includes('Record manual payment'), `ღილაკები: ${buttons.join(' · ')}`, '"Record manual payment" აღარ ჩანს — უკვე ჩაწერილია', buttons);
      const exec = d.executions.find((e: any) => e.status === 'COMPLETED') || d.executions[0];
      const res = await this.api.manualPayment(a.id, { executionId: exec.id, amount: c.pay, paidAt: new Date().toISOString(), bankReference: 'QA-TWICE' });
      assertCondition(OP_MANUAL, res.status === 409 && res.body?.statusCode === 7031, `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`, '409 / 7031 — უკვე ჩაწერილია', res.body);
      await this.expectWallet(a.ctx, round(c.balance - c.pay), round(a.held - c.pay), 'მეორედ არ ჩამოიჭრა');
      console.log('✅ Recorded once → button hidden; API 2nd record → 7031');
    } finally {
      await this.cleanup(a.number);
    }
  }

  // ─── შიდა ───

  /** UI flow → wallet `balance` → ინკასო `amount` (answer — სიმულატორის scenario) → UI: Request amount → RS-ის პასუხი → TODAY = პასუხი */
  private async askRs(balance: number, amount: number, answer?: number): Promise<Asked> {
    this.guard(balance, amount);
    const ctx = await this.prepare(balance);
    const number = await this.sendCollection(ctx, amount);
    const held = round(Math.min(balance, amount));
    const rsAnswer = answer ?? amount;
    try {
      if (answer !== undefined) await this.sim.scenario({ match: number, collectionNumber: number, amount: answer });
      await this.expectOverview(ctx, number, { status: held >= amount ? 'Fully restricted' : 'Partially restricted', requested: amount, restricted: held, remaining: amount, executed: 0 });
      await this.ui.requestAmount();
      assertCondition(OP_TODAY, await this.ui.toast('Amount requested from RS'), 'toast არ გამოჩნდა', 'toast "Amount requested from RS. Waiting for its answer."', null);
      const id = await this.restrictionId(number);
      const exec = await this.poll(async () => {
        const e = (RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(id)).executions || [])[0];
        return e && e.status !== 'REQUESTED' ? e : undefined;
      }, 60_000);
      assertCondition(OP_RESTRICTION, !!exec && round(Number(exec.answerAmount ?? 0)) === rsAnswer, `execution ${exec?.status}, answer ${exec?.answerAmount}`, `RS-ის პასუხი ${rsAnswer}`, exec);
      await this.ui.closeModal();
      await this.ui.openRegistration(ctx.regId, 'restrictions');
      await this.ui.openRestriction(number);
      const today = await this.ui.todayText();
      const exp = rsAnswer > 0 ? `Amount received | RS asks ${money(rsAnswer)} today. Pay it to ${TREASURY}` : 'No amount | RS asks nothing today. The money stays held.';
      assertCondition(OP_TODAY, today.startsWith(exp), `TODAY: ${today}`, exp, today);
      return { ctx, number, id, balance, held, answer: rsAnswer };
    } catch (e) {
      await this.cleanup(number);
      throw e;
    } finally {
      if (answer !== undefined) await this.sim.clearScenarios();
    }
  }

  /** ფორმა: სათაური + RS-ის პასუხი + ხაზინის ანგარიში; Amount paid = პასუხი; Paid at — ახლანდელი წუთი (±5 წთ) */
  private expectForm(form: { text: string; amount: string; paidAt: string }, a: Asked) {
    const head = `${a.number}: RS asked ${money(a.answer)}, to ${TREASURY}. The wallets are charged the recorded amount.`;
    assertCondition(OP_FORM, form.text.includes(head) && form.text.includes('Record the whole amount in one payment.'), `ფორმა: ${form.text.slice(0, 400)}`, head, form.text);
    const paidAt = new Date(form.paidAt).getTime();
    assertCondition(OP_FORM, Number(form.amount) === a.answer && Math.abs(Date.now() - paidAt) < 5 * 60_000,
      `Amount paid ${form.amount}, Paid at ${form.paidAt}`, `Amount paid = ${a.answer} (RS-ის პასუხი), Paid at = ახლა`, form);
  }

  private expectRejectedInForm(r: { errors: string[]; toast: string; http: number | null; closed: boolean }, error: string | RegExp, why: string) {
    const found = typeof error === 'string' ? r.errors.includes(error) : r.errors.some((e) => error.test(e));
    assertCondition(OP_FORM, !r.closed && r.http === null && found,
      `შეცდომები: ${r.errors.join(' | ') || '-'} · ბექზე: ${r.http ?? 'არ გაიგზავნა'} · ფორმა ${r.closed ? 'დაიხურა' : 'ღიაა'}`,
      `ველთან "${error}" (${why}), ბექზე არაფერი იგზავნება`, r);
  }

  /** Bank reference → Record → toast → ჩამოჭრა → Overview / TODAY / Executions / ღილაკი / wallet = API */
  private async recordAndCheck(a: Asked, pay: number, bankReference: string) {
    await this.ui.fillManualPayment({ amount: String(pay), bankReference });
    const r = await this.ui.submitManualPayment();
    assertCondition(OP_FORM, r.closed && r.http === 200 && r.toast.includes(RECORDED), `HTTP ${r.http} · toast ${r.toast || '-'} · ${r.errors.join(' | ')}`, `200 · ფორმა იხურება · "${RECORDED}"`, r);
    const d = await this.waitSettled(a.id, pay);
    const owed = round(Number(d.restriction.remainingAmount));
    const status = uiLabel(d.restriction.status);
    await this.ui.closeModal();
    await this.expectOverview(a.ctx, a.number, { status, requested: Number(d.restriction.requestedAmount), restricted: round(a.held - pay), remaining: owed, executed: pay });
    const today = await this.ui.todayText();
    assertCondition(OP_TODAY, today.startsWith('Completed | Taken off the wallets.'), `TODAY: ${today}`, 'Completed | Taken off the wallets.', today);
    const buttons = await this.ui.modalButtons();
    assertCondition(OP_FORM, !buttons.includes('Record manual payment'), `ღილაკები: ${buttons.join(' · ')}`, '"Record manual payment" აღარ ჩანს', buttons);
    const ex = await this.ui.executions();
    const need = ['Source | Manual', `RS answer | ${money(a.answer)}`, `Accomplished | ${money(pay)}`, 'MANUAL PAYMENT', `Bank reference | ${bankReference}`, 'Paid at', 'Recorded by', 'TRANSFERS'];
    const miss = need.filter((x) => !ex.text.includes(x));
    const tr = ex.transfers.find((t) => t[0] === a.ctx.wallet.name) || [];
    assertCondition(OP_EXEC, ex.statuses.includes('Completed') && miss.length === 0 && tr[1] === money(pay) && tr[2] === 'Success',
      `Executions: ${ex.statuses.join(', ')}${miss.length ? ` · აკლია: ${miss.join(', ')}` : ''} · TRANSFERS: ${JSON.stringify(ex.transfers)}`,
      `Completed · ${need.join(' · ')} · ${a.ctx.wallet.name} ${money(pay)} Success`, ex.text);
    await this.expectWallet(a.ctx, round(a.balance - pay), round(a.held - pay), `ჩამოიჭრა ${pay}`);
    console.log(`✅ Record manual payment from UI: ${pay} (RS asked ${a.answer}, held ${a.held}) → ${status}, owed ${owed}, Bank reference ${bankReference}`);
  }

  /** ჩამოჭრა დასრულდა: executed = pay, ყველა transfer SUCCESS */
  private async waitSettled(id: string, pay: number): Promise<any> {
    let last: any;
    const d = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(id));
      const done = round(Number(last.restriction.executedAmount)) === round(pay) && (last.transfers || []).length > 0 && last.transfers.every((t: any) => t.status === 'SUCCESS');
      return done ? last : undefined;
    }, 120_000, 3000);
    assertCondition(OP_RESTRICTION, !!d, `status ${last?.restriction?.status}, executed ${last?.restriction?.executedAmount}, transfers ${JSON.stringify(last?.transfers?.map((t: any) => [t.amount, t.status]))}`,
      `executed ${pay}, transfers SUCCESS`, last);
    return d;
  }

  private async restrictionId(number: string): Promise<string> {
    return RsHubApi.expectOk('GET /api/v1/rs/restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0].id;
  }
}
