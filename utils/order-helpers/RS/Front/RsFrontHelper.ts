import { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { RsAdminUiPage, RestrictionOverview } from '../../../../pages/RsAdminUiPage';
import { RsHubApi, RsSimulatorApi, DistributorApi, date, digits, randomCompanyName } from '../RsHubApi';
import { RsClientHelper } from '../RsClientHelper';
import { TRANSFER_TO } from '../RsLienHelper';
import { assertCondition } from '../../../assertions';

const UI = 'UI (dashboard.dev.keepz.me)';
const OP_UI_BIZ = `${UI} Dist. Businesses`;
const OP_UI_REG = `${UI} RS registration`;
const OP_UI_MODAL = `${UI} Collection ფანჯარა`;
const OP_UI_WALLET = `${UI} Dist. Integrators — wallet-ის შექმნა`;
const OP_SIM = 'POST $SIM/orders/collection (RS → ინკასო)';
const OP_SIM_LIEN = 'POST $SIM/orders/lien (RS → ყადაღა)';
const OP_UI_LIEN = `${UI} Lien — ცხრილი / ფანჯარა`;
const OP_CLIENT = 'GET /api/distributor-hub-client/{id}';
const OP_RESTRICTION = 'GET /api/v1/rs/restrictions';
const OP_TRANSFER = 'POST distributor /api/distributor/ (wallet-ის გადარიცხვა)';

/** ⚠️ hub კლიენტი STANDARD = რეალური ფული → ბალანსი / ინკასო ≤ 1 ₾ */
const MAX_AMOUNT = 1;
const TIMEOUT = 30_000;
/** wallet-ის მიბმა RS რეგისტრაციაზე (enrollment) — დოკუმენტაციით ~2 წთ */
const ENROLL_TIMEOUT = 3 * 60_000;

const round = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Ctx {
  ident: string;
  owner: string;
  businessId: string;
  regId: string;
  wallet: { clientId: string; clientSecret: string; name: string };
}

/**
 * RS ფრონტი (ადმინ პანელი) — flow-ები UI-დან, შემოწმება UI-ში + API-ში.
 *   📋 UI: Create business → Link clients (wallet) → რეგისტრაცია თავისით (Not submitted) → Submit to RS → Pending RS approval
 *   📋 RS-ის მხარე (სიმულატორი, API): დადასტურება (Approved), ინკასო; wallet-ის ბალანსი / გადარიცხვა — API
 *   📋 ინკასოს ფანჯარა: Overview (4 თანხა + სტატუსი), Holds per wallet, Executions, Request amount from RS, Record manual payment
 * Jira: KD-2239 (რეგისტრაცია), KD-2241 (ინკასო), KD-2559 (ფრონტის ეკრანები)
 */
export class RsFrontHelper {
  protected ui: RsAdminUiPage;
  protected api: RsHubApi;
  protected sim: RsSimulatorApi;
  protected dist: DistributorApi;

  constructor(page: Page, request: APIRequestContext) {
    this.ui = new RsAdminUiPage(page);
    this.api = new RsHubApi(request);
    this.sim = new RsSimulatorApi(request);
    this.dist = new DistributorApi(request);
  }

  // ─── KD-2239 რეგისტრაცია ───

  /** UI: ბიზნესი → wallet-ის მიბმა → რეგისტრაცია Not submitted → Submit to RS → Pending → RS ადასტურებს → Approved, Wallets 1 */
  async registerBusinessFromUi() {
    const ctx = await this.prepare(0);
    console.log(`✅ UI: ${ctx.owner} (${ctx.ident}) — Approved, wallet ${ctx.wallet.name} linked to RS registration`);
  }

  // ─── KD-2241 ინკასო ───

  /**
   * ინკასო ფულიან wallet-ზე → UI: Fully restricted, wallet-ზე გაყინულია → wallet ცდილობს გაყინული ფულის გადარიცხვას → უარი
   *   → "Return collection" ღილაკი არ ჩანს (11.11-დან ამოღებულია) → RS გამოითხოვს → Withdrawn, wallet-ის ფული თავისუფლდება
   */
  async collectionBlocksTransferThenWithdraw(c: { balance: number; collection: number; transfer: number }) {
    this.guard(c.balance, c.collection, c.transfer);
    const ctx = await this.prepare(c.balance);
    const number = await this.sendCollection(ctx, c.collection);
    try {
      const held = round(Math.min(c.balance, c.collection));
      await this.expectOverview(ctx, number, { status: 'Fully restricted', requested: c.collection, restricted: held, remaining: c.collection, executed: 0 });
      const holds = await this.ui.modalTab('Holds per wallet');
      assertCondition(OP_UI_MODAL, holds.some((r) => r[0] === ctx.wallet.name && r.includes(`₾ ${held.toFixed(2)}`)),
        'Holds per wallet-ში wallet / თანხა არ ჩანს', `${ctx.wallet.name} — Held ₾ ${held.toFixed(2)}`, holds);
      await this.ui.closeModal();

      // wallet ცდილობს გადარიცხვას: თავისუფალია balance − held
      const free = round(c.balance - held);
      const res = await this.dist.transfer(await this.dist.token(ctx.wallet.clientId, ctx.wallet.clientSecret),
        { amount: c.transfer, uniqueId: randomUUID(), ...TRANSFER_TO });
      assertCondition(OP_TRANSFER, res.status === 400 && res.body?.statusCode === 5038, `HTTP ${res.status}, code ${res.body?.statusCode}`,
        `HTTP 400 / 5038 — ${c.transfer} ₾ > თავისუფალი ${free} ₾ (ინკასო ყინავს ${held} ₾)`, res.body);
      await this.expectWallet(ctx, c.balance, held, 'გადარიცხვა უარყოფილია — ბალანსი და გაყინული უცვლელია');
      console.log(`✅ Transfer ${c.transfer} ₾ rejected (5038) — ${held} ₾ held by collection`);

      // "Return collection" ღილაკი 11.11-დან განზრახ ამოიღეს (user) — ადმინი ინკასოს ვეღარ აბრუნებს UI-დან
      await this.ui.openRestriction(number);
      const buttons = await this.ui.modalButtons();
      assertCondition(OP_UI_MODAL, !buttons.includes('Return collection'), `ღილაკები: ${buttons.join(' · ')}`, '"Return collection" არ ჩანს (11.11-დან ამოღებულია)', buttons);
      await this.ui.closeModal();

      // RS გამოითხოვს ინკასოს (ObtainCollection) → Withdrawn, გაყინული ფული თავისუფლდება
      await this.sim.obtainCollection(number);
      await this.expectApiStatus(number, 'WITHDRAWN', 0);
      await this.expectWallet(ctx, c.balance, 0, 'RS-მა ინკასო გამოითხოვა — გაყინული ფული თავისუფლდება');
      await this.expectOverview(ctx, number, { status: 'Withdrawn', requested: c.collection, restricted: 0, remaining: c.collection, executed: 0 });
      console.log(`✅ No "Return collection" button; RS withdrew the collection — wallet ${c.balance} ₾ free again`);
    } finally {
      await this.cleanup(number);
    }
  }

  /** ინკასო ცარიელ wallet-ზე → UI: Pending, "Waiting for funds" → ფული შემოდის → UI: ინკასო ივსება (Partially / Fully restricted) */
  async collectionFillsWhenMoneyArrives(c: { collection: number; topUp: number }) {
    this.guard(c.collection, c.topUp);
    const ctx = await this.prepare(0);
    const number = await this.sendCollection(ctx, c.collection);
    try {
      const o = await this.expectOverview(ctx, number, { status: 'Pending', requested: c.collection, restricted: 0, remaining: c.collection, executed: 0 });
      const short = `Waiting for funds: ${c.collection.toFixed(2)} GEL short`;
      assertCondition(OP_UI_MODAL, o.reason.includes(short), `Status reason: ${o.reason}`, `Status reason "${short}"`, o);
      await this.ui.closeModal();

      RsHubApi.expectOk('PUT /api/distributor-hub-client/{id} (ბალანსი)',
        await this.api.updateBalance(ctx.wallet.clientId, { amount: c.topUp, currency: 'GEL', description: 'QA RS front' }));
      const held = round(Math.min(c.topUp, c.collection));
      await this.expectWallet(ctx, c.topUp, held, `ახალი ფული იყინება ინკასოზე (${held} ₾)`);
      await this.expectOverview(ctx, number, {
        status: held >= c.collection ? 'Fully restricted' : 'Partially restricted',
        requested: c.collection, restricted: held, remaining: c.collection, executed: 0,
      });
      console.log(`✅ Collection filled from new money — held ${held} ₾`);
    } finally {
      await this.cleanup(number);
    }
  }

  /** UI: Request amount from RS → RS პასუხობს → Executions-ში ჩანს RS-ის თანხა, ხაზინაზე ავტომატური გადარიცხვა არ არის (ხელით რეჟიმი) */
  async requestAmountFromUi(c: { balance: number; collection: number }) {
    this.guard(c.balance, c.collection);
    const ctx = await this.prepare(c.balance);
    const number = await this.sendCollection(ctx, c.collection);
    try {
      await this.expectOverview(ctx, number, { status: 'Fully restricted', requested: c.collection, restricted: c.collection, remaining: c.collection, executed: 0 });
      await this.ui.requestAmount();
      assertCondition(OP_UI_MODAL, await this.ui.toast('Amount requested from RS'), 'toast "Amount requested from RS" არ გამოჩნდა', 'toast "Amount requested from RS"', null);

      // API: RS-მა უპასუხა, სისტემა არ რიცხავს (MANUAL_PAYMENT_NEEDED)
      const exec = await this.poll(async () => {
        const x = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content[0];
        const e = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestriction(x.id)).executions?.[0];
        return e?.status === 'AMOUNT_RECEIVED' ? e : undefined;
      });
      assertCondition(OP_RESTRICTION, !!exec && round(exec.answerAmount) === round(c.collection), `execution ${exec?.status} / ${exec?.answerAmount}`,
        `AMOUNT_RECEIVED, RS answer ${c.collection}`, exec);

      // UI: Executions — 1 ბარათი: Amount received, Manual, RS-ის თანხა; TRANSFERS ჯერ არ არის (ხელით რეჟიმი — სისტემა არ რიცხავს)
      await this.ui.closeModal();
      await this.ui.openRegistration(ctx.regId, 'restrictions');
      await this.ui.openRestriction(number);
      const ex = await this.ui.executions();
      const answer = `RS answer | ₾ ${c.collection.toFixed(2)}`;
      assertCondition(OP_UI_MODAL, ex.statuses.length === 1 && ex.statuses[0] === 'Amount received' && ex.text.includes('Source | Manual') && ex.text.includes(answer),
        `Executions: ${ex.text}`, `1 ბარათი: Amount received · Source Manual · ${answer}`, ex.statuses);
      assertCondition(OP_UI_MODAL, ex.transfers.filter((r) => r.some((x) => /₾/.test(x))).length === 0 && !ex.text.includes('MANUAL PAYMENT'),
        `TRANSFERS: ${JSON.stringify(ex.transfers)}`, 'გადარიცხვა არ არის — ადმინს ჯერ არაფერი ჩაუწერია', ex.transfers);
      console.log(`✅ Request amount from UI — RS answered ${exec.answerAmount} ₾, manual payment needed`);
    } finally {
      await this.cleanup(number);
    }
  }

  // ─── KD-2242 ყადაღა ───

  /**
   * UI flow (wallet → ბიზნესი → მიბმა → რეგისტრაცია → Approved) → RS აგზავნის ყადაღას → UI-ში ყველა ცხრილი:
   *   რეგისტრაცია → Liens & collections: მწკრივი (Lien, თანხები, სტატუსი) → ფანჯარა: Overview + Holds per wallet
   *   ბიზნესის გვერდი: Liens & collections მწკრივი + Wallet clients ბალანსი (ბალანსი / გაყინული / თავისუფალი); API — wallet held
   *   სტატუსი: Fully (ფული ≥ ყადაღა) · Partially (ფული < ყადაღა) · Pending (ფული 0)
   */
  async lienFromUi(c: { balance: number; lien: number }) {
    this.guard(c.lien);
    if (c.balance > 0) this.guard(c.balance);
    const ctx = await this.prepare(c.balance);
    const number = `QA-L-UI-${Date.now()}`;
    const res = await this.sim.lien(ctx.ident, c.lien, number);
    assertCondition(OP_SIM_LIEN, res?.accepted === true && res?.items?.[0]?.code === null, `code ${res?.items?.[0]?.code}: ${res?.items?.[0]?.description}`,
      'accepted, code null (მიღებულია)', res?.items);
    const held = round(Math.min(c.balance, c.lien));
    const status = held === 0 ? 'Pending' : held >= c.lien ? 'Fully restricted' : 'Partially restricted';
    const free = round(c.balance - held);
    const money = (n: number) => `₾ ${n.toFixed(2)}`;
    try {
      // ფანჯარა: Overview
      const o = await this.expectOverview(ctx, number, { status, requested: c.lien, restricted: held, remaining: c.lien });
      if (held < c.lien) {
        const short = `Waiting for funds: ${round(c.lien - held).toFixed(2)} GEL short`;
        assertCondition(OP_UI_LIEN, o.reason.includes(short), `Status reason: ${o.reason}`, `Status reason "${short}"`, o);
      }
      // ფანჯარა: Holds per wallet — wallet / distributor-hub / Target / Held / Fills up / Placed
      // hold-ის სტატუსი: Requested → Placed (wallet-ის პასუხის შემდეგ) — ველოდებით Placed-ს
      const fills = held < c.lien ? 'Yes' : 'No';
      let holds = await this.ui.modalTab('Holds per wallet');
      await this.poll(async () => {
        if ((holds.find((r) => r[0] === ctx.wallet.name) || []).includes('Placed')) return true;
        await this.ui.closeModal();
        await this.ui.openRegistration(ctx.regId, 'restrictions');
        if (!(await this.ui.openRestriction(number, 6_000).then(() => true, () => false))) return undefined;
        holds = await this.ui.modalTab('Holds per wallet');
        return undefined;
      }, TIMEOUT, 2000);
      const h = (holds.find((r) => r[0] === ctx.wallet.name) || []).join(' | ');
      assertCondition(OP_UI_LIEN, !!h && h.includes('distributor-hub') && h.includes(`${money(c.lien)} | ${money(held)}`) && h.includes(fills) && /Placed/i.test(h),
        `Holds per wallet: ${holds.map((r) => r.join(' | ')).join(' || ')}`,
        `${ctx.wallet.name} | distributor-hub | Target ${money(c.lien)} | Held ${money(held)} | … | Fills up ${fills} | Placed`, holds);
      await this.ui.closeModal();

      // რეგისტრაციის ცხრილის მწკრივი (გვერდის ხელახლა ჩატვირთვით — სია ფანჯრის გახსნამდე ჩაიტვირთა)
      let row: string[] = [];
      let reloads = 0;
      await this.poll(async () => {
        await this.ui.openRegistration(ctx.regId, 'restrictions');
        row = await this.ui.restrictionRow(number, 8_000).catch(() => []);
        if (!row.length) reloads++;
        return row[7] === status ? true : undefined;
      }, TIMEOUT, 2000);
      if (reloads) console.log(`⚠️ Liens & collections ტაბზე ყადაღა ${reloads}-ჯერ არ ჩანდა ("No liens or collections") — გვერდის ხელახლა ჩატვირთვით გამოჩნდა`);
      const exp = [number, 'Lien', money(c.lien), money(held), money(c.lien), status];
      assertCondition(OP_UI_LIEN, row[0] === number && row[1] === 'Lien' && row[3] === money(c.lien) && row[4] === money(held) && row[5] === money(c.lien) && row[7] === status,
        `მწკრივი: ${row.join(' | ')}`, `${exp.join(' | ')} (ref | type | requested | restricted | remaining | status)`, row);

      // ბიზნესის გვერდი: Liens & collections + Wallet clients ბალანსი
      await this.ui.openBusiness(ctx.businessId);
      const biz = await this.ui.businessText();
      // ცარიელ wallet-ს ბალანსის ჩანაწერი არ აქვს → Balances სვეტში "-"
      const balanceCell = c.balance > 0 ? `${money(c.balance)} / ${money(held)} / ${money(free)}` : `${ctx.wallet.name} | Active | - |`;
      assertCondition(OP_UI_BIZ, biz.includes(number) && biz.includes(status) && biz.includes(balanceCell),
        'ბიზნესის გვერდზე ყადაღა / ბალანსი არ ემთხვევა', `Liens & collections: ${number} ${status}; Wallet clients GEL ${balanceCell} (ბალანსი / გაყინული / თავისუფალი)`, biz);

      // API: wallet-ზე მართლა გაყინულია
      await this.expectWallet(ctx, c.balance, held, `ყადაღამ გაყინა ${held}`);
      console.log(`✅ Lien ${c.lien} ₾ on wallet ${c.balance} ₾ — ${status}, held ${held}: modal, holds, row, business page OK`);
    } finally {
      await this.sim.obtainLien(number);
    }
  }

  // ─── საერთო ნაბიჯები ───

  /**
   * UI: wallet (Dist. Integrators, ბიზნესის გარეშე) → Create business → Link clients → რეგისტრაცია თავისით (Not submitted)
   *   → Submit to RS → Pending → RS ადასტურებს (~10 წმ) → Approved → ცხრილების შემოწმება (რეგისტრაცია, Wallets, ბიზნესი, სია)
   *   ბალანსი (თუ > 0) — ადმინის შევსება API-ით
   */
  protected async prepare(balance: number): Promise<Ctx> {
    const name = `QA UI Wallet ${digits(6)}`;
    await this.ui.login();
    const ids = await this.ui.createWalletClient(name);
    assertCondition(OP_UI_WALLET, await this.ui.toast('Integrator was created successfully'), 'toast "Integrator was created successfully!" არ გამოჩნდა',
      'wallet შეიქმნა UI-დან', name);
    const free = RsHubApi.expectOk('GET wallet-clients-without-business', await this.api.walletClientsWithoutBusiness());
    const created = (free || []).find((c: any) => c.clientName === name);
    assertCondition(OP_UI_WALLET, !!created, 'UI-დან შექმნილი wallet ბიზნესის გარეშე სიაში არ არის', `${name} — Clients without business`, (free || []).length);
    const client = RsHubApi.expectOk('GET /api/distributor-hub-client/{id}', await this.api.getClient(created.clientId));
    const diff = Object.entries({ scheme: 'WALLET', distributeMethod: 'IBAN', distributionStrategy: 'STANDARD', isMock: true, businessId: null })
      .filter(([k, v]) => (client[k] ?? null) !== v).map(([k, v]) => `${k}: ${client[k]} ≠ ${v}`);
    assertCondition(OP_UI_WALLET, diff.length === 0, `არ ემთხვევა: ${diff.join(', ')}`, 'WALLET / IBAN / STANDARD / For testing / ბიზნესის გარეშე', client);
    assertCondition(OP_UI_WALLET, created.clientId === ids.clientId, `სიაში ${created.clientId}`, `Create-ის პასუხი ${ids.clientId}`, ids);
    const w = { clientId: ids.clientId, clientSecret: ids.clientSecret };
    if (balance > 0) RsHubApi.expectOk('PUT /api/distributor-hub-client/{id} (ბალანსი)', await this.api.updateBalance(w.clientId, { amount: balance, currency: 'GEL', description: 'QA RS front' }));
    console.log(`✅ Wallet ${name} created from UI (${w.clientId})${balance ? `, balance ${balance} ₾` : ''}`);

    const ident = `9${digits(8)}`;
    const owner = randomCompanyName();
    const businessId = await this.ui.createBusiness({ ownerFullName: owner, identNumber: ident, operDate: date(30), knownDate: date(10) });
    assertCondition(OP_UI_BIZ, await this.ui.toast('Business created'), 'toast "Business created" არ გამოჩნდა', 'toast "Business created"', businessId);

    await this.ui.linkClient(name);
    assertCondition(OP_UI_BIZ, await this.ui.toast('Clients linked'), 'toast "Clients linked" არ გამოჩნდა', 'toast "Clients linked"', name);
    // გვერდი მიბმის შემდეგ ახლდება (wallet + თავისით შექმნილი რეგისტრაცია)
    let biz = '';
    // RS პანელი: "RS registration | Refresh | Open registration | Submit to RS | Not submitted" (ღილაკები ფრონტის 10.11-ის განახლებით დაემატა)
    const linked = (t: string) => t.includes(name) && /RS registration \|.*?Open registration \|.*?Not submitted/.test(t);
    await this.poll(async () => {
      biz = await this.ui.businessText();
      if (linked(biz)) return true;
      await this.ui.openBusiness(businessId);
      return undefined;
    }, 20_000);
    assertCondition(OP_UI_BIZ, linked(biz),
      'wallet ან რეგისტრაცია (Not submitted) ბიზნესის გვერდზე არ ჩანს', `Wallet clients: ${name}; RS registration: Not submitted (თავისით შეიქმნა)`, biz);

    const regId = await this.ui.openRegistrationFromBusiness();
    assertCondition(OP_UI_REG, (await this.ui.registrationStatus()) === 'Not submitted', `სტატუსი ${await this.ui.registrationStatus()}`, 'Not submitted', regId);
    const sent = await this.ui.submitToRs();
    assertCondition(OP_UI_REG, sent.includes(`"ownerIdentNumber": "${ident}"`) && sent.includes(`"ownerFullName": "${owner}"`),
      'Submit-ის ფანჯარაში გასაგზავნი მონაცემები არ ემთხვევა', `DATA TO SEND: ownerIdentNumber ${ident}, ownerFullName ${owner}`, sent);
    assertCondition(OP_UI_REG, await this.ui.toast('Submitted to RS'), 'toast "Submitted to RS" არ გამოჩნდა', 'toast "Submitted to RS"', null);
    await this.expectRegStatus(regId, 'Pending RS approval', TIMEOUT);

    await this.sim.approveTaxpayer(ident);
    await this.expectRegStatus(regId, 'Approved', 60_000);
    const enrolled = await this.poll(async () => {
      await this.ui.openRegistration(regId);
      return (await this.ui.tabCount('Wallets')) === 1 ? true : undefined;
    }, ENROLL_TIMEOUT, 10_000);
    assertCondition(OP_UI_REG, !!enrolled, 'Wallets ტაბზე 0 — wallet RS რეგისტრაციას არ მიება (KD-2608)', 'Wallets 1 (ბიზნესის wallet თავისით ებმის)', regId);
    await this.expectRegistrationTables({ ident, owner, businessId, regId, wallet: { ...w, name } });
    console.log(`✅ Business ${owner} (${ident}) created from UI — wallet linked, registration Approved`);
    return { ident, owner, businessId, regId, wallet: { ...w, name } };
  }

  /**
   * Approved-ის შემდეგ ცხრილები:
   *   რეგისტრაცია — სათაური Approved, Approved by Honest taxpayer; Data: Resident / სახელი / ident / თარიღები ("Sent to RS")
   *   Wallets — wallet / distributor-hub / CLIENT:<id> / Active
   *   ბიზნესის გვერდი — RS registration Approved, Wallet clients: wallet Active · Businesses სია — Clients 1
   */
  protected async expectRegistrationTables(ctx: Ctx) {
    await this.ui.openRegistration(ctx.regId);
    const head = await this.ui.pageText();
    const opDate = this.uiDate(date(30));
    const knownDate = this.uiDate(date(10));
    const need = [ctx.owner, 'Approved', 'Approved by | Honest taxpayer', 'Residency status | Resident', `Owner identification number | ${ctx.ident}`, `Operation date | ${opDate}`, `Known date | ${knownDate}`];
    const miss = need.filter((x) => !head.includes(x));
    assertCondition(OP_UI_REG, miss.length === 0, `აკლია: ${miss.join(' · ')}`, need.join(' · '), head.slice(0, 1500));

    await this.ui.openTab('Wallets');
    const rows = await this.ui.tabRows();
    const row = rows.find((r) => r.join(' ').includes(ctx.wallet.name)) || [];
    const line = row.join(' | ');
    assertCondition(OP_UI_REG, rows.length === 1 && line.includes('distributor-hub') && line.includes(`CLIENT:${ctx.wallet.clientId}`) && /Active/i.test(line),
      `Wallets: ${rows.map((r) => r.join(' | ')).join(' || ')}`, `1 მწკრივი: ${ctx.wallet.name} | distributor-hub | CLIENT:${ctx.wallet.clientId} | Active`, rows);

    await this.ui.openBusiness(ctx.businessId);
    const biz = await this.ui.businessText();
    assertCondition(OP_UI_BIZ, /RS registration \|.*?Open registration \|.*?Approved/.test(biz) && biz.includes(ctx.wallet.name) && biz.includes('Active'),
      'ბიზნესის გვერდზე Approved / wallet არ ჩანს', `RS registration: Approved; Wallet clients: ${ctx.wallet.name} Active`, biz);

    await this.ui.openBusinesses();
    await this.ui.searchBusinesses(ctx.ident);
    const list = await this.ui.businessRows();
    assertCondition(OP_UI_BIZ, list.length === 1 && list[0][1] === ctx.ident && list[0][3] === '1', `სია: ${list.map((r) => r.join(' / ')).join(' || ')}`,
      `${ctx.owner} / ${ctx.ident} / Resident / Clients 1`, list);
    console.log('✅ Registration tables OK — Data, Wallets, business page, list');
  }

  /** 2026-10-10 → "10 Oct 2026" */
  protected uiDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${String(d.getUTCDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
  }

  /** RS (სიმულატორი) აგზავნის ინკასოს (`priority`: 1 ძირითადი · 2 სანქცია · 3 საურავი) → accepted (code null) */
  protected async sendCollection(ctx: Ctx, amount: number, priority = 1): Promise<string> {
    const number = `QA-C-UI-${Date.now()}`;
    const res = await this.sim.collection(ctx.ident, amount, number, priority);
    const item = res?.items?.[0];
    assertCondition(OP_SIM, res?.accepted === true && item?.code === null, `code ${item?.code}: ${item?.description}`, 'accepted, code null (მიღებულია)', res?.items);
    console.log(`✅ Collection ${amount} ₾ priority ${priority} sent by RS (${number})`);
    return number;
  }

  /** UI: რეგისტრაცია → Liens & collections → მწკრივი + ფანჯრის Overview (poll — hold ასინქრონულად ჩნდება) */
  protected async expectOverview(ctx: Ctx, number: string, exp: { status: string; requested: number; restricted: number; remaining: number; executed?: number }): Promise<RestrictionOverview> {
    let last: RestrictionOverview | undefined;
    const ok = await this.poll(async () => {
      await this.ui.openRegistration(ctx.regId, 'restrictions');
      // ყადაღა / ინკასო ახლახან მოვიდა — სია შეიძლება მის შენახვამდე ჩაიტვირთა → მწკრივი არ ჩანს → თავიდან ჩატვირთვა
      const opened = await this.ui.openRestriction(number, 6_000).then(() => true, () => false);
      if (!opened) return undefined;
      last = await this.ui.restrictionOverview();
      const match = last.status === exp.status && last.requested === exp.requested && last.restricted === round(exp.restricted)
        && last.remaining === round(exp.remaining) && (exp.executed === undefined || last.executed === exp.executed);
      if (!match) await this.ui.closeModal();
      return match ? last : undefined;
    }, TIMEOUT, 3000);
    assertCondition(OP_UI_MODAL, !!ok,
      `${last?.status} · requested ${last?.requested} · restricted ${last?.restricted} · remaining ${last?.remaining} · executed ${last?.executed}`,
      `${exp.status} · requested ${exp.requested} · restricted ${exp.restricted} · remaining ${exp.remaining} · executed ${exp.executed}`, last);
    return last!;
  }

  protected async expectRegStatus(regId: string, status: string, timeout: number) {
    let last = '';
    const ok = await this.poll(async () => {
      await this.ui.openRegistration(regId);
      last = await this.ui.registrationStatus();
      return last === status ? true : undefined;
    }, timeout, 3000);
    assertCondition(OP_UI_REG, !!ok, `სტატუსი ${last}`, status, regId);
  }

  /** API: wallet-ის ბალანსი / held */
  protected async expectWallet(ctx: Ctx, amount: number, held: number, why: string) {
    let last: any;
    const ok = await this.poll(async () => {
      const client = RsHubApi.expectOk(OP_CLIENT, await this.api.getClient(ctx.wallet.clientId));
      last = (client.balances || []).find((b: any) => b.currency === 'GEL') || { amount: 0, held: 0 };
      return round(last.amount) === round(amount) && round(last.held) === round(held) ? true : undefined;
    });
    assertCondition(OP_CLIENT, !!ok, `ბალანსი ${last?.amount} / held ${last?.held}`, `ბალანსი ${amount} / held ${held} — ${why}`, last);
  }

  protected async expectApiStatus(number: string, status: string, restricted: number) {
    let last: any;
    const ok = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_RESTRICTION, await this.api.getRestrictions({ rsNumber: number })).content[0];
      return last?.status === status && round(last.restrictedAmount) === round(restricted) ? true : undefined;
    });
    assertCondition(OP_RESTRICTION, !!ok, `status ${last?.status}, restricted ${last?.restrictedAmount}`, `status ${status}, restricted ${restricted}`, last);
  }

  /** ტესტის ბოლოს: ინკასო თუ ჯერ აქტიურია → RS ხსნის (wallet-ზე ფული არ დარჩეს გაყინული) */
  protected async cleanup(number: string) {
    const x = (await this.api.getRestrictions({ rsNumber: number })).value?.content?.[0];
    if (x && !['RETURNED', 'WITHDRAWN', 'EXECUTED'].includes(x.status)) await this.sim.obtainCollection(number);
  }

  protected guard(...amounts: number[]) {
    assertCondition('ტესტის კონფიგი', amounts.every((a) => a > 0 && a <= MAX_AMOUNT),
      `თანხა: ${amounts.join(', ')}`, `0 < თანხა ≤ ${MAX_AMOUNT} ₾ (hub STANDARD — რეალური ფული)`, amounts);
  }

  protected async poll<T>(fn: () => Promise<T | undefined>, timeout = TIMEOUT, every = 2000): Promise<T | undefined> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const v = await fn();
      if (v !== undefined) return v;
      await sleep(every);
    }
    return undefined;
  }
}
