import { APIRequestContext } from '@playwright/test';
import { RsHubApi, ApiResult, Residency } from '../RsHubApi';
import { RsBusinessHelper } from '../RsBusinessHelper';
import { RsClientHelper, gel } from '../RsClientHelper';
import { assertCondition } from '../../../assertions';

const BIZ = '/api/distributor-hub-business';
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** მოსალოდნელი უარი: HTTP სტატუსი + Keepz statusCode (თუ docs-შია) + errors[]-ში ველის სახელი */
export interface Rejection {
  http: number;
  code?: number;
  field?: string;
}

export type BusinessUpdateCase = 'staleVersion' | 'noVersion' | 'unknownBusiness' | 'invalidIdent';
export type LinkCase = 'systemOperator' | 'emptyList' | 'nullId' | 'unknownClient' | 'unknownBusiness' | 'otherBusiness';
export type UnlinkCase = 'notInBusiness' | 'unknownBusiness';
export type ClientUpdateCase = 'changeScheme' | 'otherBusiness' | 'noStatus' | 'unknownClient' | 'percentOver100';

/**
 * RS — Distributor Hub business / client ნეგატიური ქეისები (ზღვრული მნიშვნელობები, ეკვივალენტური კლასები).
 *   ყოველი ქეისი: არავალიდური request → მოსალოდნელი HTTP + code (+ errors[] ველი) → არაფერი შეინახა.
 *   reuse: RsBusinessHelper.buildBody / RsClientHelper.buildBody (ვალიდური body) — იცვლება მხოლოდ შესამოწმებელი ველი.
 *   ველი undefined → body-დან ამოიშლება ("აკლია" ქეისი).
 */
export class RsNegativeHelper {
  private api: RsHubApi;
  private biz: RsBusinessHelper;
  private client: RsClientHelper;

  constructor(request: APIRequestContext) {
    this.api = new RsHubApi(request);
    this.biz = new RsBusinessHelper(request);
    this.client = new RsClientHelper(request);
  }

  // ─── Business ───

  /** POST business არავალიდური ველ(ებ)ით → უარი + ბიზნესი არ შეიქმნა (name ფილტრით) */
  async createBusinessRejected(residency: Residency, fields: Record<string, any>, expect: Rejection) {
    const body = this.apply(RsBusinessHelper.buildBody({ residency }), fields);
    const op = `POST ${BIZ} (${residency}: ${this.describe(fields)})`;
    this.expectRejected(op, await this.api.createBusiness(body), expect);
    await this.expectBusinessNotSaved(op, body.ownerFullName);
  }

  /** უკვე დაკავებული identificationNumber — შექმნისას ან სხვა ბიზნესის რედაქტირებისას → 409 / 1481 */
  async duplicateIdentRejected(on: 'create' | 'update') {
    const existing = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const op = `${on === 'create' ? 'POST' : 'PUT'} ${BIZ} (identificationNumber დაკავებულია: ${existing.identificationNumber})`;
    const expect = { http: 409, code: 1481, field: 'identificationNumber' };

    if (on === 'create') {
      const body = { ...RsBusinessHelper.buildBody({ residency: 'RESIDENT' }), identificationNumber: existing.identificationNumber };
      this.expectRejected(op, await this.api.createBusiness(body), expect);
      await this.expectBusinessNotSaved(op, body.ownerFullName);
    } else {
      const other = await this.biz.createBusiness({ residency: 'RESIDENT' });
      const res = await this.api.updateBusiness(other.id, { ...this.updateBody(other), identificationNumber: existing.identificationNumber });
      this.expectRejected(op, res, expect);
      await this.expectBusinessUnchanged(op, other);
    }
  }

  /** PUT business: ძველი version / version-ის გარეშე / არარსებული id / არავალიდური ident */
  async updateBusinessRejected(edit: BusinessUpdateCase, expect: Rejection) {
    const biz = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const body = this.updateBody(biz);
    const op = `PUT ${BIZ}/{id} (${edit})`;
    let id = biz.id;

    if (edit === 'staleVersion') {
      // პირველი რედაქტირება ზრდის version-ს 0 → 1; მეორე იგივე version 0-ით უნდა უარყოს
      RsHubApi.expectOk(`${op} — პირველი რედაქტირება`, await this.api.updateBusiness(id, { ...body, ownerFullName: `${biz.ownerFullName} v1` }));
      body.ownerFullName = `${biz.ownerFullName} stale`;
    }
    if (edit === 'noVersion') delete body.version;
    if (edit === 'unknownBusiness') id = NO_ID;
    if (edit === 'invalidIdent') body.identificationNumber = '12345678';

    this.expectRejected(op, await this.api.updateBusiness(id, body), expect);

    if (edit === 'unknownBusiness') return;
    // უარყოფილი ცვლილება არ შეინახა: staleVersion — რჩება პირველი რედაქტირება (v1, version 1); დანარჩენი — version 0
    const after = RsHubApi.expectOk(`GET ${BIZ}/{id}`, await this.api.getBusiness(biz.id));
    const expected = edit === 'staleVersion'
      ? { ownerFullName: `${biz.ownerFullName} v1`, version: 1 }
      : { ownerFullName: biz.ownerFullName, version: 0 };
    assertCondition(op, after.ownerFullName === expected.ownerFullName && after.version === expected.version
      && after.identificationNumber === biz.identificationNumber,
      `შეინახა: ownerFullName "${after.ownerFullName}", version ${after.version}, ident ${after.identificationNumber}`,
      `უცვლელი: ownerFullName "${expected.ownerFullName}", version ${expected.version}, ident ${biz.identificationNumber}`, after);
  }

  /** GET business: არარსებული id → 404 / 1479, არავალიდური uuid → 400 / 1002 */
  async getBusinessRejected(id: string, expect: Rejection) {
    this.expectRejected(`GET ${BIZ}/${id}`, await this.api.getBusiness(id), expect);
  }

  /** GET business/filter არავალიდური query-ით */
  async filterBusinessesRejected(params: Record<string, any>, expect: Rejection) {
    this.expectRejected(`GET ${BIZ}/filter (${this.describe(params)})`, await this.api.filterBusinesses(params), expect);
  }

  // ─── Client ───

  /** POST client არავალიდური ველ(ებ)ით → უარი + კლიენტი არ შეიქმნა. withBusiness — body-ში რეალური businessId */
  async createClientRejected(fields: Record<string, any>, expect: Rejection, opts: { withBusiness?: boolean } = {}) {
    const business = opts.withBusiness ? await this.biz.createBusiness({ residency: 'RESIDENT' }) : undefined;
    const body = this.apply(RsClientHelper.buildBody('WALLET', business?.id), fields);
    const op = `POST /api/distributor-hub-client (${this.describe(fields)})`;
    this.expectRejected(op, await this.api.createClient(body), expect);
    await this.expectClientNotSaved(op, body.clientName);
  }

  /** დაკავებული clientName — შექმნისას ან სხვა კლიენტის რედაქტირებისას → 400 / 1186 */
  async duplicateClientNameRejected(on: 'create' | 'update') {
    const existing = RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(RsClientHelper.buildBody('WALLET')));
    const name = (await this.api.getClient(existing.clientId)).value.clientName;
    const op = `${on === 'create' ? 'POST' : 'POST (update)'} /api/distributor-hub-client (clientName დაკავებულია: ${name})`;

    if (on === 'create') {
      this.expectRejected(op, await this.api.createClient({ ...RsClientHelper.buildBody('WALLET'), clientName: name }), { http: 400, code: 1186 });
    } else {
      const other = await this.newClient();
      const res = await this.api.createClient({ ...other.body, clientName: name, integratorId: other.clientId });
      this.expectRejected(op, res, { http: 400, code: 1186 });
      const after = (await this.api.getClient(other.clientId)).value;
      assertCondition(op, after.clientName === other.body.clientName, 'სახელი მაინც შეიცვალა', 'სახელი უცვლელია', after);
    }
  }

  /** POST business/{id}/clients — მიბმის ნეგატიურები */
  async linkRejected(edit: LinkCase, expect: Rejection) {
    const business = await this.biz.createBusiness({ residency: 'RESIDENT' });
    let businessId = business.id;
    let clientIds: any[];

    if (edit === 'systemOperator') clientIds = [(await this.newClient('SYSTEM_OPERATOR')).clientId];
    else if (edit === 'emptyList') clientIds = [];
    else if (edit === 'nullId') clientIds = [null];
    else if (edit === 'unknownClient') clientIds = [NO_ID];
    else if (edit === 'unknownBusiness') { businessId = NO_ID; clientIds = [(await this.newClient()).clientId]; }
    else {
      // otherBusiness — კლიენტი უკვე სხვა ბიზნესზეა
      const first = await this.biz.createBusiness({ residency: 'RESIDENT' });
      clientIds = [(await this.newClient('WALLET', first.id)).clientId];
    }

    const op = `POST ${BIZ}/{id}/clients (${edit})`;
    this.expectRejected(op, await this.api.linkClients(businessId, clientIds), expect);

    const after = RsHubApi.expectOk(`GET ${BIZ}/{id}`, await this.api.getBusiness(business.id));
    assertCondition(op, (after.clients || []).length === 0, `ბიზნესს მაინც მიება ${after.clients.length} კლიენტი`,
      'ბიზნესს კლიენტი არ მიება', after);
  }

  /** DELETE business/{id}/clients/{clientId} — მოხსნის ნეგატიურები */
  async unlinkRejected(edit: UnlinkCase, expect: Rejection) {
    const business = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const other = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const { clientId } = await this.newClient('WALLET', business.id);
    const target = edit === 'unknownBusiness' ? NO_ID : other.id;

    const op = `DELETE ${BIZ}/{id}/clients/{clientId} (${edit})`;
    this.expectRejected(op, await this.api.unlinkClient(target, clientId), expect);

    const client = (await this.api.getClient(clientId)).value;
    assertCondition(op, client.businessId === business.id, `businessId = ${client.businessId}`,
      `კლიენტი ისევ თავის ბიზნესზეა (${business.id})`, client);
  }

  /** POST client integratorId-ით (update) — scheme / business-ის შეცვლა, status-ის გარეშე, არარსებული კლიენტი */
  async updateClientRejected(edit: ClientUpdateCase, expect: Rejection) {
    const business = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const created = await this.newClient('WALLET', business.id);
    const body: any = { ...created.body, integratorId: created.clientId };

    if (edit === 'changeScheme') body.scheme = 'SYSTEM_OPERATOR';
    if (edit === 'otherBusiness') body.businessId = (await this.biz.createBusiness({ residency: 'RESIDENT' })).id;
    if (edit === 'noStatus') delete body.status;
    if (edit === 'unknownClient') body.integratorId = NO_ID;
    if (edit === 'percentOver100') body.currencyConfigs = gel({}, { commission: 500, commissionRateType: 'PERCENTAGE' });

    const op = `POST /api/distributor-hub-client — update (${edit})`;
    this.expectRejected(op, await this.api.createClient(body), expect);

    const after = (await this.api.getClient(created.clientId)).value;
    assertCondition(op, after.scheme === 'WALLET' && after.businessId === business.id,
      `scheme ${after.scheme}, businessId ${after.businessId}`, `scheme WALLET, businessId ${business.id} (უცვლელი)`, after);
    const commission = after.currencyConfigs?.GEL?.[0]?.commissionTiers?.[0]?.commission;
    assertCondition(op, commission === 0, `GEL საკომისიო შეიცვალა: ${commission}`, 'საკომისიო უცვლელია (0)', after.currencyConfigs);
  }

  /** clientName დაკავებულის ვარიანტით (ბოლოში space) → 1186, კლიენტი არ შეიქმნა */
  async duplicateClientNameWithSpaceRejected() {
    const existing = RsClientHelper.buildBody('WALLET');
    RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(existing));
    const name = `${existing.clientName} `;
    const op = `POST /api/distributor-hub-client (clientName = "${name}" — არსებული + ბოლოში space)`;
    this.expectRejected(op, await this.api.createClient({ ...RsClientHelper.buildBody('WALLET'), clientName: name }), { http: 400, code: 1186 });
  }

  /** PUT client/{id}?amount=… — ბალანსის ცვლილების ნეგატიურები (WALLET კლიენტზე) */
  async balanceRejected(params: Record<string, any>, expect: Rejection) {
    const { clientId } = await this.newClient();
    const op = `PUT /api/distributor-hub-client/{id} — ბალანსი (${this.describe(params)})`;
    this.expectRejected(op, await this.api.updateBalance(clientId, params), expect);
    const gelBalance = (await this.api.getClient(clientId)).value.balances.find((b: any) => b.currency === 'GEL');
    assertCondition(op, gelBalance?.amount === 0, `GEL ბალანსი შეიცვალა: ${gelBalance?.amount}`, 'ბალანსი უცვლელია (0)', gelBalance);
  }

  /** business filter name-ში SQL LIKE სიმბოლო (% / _) — მხოლოდ ის ჩანაწერები, რომელთა სახელიც ამ სიმბოლოს შეიცავს */
  async filterNameWildcardLiteral(value: string) {
    const op = `GET ${BIZ}/filter (name = "${value}")`;
    const page = RsHubApi.expectOk(op, await this.api.filterBusinesses({ name: value, pageIndex: 1, pageSize: 50 }));
    const wrong = (page.content || []).filter((r: any) => !String(r.ownerFullName).includes(value));
    assertCondition(op, wrong.length === 0,
      `${page.totalElements} ჩანაწერი მოვიდა, მათ შორის ${wrong.length} სახელში "${value}" არ შეიცავს — "${value}" wildcard-ად მუშაობს`,
      `მხოლოდ სახელები, რომლებიც "${value}"-ს შეიცავს (სიმბოლო ტექსტად, არა wildcard-ად)`,
      { totalElements: page.totalElements, sample: wrong.slice(0, 3).map((r: any) => r.ownerFullName) });
  }

  /** GET client: არარსებული id → 400 / 1185 (docs) */
  async getClientRejected(expect: Rejection) {
    this.expectRejected(`GET /api/distributor-hub-client/${NO_ID}`, await this.api.getClient(NO_ID), expect);
  }

  // ─── საერთო ───

  /** HTTP + code + errors[] ველი; 2xx და 500 — ცალკე გასაგები ტექსტით */
  private expectRejected(op: string, res: ApiResult, expect: Rejection) {
    const got = `HTTP ${res.status}${res.body?.statusCode ? ` / code ${res.body.statusCode}` : ''}`;
    const why = res.status < 300 ? ' — API-მ არავალიდური მონაცემი მიიღო და შეინახა'
      : res.status >= 500 ? ' — სერვერის შეცდომა (500), ვალიდაცია არ მუშაობს' : '';
    const want = `HTTP ${expect.http}${expect.code ? ` / code ${expect.code}` : ''}${expect.field ? ` / errors[] → ${expect.field}` : ''}`;

    assertCondition(op, res.status === expect.http && (expect.code === undefined || res.body?.statusCode === expect.code),
      `მოვიდა ${got}${why}`, want, res.body);

    if (expect.field) {
      const errors: any[] = res.body?.errors || [];
      assertCondition(op, errors.some((e) => e.name === expect.field || String(e.name).startsWith(`${expect.field}[`)),
        `errors[]-ში არ არის ველი "${expect.field}"`, `errors[] → ${expect.field}`, res.body);
    }
    console.log(`✅ Rejected — ${op} → ${got}`);
  }

  /** ახალი კლიენტი (body-ით, რომ update-ში იგივე გავაგზავნოთ) */
  private async newClient(scheme: 'WALLET' | 'SYSTEM_OPERATOR' = 'WALLET', businessId?: string) {
    const body = RsClientHelper.buildBody(scheme, businessId);
    const { clientId } = RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(body));
    return { clientId, body };
  }

  /** PUT body — GET-იდან ყველა ველი + version (ვები იგივეს აგზავნის) */
  private updateBody(biz: any): any {
    return RsBusinessHelper.updateBody(biz);
  }

  private async expectBusinessNotSaved(op: string, name?: string) {
    if (typeof name !== 'string' || !name.trim()) return;
    const page = (await this.api.filterBusinesses({ name, pageIndex: 1, pageSize: 5 })).value;
    const saved = (page?.content || []).filter((r: any) => r.ownerFullName === name);
    assertCondition(op, saved.length === 0, `ბიზნესი მაინც შეიქმნა (${saved.map((r: any) => r.id).join(', ')})`,
      'უარყოფილი ბიზნესი არ შეინახა', saved);
  }

  private async expectBusinessUnchanged(op: string, biz: any) {
    const after = RsHubApi.expectOk(`GET ${BIZ}/{id}`, await this.api.getBusiness(biz.id));
    assertCondition(op, after.identificationNumber === biz.identificationNumber && after.version === biz.version,
      `identificationNumber ${after.identificationNumber}, version ${after.version}`,
      `უცვლელი: identificationNumber ${biz.identificationNumber}, version ${biz.version}`, after);
  }

  private async expectClientNotSaved(op: string, name?: string) {
    if (typeof name !== 'string' || !name.trim() || name.length > 255) return;
    const page = (await this.api.filterClients({ searchText: name, showMock: true, pageIndex: 1, pageSize: 5 })).value;
    const saved = (page?.content || []).filter((r: any) => r.clientName === name);
    assertCondition(op, saved.length === 0, `კლიენტი მაინც შეიქმნა (${saved.map((r: any) => r.clientId).join(', ')})`,
      'უარყოფილი კლიენტი არ შეინახა', saved);
  }

  /** ველების ჩანაცვლება; undefined → ველი ამოიშლება */
  private apply(body: any, fields: Record<string, any>) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete body[k];
      else body[k] = v;
    }
    return body;
  }

  /** op-ის ტექსტისთვის — მოკლე აღწერა (გრძელი სტრიქონები სიგრძით) */
  private describe(fields: Record<string, any>) {
    return Object.entries(fields).map(([k, v]) => {
      if (v === undefined) return `${k} აკლია`;
      if (typeof v === 'string' && v.length > 30) return `${k} ${v.length} სიმბოლო`;
      return `${k} = ${JSON.stringify(v)}`;
    }).join(', ');
  }
}
