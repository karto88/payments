import { RsFrontHelper } from './RsFrontHelper';
import { RsHubApi } from '../RsHubApi';
import { assertCondition } from '../../../assertions';

const OP_MODAL = 'UI Liens & collections — ფანჯარა';
const OP_BIZ = 'UI Dist. Businesses — Wallet clients (Unlink)';
const OP_REQ = 'POST /api/v1/rs/restrictions/{id}/request-amount';

/**
 * RS ფრონტი — UI-ის დაცვები (ნეგატიური): ღილაკი არ ჩანს / გამორთულია, როცა მოქმედება აკრძალულია; API იგივეს ამბობს (შეცდომის კოდით)
 *   📋 Request amount — დღეში ერთხელ (7018), მხოლოდ გაყინულ თანხაზე (Pending → 7011)
 *   📋 Unlink — გაყინული ფულით შეუძლებელია (409 / 1492, ადრე 5114) → ღილაკი გამორთულია, RS-ის მოხსნის შემდეგ ირთვება
 *   📋 Reallocate holds — Fully restricted-ზე არ ჩანს (KD-2617-ის შემდეგ), Partially restricted-ზე ჩანს
 */
export class RsFrontGuardsHelper extends RsFrontHelper {
  /** ინკასო (Fully restricted) → Request amount from RS → toast → ღილაკი ქრება (დღეს მეორედ ვერ) → API: მეორე მოთხოვნა → 7018 */
  async requestAmountOncePerDay(c: { balance: number; collection: number }) {
    this.guard(c.balance, c.collection);
    const ctx = await this.prepare(c.balance);
    const number = await this.sendCollection(ctx, c.collection);
    try {
      await this.expectOverview(ctx, number, { status: 'Fully restricted', requested: c.collection, restricted: c.collection, remaining: c.collection, executed: 0 });
      await this.ui.requestAmount();
      assertCondition(OP_MODAL, await this.ui.toast('Amount requested from RS'), 'toast არ გამოჩნდა', 'toast "Amount requested from RS. Waiting for its answer."', null);
      await this.ui.closeModal();
      await this.ui.openRegistration(ctx.regId, 'restrictions');
      await this.ui.openRestriction(number);
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_MODAL, !buttons.includes('Request amount from RS'), `ღილაკები: ${buttons.join(' · ')}`, '"Request amount from RS" აღარ ჩანს — დღეს უკვე მოთხოვნილია', buttons);
      const id = await this.restrictionId(number);
      const res = await this.api.requestAmount(id);
      assertCondition(OP_REQ, res.status >= 400 && res.body?.statusCode === 7018, `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`,
        '4xx / 7018 — დღეს უკვე მოთხოვნილია', res.body);
      console.log('✅ Request amount: after 1st request button hidden; API 2nd request → 7018');
    } finally {
      await this.cleanup(number);
    }
  }

  /** ცარიელი wallet → ინკასო → Pending (გაყინული 0) → "Request amount from RS" არ ჩანს → API → 7011 */
  async requestAmountHiddenOnPending(c: { collection: number }) {
    this.guard(c.collection);
    const ctx = await this.prepare(0);
    const number = await this.sendCollection(ctx, c.collection);
    try {
      await this.expectOverview(ctx, number, { status: 'Pending', requested: c.collection, restricted: 0, remaining: c.collection, executed: 0 });
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_MODAL, !buttons.includes('Request amount from RS'), `ღილაკები: ${buttons.join(' · ')}`, '"Request amount from RS" არ ჩანს — გაყინული არაფერია', buttons);
      const res = await this.api.requestAmount(await this.restrictionId(number));
      assertCondition(OP_REQ, res.status >= 400 && res.body?.statusCode === 7011, `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`,
        '4xx / 7011 — Pending ინკასოზე მოთხოვნა არ შეიძლება', res.body);
      console.log('✅ Pending collection: no "Request amount from RS"; API → 7011');
    } finally {
      await this.cleanup(number);
    }
  }

  /** wallet 0.3 → ყადაღა → ბიზნესის გვერდზე Unlink გამორთულია → API unlink → 1492 → RS ხსნის → Unlink ირთვება */
  async unlinkDisabledWhileHeld(c: { balance: number; lien: number }) {
    this.guard(c.balance, c.lien);
    const ctx = await this.prepare(c.balance);
    const number = `QA-L-UI-UNL-${Date.now()}`;
    const res = await this.sim.lien(ctx.ident, c.lien, number);
    assertCondition('POST $SIM/orders/lien', res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}`, 'მიღებულია', res?.items);
    try {
      await this.expectWallet(ctx, c.balance, c.lien, 'ყადაღა გაიყინა');
      await this.ui.openBusiness(ctx.businessId);
      assertCondition(OP_BIZ, await this.ui.unlinkDisabled(ctx.wallet.name), 'Unlink აქტიურია', `${ctx.wallet.name}: Unlink გამორთულია (გაყინულია ${c.lien})`, null);
      const un = await this.api.unlinkClient(ctx.businessId, ctx.wallet.clientId);
      // 11.11-დან კოდი 1492 (ადრე 5114), ტექსტი: "Money is held on this client for RS liens or collections…"
      assertCondition('DELETE /api/distributor-hub-business/{id}/clients/{clientId}', un.status === 409 && un.body?.statusCode === 1492 && /Money is held/.test(un.body?.message),
        `HTTP ${un.status}, code ${un.body?.statusCode}: ${un.body?.message}`, '409 / 1492 — "Money is held on this client for RS liens or collections…"', un.body);
    } finally {
      await this.sim.obtainLien(number);
    }
    await this.expectWallet(ctx, c.balance, 0, 'RS-მა მოხსნა');
    const enabled = await this.poll(async () => {
      await this.ui.openBusiness(ctx.businessId);
      return (await this.ui.unlinkDisabled(ctx.wallet.name)) ? undefined : true;
    }, 30_000, 3000);
    assertCondition(OP_BIZ, !!enabled, 'Unlink ისევ გამორთულია', `${ctx.wallet.name}: მოხსნის შემდეგ Unlink აქტიურია`, null);
    console.log('✅ Unlink disabled while held (API 1492) → enabled after withdraw');
  }

  /**
   * Reallocate holds-ის ხილვადობა: wallet `balance` → ყადაღა `partial` > balance → Partially restricted → ღილაკი ჩანს;
   *   მეორე ყადაღა `full` ≤ დარჩენილი (0 → Pending) … → Fully restricted ყადაღაზე ღილაკი არ ჩანს (KD-2617-ის შემდეგ)
   */
  async reallocateButtonVisibility(c: { balance: number; full: number; partial: number }) {
    this.guard(c.balance, c.full, c.partial);
    assertCondition('ტესტის კონფიგი', c.full < c.balance && c.partial > c.balance - c.full, JSON.stringify(c), 'full < balance, partial > დარჩენილი', c);
    const ctx = await this.prepare(c.balance);
    const full = `QA-L-UI-RAF-${Date.now()}`;
    const partial = `QA-L-UI-RAP-${Date.now() + 1}`;
    try {
      await this.sim.lien(ctx.ident, c.full, full);
      await this.expectOverview(ctx, full, { status: 'Fully restricted', requested: c.full, restricted: c.full, remaining: c.full });
      const b1 = await this.ui.modalButtons();
      assertCondition(OP_MODAL, !b1.includes('Reallocate holds'), `ღილაკები: ${b1.join(' · ')}`, 'Fully restricted → "Reallocate holds" არ ჩანს', b1);
      await this.ui.closeModal();
      await this.sim.lien(ctx.ident, c.partial, partial);
      const left = Math.round((c.balance - c.full) * 100) / 100;
      await this.expectOverview(ctx, partial, { status: 'Partially restricted', requested: c.partial, restricted: left, remaining: c.partial });
      const b2 = await this.ui.modalButtons();
      assertCondition(OP_MODAL, b2.includes('Reallocate holds'), `ღილაკები: ${b2.join(' · ')}`, 'Partially restricted → "Reallocate holds" ჩანს', b2);
      console.log('✅ Reallocate holds: hidden on Fully restricted, visible on Partially restricted');
    } finally {
      await this.sim.obtainLien(full).catch(() => undefined);
      await this.sim.obtainLien(partial).catch(() => undefined);
    }
  }

  private async restrictionId(number: string): Promise<string> {
    return RsHubApi.expectOk('GET /api/v1/rs/restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0].id;
  }
}
