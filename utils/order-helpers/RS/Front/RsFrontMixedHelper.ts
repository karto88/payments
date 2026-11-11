import { APIRequestContext, Page } from '@playwright/test';
import { RsAdminUiPage, RestrictionOverview } from '../../../../pages/RsAdminUiPage';
import { RsHubApi } from '../RsHubApi';
import { RestrictionKind } from '../RsLienHelper';
import { RsMixedWalletsHelper, Mixed } from '../RsMixedWalletsHelper';
import { assertCondition } from '../../../assertions';

const OP_WALLETS = 'UI RS registration — Wallets (merchant + hub)';
const OP_MODAL = 'UI Liens & collections — ფანჯარა (merchant + hub)';
const OP_BIZ = 'UI Dist. Businesses — Wallet clients (hub)';

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `₾ ${round(n).toFixed(2)}`;
/** FULLY_RESTRICTED → "Fully restricted" */
const uiLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
/** MERCHANT:… → payment-service · CLIENT:… → distributor-hub */
const integratorOf = (ref: string) => (ref.startsWith('MERCHANT:') ? 'payment-service' : 'distributor-hub');

/**
 * RS ფრონტი — merchant + hub ერთ რეგისტრაციაზე (UI = API).
 *   📋 ნაბიჯები და API-ის შემოწმებები — RsMixedWalletsHelper (იგივე ტესტები, რაც Back-ში);
 *      აქ — შემოწმების წერტილებში UI: Wallets ტაბი, Liens & collections ფანჯარა (Overview, Holds per wallet, Executions + TRANSFERS, Reallocate holds), ბიზნესის გვერდი
 */
export class RsFrontMixedHelper extends RsMixedWalletsHelper {
  private ui: RsAdminUiPage;
  private loggedIn = false;

  constructor(page: Page, request: APIRequestContext, kind: RestrictionKind = 'LIEN') {
    super(request, kind);
    this.ui = new RsAdminUiPage(page);
  }

  /** Wallets ტაბი: "Wallets 2", თითო მწკრივი = API enrollment (სახელი, Integrator, Holder reference, Accounts open Yes, Active) */
  protected async onLinked(regId: string) {
    const v = RsHubApi.expectOk('GET /api/v1/rs/registrations/{id}', await this.api.getRegistration(regId));
    const active = v.enrollments.filter((e: any) => e.status === 'ACTIVE');
    await this.login();
    await this.ui.openRegistration(regId, 'wallets');
    const count = await this.ui.tabCount('Wallets');
    assertCondition(OP_WALLETS, count === 2, `Wallets ${count}`, 'Wallets 2 (merchant + hub)', active);
    await this.ui.openTab('Wallets');
    const rows = (await this.ui.tabRows()).map((r) => r.join(' | '));
    for (const e of active) {
      const line = rows.find((l) => l.includes(e.holderRef)) || '';
      const exp = [e.holderName, integratorOf(e.holderRef), e.holderRef, 'Yes', 'Active'];
      const miss = exp.filter((x) => !line.includes(x));
      assertCondition(OP_WALLETS, miss.length === 0, `მწკრივი: ${line || 'არ ჩანს'}${miss.length ? ` · აკლია: ${miss.join(', ')}` : ''}`, exp.join(' | '), rows);
    }
    assertCondition(OP_WALLETS, rows.length === 2, `${rows.length} მწკრივი`, '2 მწკრივი: payment-service + distributor-hub', rows);
    console.log(`✅ UI Wallets: ${active.map((e: any) => `${e.holderName} (${integratorOf(e.holderRef)})`).join(' + ')}`);
  }

  /** ფანჯარა: Overview = API (სტატუსი, Requested, Restricted); Holds per wallet — merchant და hub: Target / Held = API; ბიზნესის გვერდზე hub-ის ბალანსი */
  protected async onHeld(m: Mixed, number: string) {
    const d = await this.restriction(number);
    const restricted = round(d.allocations.reduce((a: number, x: any) => a + Number(x.held), 0));
    await this.openModal(m, number, { status: uiLabel(d.restriction.status), requested: Number(d.restriction.requestedAmount), restricted });
    await this.expectHoldRows(d);
    await this.ui.closeModal();
    await this.expectHubOnBusinessPage(m);
    console.log(`✅ UI ${number}: ${uiLabel(d.restriction.status)}, restricted ${restricted} — Holds per wallet = API`);
  }

  /** გადახდის შემდეგ: Overview (სტატუსი, Executed), Holds per wallet (Executed), Executions (Completed / Manual / Accomplished / MANUAL PAYMENT; TRANSFERS: ვისგან რამდენი, Success) */
  protected async onPaid(m: Mixed, number: string, d: any) {
    const restricted = round(d.allocations.reduce((a: number, x: any) => a + Number(x.held), 0));
    const executed = round(Number(d.restriction.executedAmount));
    await this.openModal(m, number, { status: uiLabel(d.restriction.status), requested: Number(d.restriction.requestedAmount), restricted, executed });
    await this.expectHoldRows(d);
    // Executions (10.11-დან ბარათები): 1 ბარათი Completed, Manual, Accomplished = executed, MANUAL PAYMENT (Bank reference = API); TRANSFERS: ვისგან რამდენი, Success
    const ex = await this.ui.executions();
    const accomplished = round(ex.accomplished.reduce((a, b) => a + b, 0));
    const bankRef = d.executions?.[0]?.manualPayment?.bankReference ?? d.executions?.[0]?.bankReference;
    assertCondition(OP_MODAL, ex.statuses.length === 1 && ex.statuses[0] === 'Completed' && ex.text.includes('Source | Manual') && accomplished === executed
      && ex.text.includes('MANUAL PAYMENT') && (!bankRef || ex.text.includes(`Bank reference | ${bankRef}`)),
      `Executions: ${ex.text}`, `1 ბარათი: Completed · Manual · Accomplished ${money(executed)} · MANUAL PAYMENT${bankRef ? ` (Bank reference ${bankRef})` : ''}`, ex.statuses);
    const tr = ex.transfers.map((r) => r.join(' | '));
    const names = new Map<string, string>(d.allocations.map((a: any) => [a.holderRef, a.holderName]));
    for (const t of d.transfers) {
      const name = names.get(t.holderRef) || t.holderRef;
      const line = tr.find((l) => l.startsWith(name) && l.includes(money(Number(t.amount)))) || '';
      assertCondition(OP_MODAL, line.includes('Success'), `TRANSFERS: ${tr.join(' || ')}`, `${name} (${integratorOf(t.holderRef)}) | ${money(Number(t.amount))} | Success`, d.transfers);
    }
    assertCondition(OP_MODAL, tr.length === d.transfers.length, `${tr.length} მწკრივი`, `${d.transfers.length} მწკრივი (= API transfers)`, tr);
    await this.ui.closeModal();
    await this.expectHubOnBusinessPage(m);
    console.log(`✅ UI ${number}: ${uiLabel(d.restriction.status)}, executed ${executed} — Executions + TRANSFERS = API`);
  }

  /** ინკასოს გადახდა UI-დან: ფანჯარა → Request amount from RS → RS-ის პასუხი → Record manual payment `pay` (Bank reference) → toast "Payment recorded…" */
  protected async payCollection(m: Mixed, number: string, restrictionId: string, pay: number) {
    await this.login();
    await this.ui.openRegistration(m.regId, 'restrictions');
    await this.ui.openRestriction(number);
    await this.ui.requestAmount();
    await this.poll(OP_MODAL, 60_000, 'RS-ის პასუხი (execution AMOUNT_RECEIVED)', async () =>
      (RsHubApi.expectOk('GET /api/v1/rs/restrictions/{id}', await this.api.getRestriction(restrictionId)).executions || []).find((e: any) => e.status === 'AMOUNT_RECEIVED'));
    await this.ui.closeModal();
    await this.ui.openRegistration(m.regId, 'restrictions');
    await this.ui.openRestriction(number);
    await this.ui.openManualPaymentForm();
    await this.ui.fillManualPayment({ amount: String(pay), bankReference: `QA-MIX-UI-${Date.now() % 1_000_000}` });
    const r = await this.ui.submitManualPayment();
    assertCondition(`${OP_MODAL} — Record manual payment`, r.closed && r.http === 200 && r.toast.includes('Payment recorded'),
      `HTTP ${r.http} · toast ${r.toast || '-'} · ${r.errors.join(' | ')}`, `${pay} ჩაიწერა: 200, "Payment recorded…"`, r);
    await this.ui.closeModal();
    console.log(`✅ UI ${number}: Request amount → Record manual payment ${pay}`);
  }

  /** Reallocate UI-დან:რეგისტრაცია → Liens & collections → ფანჯარა → "Reallocate holds" → "Reallocate holds?" → Reallocate → POST …/reallocate 2xx */
  protected async reallocate(m: Mixed, number: string, _restrictionId: string) {
    await this.login();
    await this.ui.openRegistration(m.regId, 'restrictions');
    await this.ui.openRestriction(number);
    const buttons = await this.ui.modalButtons();
    assertCondition(OP_MODAL, buttons.includes('Reallocate holds'), `ღილაკები: ${buttons.join(' · ')}`, 'ღილაკი "Reallocate holds"', buttons);
    const status = await this.ui.reallocateHolds();
    assertCondition(`${OP_MODAL} — Reallocate holds (POST /api/v1/rs/restrictions/{id}/reallocate)`, status >= 200 && status < 300,
      `HTTP ${status}`, 'HTTP 2xx — rs-service ხელახლა გეგმავს', null);
    await this.ui.closeModal();
    console.log(`✅ UI ${number}: Reallocate holds → HTTP ${status}`);
  }

  // ─── შიდა ───

  private async login() {
    if (this.loggedIn) return;
    await this.ui.login();
    this.loggedIn = true;
  }

  /** Liens & collections → მწკრივი (რეფრეშით, ახალი ჩანაწერი შეიძლება ჯერ არ ჩანდეს) → ფანჯარა → Overview = მოსალოდნელი */
  private async openModal(m: Mixed, number: string, exp: { status: string; requested: number; restricted: number; executed?: number }) {
    await this.login();
    let last: RestrictionOverview | undefined;
    const ok = await this.poll(OP_MODAL, 40_000, '', async () => {
      await this.ui.openRegistration(m.regId, 'restrictions');
      if (!(await this.ui.openRestriction(number, 6_000).then(() => true, () => false))) return undefined;
      last = await this.ui.restrictionOverview();
      const match = last.status === exp.status && last.requested === round(exp.requested) && last.restricted === round(exp.restricted)
        && (exp.executed === undefined || last.executed === round(exp.executed));
      if (!match) await this.ui.closeModal();
      return match ? last : undefined;
    }, false);
    assertCondition(OP_MODAL, !!ok, last ? `${last.status} · requested ${last.requested} · restricted ${last.restricted} · executed ${last.executed}` : `${number} არ ჩანს`,
      `${exp.status} · requested ${round(exp.requested)} · restricted ${round(exp.restricted)}${exp.executed !== undefined ? ` · executed ${exp.executed}` : ''}`, last);
  }

  /** Holds per wallet: თითო wallet (merchant / hub), რომელზეც რამე დაიგეგმა: სახელი | Integrator | Target | Held | Executed = API */
  private async expectHoldRows(d: any) {
    const rows = (await this.ui.modalTab('Holds per wallet')).map((r) => r.join(' | '));
    const planned = d.allocations.filter((a: any) => Number(a.target) > 0 || Number(a.executed) > 0);
    for (const a of planned) {
      const exp = `${a.holderName} | ${integratorOf(a.holderRef)} | ${money(Number(a.target))} | ${money(Number(a.held))} | ${money(Number(a.executed))}`;
      assertCondition(OP_MODAL, rows.some((l) => l.startsWith(exp)), `Holds per wallet: ${rows.join(' || ')}`, exp, a);
    }
    assertCondition(OP_MODAL, rows.length >= planned.length, `${rows.length} მწკრივი`, `მინიმუმ ${planned.length} (merchant / hub)`, rows);
  }

  /** ბიზნესის გვერდი → Wallet clients: hub wallet "₾ ბალანსი / ₾ გაყინული / ₾ თავისუფალი" = API */
  private async expectHubOnBusinessPage(m: Mixed) {
    const c = RsHubApi.expectOk('GET /api/distributor-hub-client/{id}', await this.api.getClient(m.hub.clientId));
    const b = await this.gel(m.hub.clientId);
    await this.ui.openBusiness(m.businessId);
    const rows = (await this.ui.businessWalletRows()).map((r) => r.join(' | '));
    const line = rows.find((l) => l.startsWith(c.clientName)) || '';
    const cell = b.amount === 0 ? '| - |' : `${money(b.amount)} / ${money(b.held)} / ${money(b.amount - b.held)}`;
    assertCondition(OP_BIZ, line.includes(cell), `მწკრივი: ${line || 'არ ჩანს'}`, `${c.clientName}: ${cell} (ბალანსი / გაყინული / თავისუფალი)`, rows);
  }
}
