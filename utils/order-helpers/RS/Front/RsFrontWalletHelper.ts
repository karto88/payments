import { APIRequestContext, Page } from '@playwright/test';
import { RsAdminUiPage } from '../../../../pages/RsAdminUiPage';
import { RsHubApi, digits } from '../RsHubApi';
import { RsBusinessHelper } from '../RsBusinessHelper';
import { RsClientHelper } from '../RsClientHelper';
import { assertCondition } from '../../../assertions';

const OP_CREATE = 'UI Dist. Integrators — New Integrator (Wallet)';
const OP_LIST = 'UI Dist. Integrators — სია';
const OP_FREE = 'UI Dist. Businesses — Clients without business';
const OP_BIZ = 'UI Dist. Businesses — ბიზნესის გვერდი';
const OP_API = 'GET /api/distributor-hub-client/{id}';

/** ცარიელ ფორმაზე მოსალოდნელი შეცდომები (Scheme = Wallet) — ფორმა ყველა ვალუტის კონფიგს ითხოვს */
const REQUIRED_MESSAGES = ['Name is required', 'Distribution method is required', 'Distribution Strategy is required',
  'Min transaction amount is required', 'Max transaction amount is required', 'Commission rate type is required', 'Commission is required'];

/**
 * RS ფრონტი — WALLET კლიენტი (Distributor Hub → Dist. Integrators, KD-2559 / KD-2610).
 *   📋 UI-ში მოქმედება → შემოწმება UI-ში (სია, Clients without business, ბიზნესის გვერდი) + API-ში (რა შეინახა)
 *   📋 ჩვენი wallet-ები სატესტოა (For testing = isMock) → სიაში ჩანს მხოლოდ "Show Test Integrators"-ით, "Test" ნიშნით
 */
export class RsFrontWalletHelper {
  private ui: RsAdminUiPage;
  private api: RsHubApi;

  constructor(page: Page, request: APIRequestContext) {
    this.ui = new RsAdminUiPage(page);
    this.api = new RsHubApi(request);
  }

  /** UI: wallet ბიზნესის გარეშე → toast → სიაში მწკრივი (Test, Wallet, Activated, IBAN, STANDARD, GEL, ₾ 0) → API → Clients without business */
  async createWallet() {
    const name = `QA UI Wallet ${digits(6)}`;
    await this.ui.login();
    const ids = await this.ui.createWalletClient(name);
    assertCondition(OP_CREATE, await this.ui.toast('Integrator was created successfully'), 'toast არ გამოჩნდა', 'toast "Integrator was created successfully!"', name);

    const row = await this.listRow(name, true);
    assertCondition(OP_LIST, row[1] === 'Wallet' && row[2] === 'Activated' && row[3] === ids.clientId && row[4] === 'IBAN' && row[5] === 'STANDARD' && row[6] === 'GEL' && row[7].startsWith('₾ 0'),
      `მწკრივი: ${row.join(' | ')}`, `${name} | Wallet | Activated | ${ids.clientId} | IBAN | STANDARD | GEL | ₾ 0 …`, row);
    assertCondition(OP_LIST, await this.ui.integratorHasTestChip(name), '"Test" ნიშანი არ არის', 'მწკრივზე "Test" ნიშანი (For testing)', row);

    await this.expectApi(ids.clientId, { clientName: name, scheme: 'WALLET', distributeMethod: 'IBAN', distributionStrategy: 'STANDARD', isMock: true, businessId: null });

    await this.ui.openBusinesses('without-business');
    const free = await this.ui.clientWithoutBusiness(ids.clientId);
    assertCondition(OP_FREE, !!free && free[0] === name && free[2] === 'Active', free ? free.join(' | ') : 'არ ჩანს', `${name} | ${ids.clientId} | Active`, free);
    console.log(`✅ UI: wallet ${name} created — list, API, Clients without business OK`);
  }

  /** UI: wallet-ის შექმნისას Business არჩეულია → სიაში "Wallet · <ბიზნესი>" → ბიზნესის გვერდზე Wallet clients-ში ჩანს → API businessId */
  async createWalletOnBusiness() {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
      await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const name = `QA UI Wallet ${digits(6)}`;
    await this.ui.login();
    const ids = await this.ui.createWalletClient(name, business.ownerFullName);
    assertCondition(OP_CREATE, await this.ui.toast('Integrator was created successfully'), 'toast არ გამოჩნდა', 'toast "Integrator was created successfully!"', name);

    const row = await this.listRow(name, true);
    assertCondition(OP_LIST, row[1] === `Wallet · ${business.ownerFullName}`, `Scheme: ${row[1]}`, `Scheme "Wallet · ${business.ownerFullName}"`, row);
    await this.expectApi(ids.clientId, { clientName: name, scheme: 'WALLET', businessId: business.id });

    await this.ui.openBusiness(business.id);
    const page = await this.ui.businessText();
    assertCondition(OP_BIZ, page.includes(name) && page.includes('Active'), 'ბიზნესის გვერდზე wallet არ ჩანს', `Wallet clients: ${name} Active`, page);
    await this.ui.openBusinesses('without-business');
    assertCondition(OP_FREE, !(await this.ui.clientWithoutBusiness(ids.clientId)), 'wallet ბიზნესის გარეშე სიაშია', 'ბიზნესზე მიბმული wallet "Clients without business"-ში არ ჩანს', ids);
    console.log(`✅ UI: wallet ${name} created on business ${business.ownerFullName}`);
  }

  /** ფილტრი: სატესტო wallet "Show Test Integrators"-ის გარეშე არ ჩანს ("No Items"); ჩართვით — ჩანს "Test" ნიშნით */
  async testFilter() {
    const body = RsClientHelper.buildBody('WALLET', undefined, { clientName: `QA UI Wallet ${digits(6)}` });
    RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(body));
    await this.ui.login();
    const hidden = await this.ui.findIntegrators(body.clientName, false);
    assertCondition(OP_LIST, !hidden.some((r) => r[0].includes(body.clientName)), `ჩანს: ${hidden.map((r) => r[0]).join(', ')}`,
      `"Show Test Integrators" გამორთულია → სატესტო ${body.clientName} არ ჩანს`, hidden);
    const shown = await this.ui.findIntegrators(body.clientName, true);
    assertCondition(OP_LIST, shown.length === 1 && shown[0][0].includes(body.clientName) && await this.ui.integratorHasTestChip(body.clientName),
      `მწკრივები: ${shown.map((r) => r[0]).join(', ')}`, `"Show Test Integrators" ჩართულია → 1 მწკრივი ${body.clientName}, "Test" ნიშნით`, shown);
    console.log(`✅ UI: test filter — hidden without, shown with "Show Test Integrators"`);
  }

  /** ❌ ცარიელი ფორმა (Scheme Wallet) → Create → სავალდებულო ველების შეცდომები, wallet არ იქმნება */
  async emptyFormRejected() {
    await this.ui.login();
    const r = await this.ui.submitEmptyWalletForm();
    const missing = REQUIRED_MESSAGES.filter((m) => !r.messages.includes(m));
    assertCondition(OP_CREATE, missing.length === 0 && r.invalid.includes('clientName'), `შეცდომები: ${r.messages.join(' · ')}${missing.length ? ` · აკლია: ${missing.join(', ')}` : ''}`,
      REQUIRED_MESSAGES.join(' · '), r);
    assertCondition(OP_CREATE, /\/create$/.test(this.ui.page.url()), 'ფორმა დაიხურა', 'ფორმა ღიაა — wallet არ შეიქმნა', this.ui.page.url());
    console.log(`✅ UI: empty wallet form rejected — ${r.invalid.length} invalid fields`);
  }

  // ─── შემოწმებები ───

  private async listRow(name: string, showTest: boolean): Promise<string[]> {
    const rows = await this.ui.findIntegrators(name, showTest);
    const row = rows.find((r) => r[0].includes(name));
    assertCondition(OP_LIST, !!row, `ძებნის შედეგი: ${rows.map((r) => r[0]).join(', ') || 'ცარიელი'}`, `${name} სიაში ჩანს`, rows);
    return row!;
  }

  private async expectApi(clientId: string, exp: Record<string, any>) {
    const c = RsHubApi.expectOk(OP_API, await this.api.getClient(clientId));
    const diff = Object.entries(exp).filter(([k, v]) => (c[k] ?? null) !== v).map(([k, v]) => `${k}: ${c[k]} ≠ ${v}`);
    assertCondition(OP_API, diff.length === 0, `არ ემთხვევა: ${diff.join(', ')}`, 'UI-ში შეყვანილი ყველა ველი შენახულია', c);
  }
}
