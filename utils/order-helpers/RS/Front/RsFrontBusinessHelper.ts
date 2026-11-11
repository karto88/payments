import { APIRequestContext, Page } from '@playwright/test';
import { RsAdminUiPage, BusinessForm } from '../../../../pages/RsAdminUiPage';
import { RsHubApi, date, digits, randomCompanyName, Residency } from '../RsHubApi';
import { RsClientHelper } from '../RsClientHelper';
import { assertCondition } from '../../../assertions';

const OP_LIST = 'UI Dist. Businesses — სია';
const OP_CREATE = 'UI Dist. Businesses — Create business';
const OP_DETAILS = 'UI Dist. Businesses — ბიზნესის გვერდი';
const OP_SEARCH = 'UI Dist. Businesses — ძებნა';
const OP_FILTER = 'UI Dist. Businesses — Business filters';
const OP_FREE = 'UI Dist. Businesses — Clients without business';
const OP_API_BIZ = 'GET /api/distributor-hub-business/{id}';
const OP_API_CLIENT = 'GET /api/distributor-hub-client/{id}';

/** Foreign-ის მისამართები (Create business-ზე სავალდებულოა) */
const FOREIGN_ADDRESS = {
  legalAddressCountry: 'Germany', legalAddressCity: 'Berlin QA', legalAddressLine: 'Teststrasse 1',
  actualAddressCountry: 'Germany', actualAddressCity: 'Berlin QA', actualAddressLine: 'Teststrasse 1',
};
/** ცარიელ ფორმაზე Create → წითლად მოსანიშნი ველები (UI-ის ვალიდაცია) */
const REQUIRED: Record<Residency, string[]> = {
  RESIDENT: ['ownerFullName', 'identNumber', 'operDate', 'knownDate'],
  FOREIGN: ['ownerFullName', 'operDate', 'legalAddressCountry', 'legalAddressCity', 'legalAddressLine', 'actualAddressCountry', 'actualAddressCity', 'actualAddressLine'],
};
const LABEL: Record<Residency, string> = { RESIDENT: 'Resident', FOREIGN: 'Foreign' };

/**
 * RS ფრონტი — Distributor Hub → Businesses (KD-2559): შექმნა (Resident / Foreign), სია, ძებნა, ფილტრი, Clients without business.
 *   📋 UI-ში მოქმედება → შემოწმება UI-ში (სია / ბიზნესის გვერდი) + API-ში (რა შეინახა)
 */
export class RsFrontBusinessHelper {
  private ui: RsAdminUiPage;
  private api: RsHubApi;

  constructor(page: Page, request: APIRequestContext) {
    this.ui = new RsAdminUiPage(page);
    this.api = new RsHubApi(request);
  }

  /** UI: Create business → toast → ბიზნესის გვერდი (მონაცემები) → API-ში შენახულია → სიაში პირველია */
  async createBusiness(residency: Residency) {
    await this.ui.login();
    const form = this.form(residency);
    const id = await this.ui.createBusiness(form);
    assertCondition(OP_CREATE, await this.ui.toast('Business created'), 'toast "Business created" არ გამოჩნდა', 'toast "Business created"', id);

    // ბიზნესის გვერდი — RS პანელი (10.11-დან): Register ღილაკი აღარ არის, რეგისტრაცია wallet-ის მიბმისას იქმნება
    const NOT_REGISTERED = 'Not registered with RS yet. Link a wallet client and its draft appears here.';
    const page = await this.waitBusinessText(id, (t) => t.includes(NOT_REGISTERED));
    assertCondition(OP_DETAILS, page.includes(form.ownerFullName) && page.includes(`Residency status | ${LABEL[residency]}`) && page.includes(form.identNumber!),
      'ბიზნესის გვერდზე მონაცემები არ ემთხვევა', `${form.ownerFullName} · ${LABEL[residency]} · ${form.identNumber}`, page);
    assertCondition(OP_DETAILS, page.includes(NOT_REGISTERED) && page.includes('No clients linked') && !/\| Register to RS \|/.test(page),
      'ახალ ბიზნესზე RS პანელის ტექსტი / "No clients linked" არ ჩანს (ან ისევ ჩანს Register to RS)',
      `RS registration: "${NOT_REGISTERED}", Register ღილაკის გარეშე; Wallet clients: No clients linked`, page);

    // API: რა შეინახა
    const saved = RsHubApi.expectOk(OP_API_BIZ, await this.api.getBusiness(id));
    const expected: Record<string, any> = { residency, ownerFullName: form.ownerFullName, identificationNumber: form.identNumber, operDate: form.operDate };
    if (residency === 'RESIDENT') expected.knownDate = form.knownDate;
    else Object.assign(expected, FOREIGN_ADDRESS);
    const diff = Object.entries(expected).filter(([k, v]) => saved[k] !== v).map(([k, v]) => `${k}: ${saved[k]} ≠ ${v}`);
    assertCondition(OP_API_BIZ, diff.length === 0, `არ ემთხვევა: ${diff.join(', ')}`, 'UI-ში შეყვანილი ყველა ველი შენახულია', saved);

    // სია: ახალი ბიზნესი პირველია
    await this.ui.openBusinesses();
    const first = (await this.ui.businessRows())[0] || [];
    assertCondition(OP_LIST, first[0] === form.ownerFullName && first[1] === form.identNumber && first[2] === LABEL[residency] && first[3] === '0',
      `პირველი მწკრივი: ${first.join(' / ')}`, `${form.ownerFullName} / ${form.identNumber} / ${LABEL[residency]} / 0 კლიენტი`, first);
    console.log(`✅ UI: ${LABEL[residency]} business ${form.ownerFullName} (${form.identNumber}) created — first in list`);
  }

  /** UI: ცარიელი ფორმა → Create → უარი, წითლად მონიშნულია სავალდებულო ველები, ბიზნესი არ იქმნება */
  async requiredFields(residency: Residency) {
    await this.ui.login();
    await this.ui.openBusinesses();
    await this.ui.page.getByRole('button', { name: 'Create business' }).click();
    if (residency === 'FOREIGN') await this.ui.fillBusinessForm({ residency });
    const invalid = await this.ui.submitBusinessFormInvalid();
    const missing = REQUIRED[residency].filter((f) => !invalid.includes(f));
    const extra = invalid.filter((f) => !REQUIRED[residency].includes(f));
    assertCondition(OP_CREATE, missing.length === 0 && extra.length === 0,
      `წითელი ველები: ${invalid.join(', ')}${missing.length ? ` · აკლია: ${missing.join(', ')}` : ''}${extra.length ? ` · ზედმეტი: ${extra.join(', ')}` : ''}`,
      `${LABEL[residency]}: სავალდებულოა ${REQUIRED[residency].join(', ')}`, invalid);
    assertCondition(OP_CREATE, !/distribution-hub-businesses\/[0-9a-f-]{36}/.test(this.ui.page.url()), 'ბიზნესი შეიქმნა', 'ფანჯარა ღიაა, ბიზნესი არ შეიქმნა', this.ui.page.url());
    console.log(`✅ UI: ${LABEL[residency]} empty form rejected — required: ${invalid.join(', ')}`);
  }

  /** UI: ძებნა ident-ით → მხოლოდ ეს ბიზნესი */
  async searchByIdent() {
    const biz = await this.apiBusiness('RESIDENT');
    await this.ui.login();
    await this.ui.openBusinesses();
    await this.ui.searchBusinesses(biz.identificationNumber);
    const rows = await this.ui.businessRows();
    assertCondition(OP_SEARCH, rows.length === 1 && rows[0][1] === biz.identificationNumber && rows[0][0] === biz.ownerFullName,
      `${rows.length} მწკრივი: ${rows.map((r) => r.slice(0, 2).join(' ')).join(' | ')}`, `ზუსტად 1: ${biz.ownerFullName} ${biz.identificationNumber}`, rows);
    console.log(`✅ UI: search ${biz.identificationNumber} → 1 business`);
  }

  /** UI: ფილტრი Owner-ით → ყველა მწკრივი ამ სახელისაა, ჩვენი ბიზნესიც ჩანს */
  async filterByOwner() {
    const biz = await this.apiBusiness('RESIDENT');
    await this.ui.login();
    await this.ui.openBusinesses();
    await this.ui.filterBusinesses({ owner: biz.ownerFullName });
    const rows = await this.ui.businessRows();
    const wrong = rows.filter((r) => !r[0].toLowerCase().includes(biz.ownerFullName.toLowerCase()));
    assertCondition(OP_FILTER, rows.some((r) => r[1] === biz.identificationNumber) && wrong.length === 0,
      `${rows.length} მწკრივი, სხვა სახელით: ${wrong.map((r) => r[0]).join(', ') || '-'}`, `მხოლოდ "${biz.ownerFullName}" (ჩვენი ${biz.identificationNumber} ჩანს)`, rows);
    console.log(`✅ UI: filter Owner "${biz.ownerFullName}" → ${rows.length} row(s)`);
  }

  /** UI: ფილტრი Residency-ით → ყველა მწკრივი ამ ტიპისაა */
  async filterByResidency(residency: Residency) {
    await this.apiBusiness(residency);
    await this.ui.login();
    await this.ui.openBusinesses();
    await this.ui.filterBusinesses({ residency: LABEL[residency] as 'Resident' | 'Foreign' });
    const rows = await this.ui.businessRows();
    const wrong = rows.filter((r) => r[2] !== LABEL[residency]);
    assertCondition(OP_FILTER, rows.length > 0 && wrong.length === 0,
      `${rows.length} მწკრივი, სხვა ტიპის: ${wrong.map((r) => `${r[0]} (${r[2]})`).join(', ') || '-'}`, `ყველა მწკრივი ${LABEL[residency]}`, rows);
    console.log(`✅ UI: filter Residency ${LABEL[residency]} → ${rows.length} row(s), all ${LABEL[residency]}`);
  }

  /** API: wallet ბიზნესის გარეშე → UI: "Clients without business" ტაბში ჩანს (სახელი, id, Active), რიცხვი +1 */
  async clientWithoutBusinessListed() {
    await this.ui.login();
    await this.ui.openBusinesses('without-business');
    const before = await this.ui.clientsWithoutBusinessCount();
    const client = await this.apiWallet();
    await this.ui.openBusinesses('without-business');
    const row = await this.ui.clientWithoutBusiness(client.clientId);
    assertCondition(OP_FREE, !!row && row[0] === client.clientName && row[2] === 'Active',
      row ? `მწკრივი: ${row.join(' / ')}` : 'კლიენტი ტაბში არ ჩანს', `${client.clientName} / ${client.clientId} / Active / Create business`, row);
    const after = await this.ui.clientsWithoutBusinessCount();
    assertCondition(OP_FREE, after === before + 1, `რიცხვი ${before} → ${after}`, `რიცხვი ${before} → ${before + 1}`, { before, after });
    console.log(`✅ UI: wallet ${client.clientName} listed in Clients without business (${before} → ${after})`);
  }

  /**
   * UI: "Clients without business" → კლიენტის მწკრივიდან Create business → ბანერი (კლიენტი მიება), Operation date = კლიენტის შექმნის თარიღი
   *   → Create → ბიზნესის გვერდზე wallet მიბმულია (რეგისტრაცია Not submitted), ტაბიდან ქრება, რიცხვი −1
   */
  async createBusinessFromClient() {
    const client = await this.apiWallet();
    await this.ui.login();
    await this.ui.openBusinesses('without-business');
    const before = await this.ui.clientsWithoutBusinessCount();
    const modal = await this.ui.openCreateBusinessForClient(client.clientId);
    const banner = `The Wallet client ${client.clientName} will be linked to the new business`;
    assertCondition(OP_FREE, modal.text.includes(banner), 'ბანერი არ ჩანს', banner, modal.text);
    const created = String(client.createdAt).slice(0, 10);
    assertCondition(OP_FREE, modal.operDate === created, `Operation date ${modal.operDate}`, `Operation date = კლიენტის შექმნის თარიღი ${created}`, modal);

    const form = this.form('RESIDENT');
    await this.ui.fillBusinessForm({ ownerFullName: form.ownerFullName, identNumber: form.identNumber, knownDate: form.knownDate });
    await this.ui.submitBusinessFormStay();
    assertCondition(OP_CREATE, await this.ui.toast('Business created'), 'toast "Business created" არ გამოჩნდა', 'toast "Business created"', form);

    // API: კლიენტი ახალ ბიზნესზეა მიბმული → ბიზნესის გვერდი
    const saved = RsHubApi.expectOk(OP_API_CLIENT, await this.api.getClient(client.clientId));
    assertCondition(OP_API_CLIENT, !!saved.businessId, 'businessId = null', 'კლიენტი ახალ ბიზნესზეა მიბმული (businessId)', saved);
    const id = saved.businessId as string;
    const biz = RsHubApi.expectOk(OP_API_BIZ, await this.api.getBusiness(id));
    assertCondition(OP_API_BIZ, biz.ownerFullName === form.ownerFullName && biz.identificationNumber === form.identNumber && biz.operDate === created,
      `${biz.ownerFullName} / ${biz.identificationNumber} / ${biz.operDate}`, `${form.ownerFullName} / ${form.identNumber} / ${created}`, biz);
    await this.ui.openBusiness(id);

    const page = await this.waitBusinessText(id, (t) => t.includes(client.clientName));
    assertCondition(OP_DETAILS, page.includes(client.clientName) && page.includes(`Operation date | ${this.uiDate(created)}`),
      'ბიზნესის გვერდზე wallet / Operation date არ ჩანს', `Wallet clients: ${client.clientName}; Operation date ${this.uiDate(created)}`, page);
    assertCondition(OP_DETAILS, /RS registration \|.*?Open registration \|.*?Not submitted/.test(page),
      'RS რეგისტრაცია თავისით არ შეიქმნა', 'RS registration: Not submitted (wallet-ის მიბმისას თავისით)', page);

    await this.ui.openBusinesses('without-business');
    const row = await this.ui.clientWithoutBusiness(client.clientId);
    const after = await this.ui.clientsWithoutBusinessCount();
    assertCondition(OP_FREE, !row && after === before - 1, `${row ? 'კლიენტი ისევ ჩანს' : 'კლიენტი აღარ ჩანს'}, რიცხვი ${before} → ${after}`,
      `კლიენტი ტაბიდან ქრება, რიცხვი ${before} → ${before - 1}`, { row, before, after });
    console.log(`✅ UI: business ${form.ownerFullName} created from client ${client.clientName} — linked, left the free list`);
  }

  // ─── მონაცემები ───

  private form(residency: Residency): BusinessForm {
    const base = { residency, ownerFullName: randomCompanyName(), operDate: date(30) };
    return residency === 'RESIDENT'
      ? { ...base, identNumber: `9${digits(8)}`, knownDate: date(10) }
      : { ...base, identNumber: `QA-FRN-${digits(8)}`, ...FOREIGN_ADDRESS };
  }

  /** API: ბიზნესი (ძებნის / ფილტრის ტესტებისთვის) */
  private async apiBusiness(residency: Residency): Promise<any> {
    const f = this.form(residency);
    const body: any = { residency, ownerFullName: f.ownerFullName, identificationNumber: f.identNumber, operDate: f.operDate };
    if (residency === 'RESIDENT') body.knownDate = f.knownDate; else Object.assign(body, FOREIGN_ADDRESS);
    return RsHubApi.expectOk('POST /api/distributor-hub-business', await this.api.createBusiness(body));
  }

  /** API: WALLET კლიენტი ბიზნესის გარეშე → { clientId, clientName, createdAt } */
  private async apiWallet(): Promise<{ clientId: string; clientName: string; createdAt: string }> {
    const body = RsClientHelper.buildBody('WALLET', undefined, { clientName: `${randomCompanyName()} ${digits(4)}` });
    const created = RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(body));
    const client = RsHubApi.expectOk(OP_API_CLIENT, await this.api.getClient(created.clientId));
    return { clientId: created.clientId, clientName: body.clientName, createdAt: client.createdAt };
  }

  private async waitBusinessText(id: string, ok: (t: string) => boolean): Promise<string> {
    let text = '';
    for (let i = 0; i < 6; i++) {
      text = await this.ui.businessText();
      if (ok(text)) break;
      await this.ui.openBusiness(id);
    }
    return text;
  }

  /** 2026-11-05 → "05 Nov 2026" (ბიზნესის გვერდის ფორმატი) */
  private uiDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${String(d.getUTCDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
  }
}
