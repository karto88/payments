import { RsFrontTabsHelper } from './RsFrontTabsHelper';
import { Ctx } from './RsFrontHelper';
import { RsHubApi, digits } from '../RsHubApi';
import { assertCondition } from '../../../assertions';

const UI = 'UI RS → Liens & collections (საერთო გვერდი)';
const OP_LIST = `${UI} — სია / ძებნა`;
const OP_FILTER = `${UI} — Lien and collection filters`;
const OP_MODAL = `${UI} — ფანჯარა`;
const OP_FORM = `${UI} — Record manual payment`;
const OP_HISTORY = `${UI} — ფანჯარა → History`;
const OP_AUDIT = `${UI} — ფანჯარა → Audit`;
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions/{id}';

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `₾ ${round(n).toFixed(2)}`;

/** History-ის მოვლენები ქრონოლოგიურად (ძველი → ახალი); UI-ში ახალი ზემოთაა */
const COLLECTION_PAID_HISTORY = ['Collection received', 'Allocation planned', 'Hold placed', 'Status: Fully restricted', 'Amount requested manually',
  'RS answered the amount', 'Manual payment needed', 'Manual payment recorded', 'Settlements commanded', 'Transfer succeeded', 'Executed'];
/** Audit — მხოლოდ ინკასოს (Restriction) ცვლილებები, History-ის ქვესიმრავლე */
const COLLECTION_PAID_AUDIT = ['Collection received', 'Allocation planned', 'Status: Fully restricted', 'Amount requested manually', 'Manual payment recorded', 'Executed'];
const LIEN_WITHDRAWN_HISTORY = ['Lien received', 'Allocation planned', 'Hold placed', 'Status: Fully restricted', 'Lien withdrawn by RS', 'Hold released'];
const LIEN_WITHDRAWN_AUDIT = ['Lien received', 'Allocation planned', 'Status: Fully restricted', 'Lien withdrawn by RS'];

type Event = { title: string; entity: string; actor: string };

/**
 * RS ფრონტი — საერთო გვერდი RS → Liens & collections (/rs-restrictions): ყველა გადამხდელის ყადაღა / ინკასო ერთად
 *   📋 სია: RS reference · Type · Person (+ ident) · Requested · Restricted · Remaining · Executed · Status · Received
 *   📋 ძებნა მხოლოდ RS reference-ით; ფილტრი: Type, Status, Identification number, Registration ID, Received
 *   📋 ფანჯარა იგივეა, რაც რეგისტრაციიდან → აქედანაც: Request amount → Record manual payment
 *   📋 ფანჯრის History — ყველა მოვლენა (hold, transfer, collection cycle); Audit — მხოლოდ ყადაღის / ინკასოს (Restriction) ცვლილებები;
 *      "Before, after and payload" — მოვლენის JSON
 *   ⚠️ hub wallet STANDARD → თანხები ≤ 1 ₾
 */
export class RsFrontRestrictionsPageHelper extends RsFrontTabsHelper {
  /** ყადაღა + ინკასო ერთ გადამხდელზე → საერთო სია: ძებნა (ნომრით / უცნობი ნომერი), ფილტრები (ident, Type, Status, Registration ID) */
  async listSearchAndFilters(c: { balance: number; lien: number; collection: number }) {
    const { ctx, lien, col } = await this.lienAndCollection(c);
    try {
      await this.ui.openRestrictionsPage();
      await this.ui.searchRestrictions(col);
      this.expectRows(await this.ui.restrictionsRows(), [this.row(col, 'Collection', ctx.ident, c.collection, c.collection, c.collection, 0, 'Fully restricted')], `ძებნა "${col}"`);
      await this.ui.searchRestrictions(lien);
      this.expectRows(await this.ui.restrictionsRows(), [this.row(lien, 'Lien', ctx.ident, c.lien, c.lien, c.lien, 0, 'Fully restricted')], `ძებნა "${lien}"`);
      await this.ui.searchRestrictions(`QA-NONE-${digits(8)}`);
      this.expectRows(await this.ui.restrictionsRows(), [], 'ძებნა უცნობი ნომრით → "No Items"');
      console.log('✅ Search by RS reference: collection, lien, unknown → empty');

      const both = [lien, col].sort();
      const cases: [string, Parameters<typeof this.ui.filterRestrictions>[0], string[]][] = [
        ['Identification number', { personId: ctx.ident }, both],
        ['Identification number + Type Lien', { personId: ctx.ident, type: 'Lien' }, [lien]],
        ['Identification number + Type Collection', { personId: ctx.ident, type: 'Collection' }, [col]],
        ['Identification number + Status Fully restricted', { personId: ctx.ident, status: 'Fully restricted' }, both],
        ['Identification number + Status Executed', { personId: ctx.ident, status: 'Executed' }, []],
        ['Registration ID', { registrationId: ctx.regId }, both],
      ];
      for (const [name, f, expected] of cases) {
        await this.ui.openRestrictionsPage();
        await this.ui.filterRestrictions(f);
        const got = (await this.ui.restrictionsRows()).map((r) => r[0]).sort();
        assertCondition(OP_FILTER, JSON.stringify(got) === JSON.stringify(expected), `${name}: ${got.join(', ') || 'ცარიელი'}`, `${name}: ${expected.join(', ') || 'ცარიელი'}`, f);
      }
      console.log(`✅ Filters: ${cases.map((x) => x[0]).join(' · ')}`);
    } finally {
      await this.release(lien, col);
    }
  }

  /**
   * საერთო გვერდიდან ინკასოს გადახდა: ძებნა → ფანჯარა → Request amount → RS პასუხობს → Record manual payment → Executed →
   *   სიაში Executed; History (ყველა ნაბიჯი რიგით, ვინ გააკეთა), "Before, after and payload" (თანხა, Bank reference), Audit
   */
  async payCollectionFromList(c: { balance: number; lien: number; collection: number }) {
    const { ctx, lien, col } = await this.lienAndCollection(c);
    const bankReference = `QA-LC-${digits(6)}`;
    try {
      await this.openFromList(col);
      await this.ui.requestAmount();
      assertCondition(OP_MODAL, await this.ui.toast('Amount requested from RS'), 'toast არ გამოჩნდა', 'toast "Amount requested from RS"', col);
      const id = await this.restrictionId(col);
      const exec = await this.poll(async () => {
        const e = (RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(id)).executions || [])[0];
        return e?.status === 'AMOUNT_RECEIVED' ? e : undefined;
      }, 60_000);
      assertCondition(OP_RESTRICTION, !!exec && round(exec.answerAmount) === c.collection, `execution ${exec?.status} ${exec?.answerAmount}`, `AMOUNT_RECEIVED, RS answer ${c.collection}`, exec);
      await this.ui.closeModal();

      await this.openFromList(col);
      const today = await this.ui.todayText();
      assertCondition(OP_MODAL, today.startsWith(`Amount received | RS asks ${money(c.collection)} today.`), `TODAY: ${today}`, `Amount received | RS asks ${money(c.collection)} today.`, today);
      await this.ui.openManualPaymentForm();
      await this.ui.fillManualPayment({ amount: String(c.collection), bankReference });
      const r = await this.ui.submitManualPayment();
      assertCondition(OP_FORM, r.closed && r.http === 200 && r.toast.includes('Payment recorded'), `HTTP ${r.http} · ${r.toast || '-'} · ${r.errors.join(' | ')}`, '200 · "Payment recorded. Taking the money off the wallets."', r);
      await this.ui.closeModal();
      await this.expectApiStatus(col, 'EXECUTED', 0);
      await this.expectWallet(ctx, round(c.balance - c.collection), c.lien, `ინკასო ჩამოიჭრა ${c.collection}, ყადაღა ${c.lien} ისევ გაყინულია`);

      await this.ui.openRestrictionsPage();
      await this.ui.searchRestrictions(col);
      this.expectRows(await this.ui.restrictionsRows(), [this.row(col, 'Collection', ctx.ident, c.collection, 0, 0, c.collection, 'Executed')], 'გადახდის შემდეგ');
      console.log(`✅ Collection ${c.collection} paid from Liens & collections page — Executed`);

      await this.ui.openRestriction(col);
      const history = await this.ui.modalEvents('History');
      this.expectEvents(OP_HISTORY, history, COLLECTION_PAID_HISTORY);
      const actor = (t: string) => history.find((e) => e.title === t)?.actor || '';
      const actors = [['Collection received', /^RS: \d+/], ['Hold placed', /^Integrator: distributor-hub$/], ['Amount requested manually', /^User: /],
        ['RS answered the amount', /^RS: \d+/], ['Manual payment recorded', /^User: /], ['Transfer succeeded', /^Integrator: distributor-hub$/], ['Executed', /^System: /]] as const;
      const wrong = actors.filter(([t, re]) => !re.test(actor(t))).map(([t]) => `${t}: "${actor(t)}"`);
      assertCondition(OP_HISTORY, wrong.length === 0, `ვინ: ${wrong.join(' · ')}`, actors.map(([t, re]) => `${t} — ${re}`).join(' · '), history);

      const payload = await this.ui.eventPayload('Manual payment recorded', 'Collection cycle');
      const p = payload?.payload || {};
      assertCondition(OP_HISTORY, round(p.amount) === c.collection && p.bankReference === bankReference && !!p.answerId && !!p.paidAt,
        `payload: ${JSON.stringify(payload)}`, `Manual payment recorded → payload { amount ${c.collection}, bankReference ${bankReference}, answerId, paidAt }`, payload);

      const audit = await this.ui.modalEvents('Audit');
      this.expectEvents(OP_AUDIT, audit, COLLECTION_PAID_AUDIT);
      const notRestriction = audit.filter((e) => e.entity !== 'Restriction');
      assertCondition(OP_AUDIT, notRestriction.length === 0, `Audit-ში სხვა: ${notRestriction.map((e) => `${e.title} (${e.entity})`).join(', ')}`,
        'Audit — მხოლოდ Restriction-ის ცვლილებები (Hold / Transfer / Collection cycle — მხოლოდ History-ში)', audit);
      await this.ui.closeModal();
      console.log(`✅ History ${history.length} events in order, payload OK; Audit ${audit.length} restriction events`);
    } finally {
      await this.release(lien, col);
    }
  }

  /** ყადაღა საერთო გვერდიდან: ფანჯარაში Request amount / Record manual payment არ არის → RS ხსნის → სიაში Withdrawn → History / Audit */
  async lienWithdrawnFromList(c: { balance: number; lien: number; collection: number }) {
    const { ctx, lien, col } = await this.lienAndCollection(c);
    try {
      await this.openFromList(lien);
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_MODAL, !buttons.includes('Request amount from RS') && !buttons.includes('Record manual payment') && !buttons.includes('Executions'),
        `ღილაკები: ${buttons.join(' · ')}`, 'ყადაღა — ჩამოჭრა არ ხდება: Executions ტაბი, Request amount, Record manual payment არ არის', buttons);
      await this.ui.closeModal();

      await this.sim.obtainLien(lien);
      await this.expectApiStatus(lien, 'WITHDRAWN', 0);
      await this.expectWallet(ctx, c.balance, c.collection, `ყადაღა მოიხსნა, ინკასო ${c.collection} ისევ გაყინულია`);
      await this.ui.openRestrictionsPage();
      await this.ui.searchRestrictions(lien);
      const row = (await this.ui.restrictionsRows())[0] || [];
      assertCondition(OP_LIST, row[0] === lien && row[4] === money(0) && row[7] === 'Withdrawn', `მწკრივი: ${row.join(' | ')}`, `${lien} · Restricted ${money(0)} · Withdrawn`, row);

      await this.ui.openRestriction(lien);
      const history = await this.ui.modalEvents('History');
      this.expectEvents(OP_HISTORY, history, LIEN_WITHDRAWN_HISTORY);
      const by = history.find((e) => e.title === 'Lien withdrawn by RS')?.actor || '';
      assertCondition(OP_HISTORY, /^RS: \d+/.test(by), `Lien withdrawn by RS — ${by}`, 'Lien withdrawn by RS — RS: <message id>', history);
      const audit = await this.ui.modalEvents('Audit');
      this.expectEvents(OP_AUDIT, audit, LIEN_WITHDRAWN_AUDIT);
      await this.ui.closeModal();
      console.log(`✅ Lien withdrawn — list Withdrawn, History ${history.length}, Audit ${audit.length}`);
    } finally {
      await this.release(lien, col);
    }
  }

  // ─── შიდა ───

  /** UI-დან ბიზნესი (Approved) → RS: ყადაღა + ინკასო (ორივე სრულად იყინება) */
  private async lienAndCollection(c: { balance: number; lien: number; collection: number }): Promise<{ ctx: Ctx; lien: string; col: string }> {
    this.guard(c.balance, c.lien, c.collection);
    assertCondition('ტესტის კონფიგი', round(c.lien + c.collection) <= c.balance, `${c.lien} + ${c.collection} > ${c.balance}`, 'ორივე Fully restricted', c);
    const ctx = await this.prepare(c.balance);
    const lien = `QA-L-LC-${Date.now()}`;
    const res = await this.sim.lien(ctx.ident, c.lien, lien);
    assertCondition('POST $SIM/orders/lien', res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია', res?.items);
    const col = await this.sendCollection(ctx, c.collection);
    await this.expectApiStatus(lien, 'FULLY_RESTRICTED', c.lien);
    await this.expectApiStatus(col, 'FULLY_RESTRICTED', c.collection);
    await this.expectWallet(ctx, c.balance, round(c.lien + c.collection), 'ყადაღა + ინკასო გაიყინა');
    return { ctx, lien, col };
  }

  /** საერთო გვერდი → ძებნა → ფანჯარა */
  private async openFromList(number: string) {
    await this.ui.openRestrictionsPage();
    await this.ui.searchRestrictions(number);
    await this.ui.openRestriction(number);
  }

  /** მოსალოდნელი მწკრივი (Received-ის გარდა) */
  private row(ref: string, type: string, ident: string, requested: number, restricted: number, remaining: number, executed: number, status: string): string[] {
    return [ref, type, `${type === 'Lien' ? '-' : 'Simulated taxpayer'} ${ident}`, money(requested), money(restricted), money(remaining), money(executed), status];
  }

  private expectRows(got: string[][], expected: string[][], why: string) {
    const cut = got.map((r) => r.slice(0, 8));
    assertCondition(OP_LIST, JSON.stringify(cut) === JSON.stringify(expected), `${why}: ${cut.map((r) => r.join(' | ')).join(' || ') || 'ცარიელი'}`,
      `${why}: ${expected.map((r) => r.join(' | ')).join(' || ') || 'ცარიელი ("No Items")'}`, got);
  }

  /** ყველა მოსალოდნელი მოვლენა არის და ქრონოლოგიური რიგით მიდის (UI-ში ახალი ზემოთ → ვაბრუნებთ) */
  private expectEvents(op: string, events: Event[], expected: string[]) {
    const titles = events.map((e) => e.title).reverse();
    let i = 0;
    const missing: string[] = [];
    for (const t of expected) {
      const at = titles.indexOf(t, i);
      if (at < 0) missing.push(t); else i = at + 1;
    }
    assertCondition(op, missing.length === 0, `აკლია / რიგი არეულია: ${missing.join(' · ')} — მოვიდა: ${titles.join(' → ')}`, expected.join(' → '), events);
  }

  private async restrictionId(number: string): Promise<string> {
    return RsHubApi.expectOk('GET /api/v1/rs/restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0].id;
  }

  /** ტესტის ბოლოს: RS ხსნის რაც ჯერ აქტიურია (ფული არ დარჩეს გაყინული) */
  private async release(lien: string, col: string) {
    await this.cleanup(col);
    const l = (await this.api.getRestrictions({ rsNumber: lien })).value?.content?.[0];
    if (l && !['WITHDRAWN', 'RETURNED'].includes(l.status)) await this.sim.obtainLien(lien);
  }
}
