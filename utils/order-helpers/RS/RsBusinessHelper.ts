import { APIRequestContext } from '@playwright/test';
import { RsHubApi, Residency, digits, date, randomCompanyName } from './RsHubApi';
import { assertCondition, assertField, assertKeysPresent } from '../../assertions';

const OP_CREATE = 'POST /api/distributor-hub-business';
const OP_GET = 'GET /api/distributor-hub-business/{id}';
const OP_FILTER = 'GET /api/distributor-hub-business/filter';

const BUSINESS_KEYS = ['id', 'version', 'residency', 'identificationNumber', 'personalNumberAlt', 'ownerFullName',
  'operDate', 'knownDate', 'createdAt', 'updatedAt', 'clients'];
const LIST_ROW_KEYS = ['id', 'identificationNumber', 'ownerFullName', 'residency', 'clientCount',
  'restrictedClientCount', 'createdAt', 'updatedAt'];

export interface BusinessConfig {
  residency: Residency;
  /** RESIDENT: TAX_ID = 9 ციფრი (ს/კ), PERSONAL = 11 ციფრი (პ/ნ). FOREIGN: TAX_ID = თავისუფალი ტექსტი, NONE = გარეშე */
  ident?: 'TAX_ID' | 'PERSONAL' | 'NONE';
  /** personalNumberAlt (11 ციფრი) */
  withAltNumber?: boolean;
  /** stateRegAuthority / DocNumber / DocDate */
  withStateReg?: boolean;
}

/** რედაქტირების ქეისი:
 *  details — სახელი, თარიღები, ალტ. ნომერი | ident — identificationNumber ახალ ნომერზე
 *  foreignAddresses — FOREIGN: მისამართები + state reg | residencyToForeign — RESIDENT → FOREIGN (RS-ში გაგზავნამდე) */
export type BusinessEdit = 'details' | 'ident' | 'foreignAddresses' | 'residencyToForeign';

/** PUT body-ის ველები — ვები იგივეს აგზავნის (null-ებით) + version */
const UPDATE_FIELDS = ['residency', 'identificationNumber', 'personalNumberAlt', 'ownerFullName', 'operDate', 'knownDate',
  'legalAddressCountry', 'legalAddressCity', 'legalAddressLine', 'actualAddressCountry', 'actualAddressCity',
  'actualAddressLine', 'stateRegAuthority', 'stateRegDocNumber', 'stateRegDocDate', 'version'];

const OP_UPDATE = 'PUT /api/distributor-hub-business/{id}';

export type BusinessFilter ='identificationNumber' | 'identPrefix' | 'personalNumberAlt' | 'name' | 'residency';

/**
 * RS — Business (გადასახადის გადამხდელი) — Distributor Hub, ადმინ პანელიდან.
 *   📋 business = პირის მონაცემები (ident, სახელი, თარიღები), რაც RS-ს ეგზავნება.
 *      შექმნისას RS-ში არაფერი მიდის — მხოლოდ WALLET კლიენტის მიბმისას იწყება enrollment.
 */
export class RsBusinessHelper {
  private api: RsHubApi;

  constructor(request: APIRequestContext) {
    this.api = new RsHubApi(request);
  }

  /** PUT body — GET-იდან ყველა ველი (null-ებით) + version, როგორც ვები აგზავნის */
  static updateBody(business: any): any {
    return Object.fromEntries(UPDATE_FIELDS.map((k) => [k, business[k] ?? null]));
  }

  /** სატესტო body — residency-ის მიხედვით სავალდებულო ველებით (api.js → panel-biz-create) */
  static buildBody(config: BusinessConfig): any {
    const tag = digits(6);
    const body: any = {
      residency: config.residency,
      ownerFullName: randomCompanyName(),
      operDate: date(30),
    };

    const ident = config.ident ?? 'TAX_ID';
    if (config.residency === 'RESIDENT') {
      body.identificationNumber = ident === 'PERSONAL' ? `9${digits(10)}` : `9${digits(8)}`;
      body.knownDate = date(10);
    } else {
      if (ident !== 'NONE') body.identificationNumber = `QA-FRN-${digits(8)}`;
      Object.assign(body, {
        legalAddressCountry: 'Germany',
        legalAddressCity: 'Berlin QA',
        legalAddressLine: `Teststrasse ${tag}`,
        actualAddressCountry: 'Germany',
        actualAddressCity: 'Berlin QA',
        actualAddressLine: `Teststrasse ${tag}`,
      });
    }

    if (config.withAltNumber) body.personalNumberAlt = `9${digits(10)}`;
    if (config.withStateReg) {
      Object.assign(body, {
        stateRegAuthority: 'QA Registry',
        stateRegDocNumber: `REG-${tag}`,
        stateRegDocDate: date(60),
      });
    }
    return body;
  }

  /**
   * ბიზნესის შექმნა → response-ში ყველა გაგზავნილი ველი → GET /{id} იგივეს აბრუნებს.
   * აბრუნებს შექმნილ business-ს (სხვა helper-ებიც იყენებს).
   */
  async createBusiness(config: BusinessConfig): Promise<any> {
    const body = RsBusinessHelper.buildBody(config);

    const created = RsHubApi.expectOk(OP_CREATE, await this.api.createBusiness(body));
    assertKeysPresent(OP_CREATE, created, BUSINESS_KEYS);
    this.verifyFields(OP_CREATE, created, body);
    assertCondition(OP_CREATE, Array.isArray(created.clients) && created.clients.length === 0,
      `clients: ${JSON.stringify(created.clients)}`, 'ახალ ბიზნესს კლიენტები არ აქვს (clients = [])', created);

    const fetched = RsHubApi.expectOk(OP_GET, await this.api.getBusiness(created.id));
    assertField(OP_GET, fetched, 'id', created.id);
    this.verifyFields(OP_GET, fetched, body);

    console.log(`✅ Business Created — ${body.ownerFullName} · ${body.residency} · ${body.identificationNumber ?? '(no ident)'} · ${created.id}`);
    return created;
  }

  /**
   * ფილტრი: ახალი ბიზნესი → filter → ჩვენი ბიზნესი სიაშია + ყველა row ფილტრს აკმაყოფილებს.
   *   identificationNumber — სრული ნომრით | identPrefix — ნომრის დასაწყისით (5 ციფრი)
   *   personalNumberAlt — იგივე identificationNumber პარამეტრით, ალტერნატიული ნომრით
   *   name — ownerFullName-ის ნაწილი, სხვა რეგისტრით | residency — RESIDENT / FOREIGN
   */
  async checkFilter(by: BusinessFilter, residency: Residency = 'RESIDENT') {
    const biz = await this.createBusiness({ residency, withAltNumber: by === 'personalNumberAlt' });

    const params: Record<BusinessFilter, any> = {
      identificationNumber: { identificationNumber: biz.identificationNumber },
      identPrefix: { identificationNumber: biz.identificationNumber.slice(0, 5) },
      personalNumberAlt: { identificationNumber: biz.personalNumberAlt },
      name: { name: biz.ownerFullName.slice(3).toLowerCase() },
      residency: { residency },
    };
    const query = params[by];
    const op = `${OP_FILTER} (${by}: ${Object.values(query)[0]})`;

    const page = RsHubApi.expectOk(op, await this.api.filterBusinesses({ ...query, pageIndex: 1, pageSize: 50 }));
    const rows: any[] = page.content || [];
    assertKeysPresent(op, page, ['content', 'totalElements', 'totalPages']);

    const ours = rows.find((r) => r.id === biz.id);
    assertCondition(op, !!ours, `ახლად შექმნილი ბიზნესი (${biz.id}) სიაში არ არის`,
      'ჩვენი ბიზნესი პირველ გვერდზე (newest first)', page);
    assertKeysPresent(op, ours, LIST_ROW_KEYS);
    assertField(op, ours, 'clientCount', 0);

    // ყველა row ემთხვევა ფილტრს (personalNumberAlt list-ში არ ბრუნდება — მხოლოდ ჩვენი row მოწმდება)
    const value = String(Object.values(query)[0]);
    const mismatch = rows.filter((r) => {
      if (by === 'identificationNumber' || by === 'identPrefix') return !String(r.identificationNumber ?? '').startsWith(value);
      if (by === 'name') return !String(r.ownerFullName ?? '').toLowerCase().includes(value);
      if (by === 'residency') return r.residency !== residency;
      return false;
    });
    assertCondition(op, mismatch.length === 0,
      `${mismatch.length} row ფილტრს არ ემთხვევა`, `ყველა row: ${by} = ${value}`, mismatch);

    if (by === 'identificationNumber') {
      assertCondition(op, rows.length === 1, `სრული ნომრით მოვიდა ${rows.length} row`,
        '1 row (identificationNumber უნიკალურია)', page);
    }
  }

  /**
   * რედაქტირება: ახალი ბიზნესი → GET (version) → PUT სრული body-ით + ცვლილებები →
   *   response-ში და GET-ში ახალი მნიშვნელობები, version +1, id / createdAt უცვლელი →
   *   ფილტრი ახალი მნიშვნელობით პოულობს (ident-ზე — ძველით აღარ)
   */
  async editBusiness(edit: BusinessEdit) {
    const startResidency: Residency = edit === 'foreignAddresses' ? 'FOREIGN' : 'RESIDENT';
    const created = await this.createBusiness({ residency: startResidency });
    const before = RsHubApi.expectOk(OP_GET, await this.api.getBusiness(created.id));

    const tag = digits(6);
    const changes: Record<BusinessEdit, any> = {
      details: {
        ownerFullName: randomCompanyName(),
        operDate: date(40),
        knownDate: date(5),
        personalNumberAlt: `9${digits(10)}`,
      },
      ident: { identificationNumber: `9${digits(8)}` },
      foreignAddresses: {
        legalAddressCountry: 'France',
        legalAddressCity: 'Paris QA',
        legalAddressLine: `Rue de Test ${tag}`,
        actualAddressCountry: 'Italy',
        actualAddressCity: 'Rome QA',
        actualAddressLine: `Via Test ${tag}`,
        stateRegAuthority: 'QA Registry Updated',
        stateRegDocNumber: `REG-UPD-${tag}`,
        stateRegDocDate: date(90),
      },
      residencyToForeign: {
        residency: 'FOREIGN',
        legalAddressCountry: 'Germany',
        legalAddressCity: 'Berlin QA',
        legalAddressLine: `Teststrasse ${tag}`,
        actualAddressCountry: 'Germany',
        actualAddressCity: 'Berlin QA',
        actualAddressLine: `Teststrasse ${tag}`,
      },
    };
    const change = changes[edit];
    const body = { ...RsBusinessHelper.updateBody(before), ...change };
    const op = `${OP_UPDATE} (${edit})`;

    const updated = RsHubApi.expectOk(op, await this.api.updateBusiness(created.id, body));
    this.verifyFields(op, updated, change);
    assertField(op, updated, 'version', before.version + 1);
    assertField(op, updated, 'id', created.id);
    assertField(op, updated, 'createdAt', before.createdAt);

    // შეუცვლელი ველები იგივე დარჩა
    const untouched = UPDATE_FIELDS.filter((k) => k !== 'version' && !(k in change));
    for (const k of untouched) assertField(op, updated, k, before[k]);

    const fetched = RsHubApi.expectOk(OP_GET, await this.api.getBusiness(created.id));
    this.verifyFields(OP_GET, fetched, change);
    assertField(OP_GET, fetched, 'version', before.version + 1);
    console.log(`✅ Business Updated (${edit}) — ${fetched.ownerFullName} · version ${before.version} → ${fetched.version}`);

    // ფილტრი ახალი მნიშვნელობით
    const query = edit === 'details' ? { name: change.ownerFullName }
      : edit === 'residencyToForeign' ? { identificationNumber: created.identificationNumber, residency: 'FOREIGN' }
      : { identificationNumber: fetched.identificationNumber };
    const fop = `${OP_FILTER} (${JSON.stringify(query)})`;
    const page = RsHubApi.expectOk(fop, await this.api.filterBusinesses({ ...query, pageIndex: 1, pageSize: 50 }));
    const row = (page.content || []).find((r: any) => r.id === created.id);
    assertCondition(fop, !!row, 'განახლებული ბიზნესი ახალი მნიშვნელობით ვერ მოიძებნა', 'ბიზნესი სიაშია', page);
    if (edit === 'details') assertField(fop, row, 'ownerFullName', change.ownerFullName);
    if (edit === 'residencyToForeign') assertField(fop, row, 'residency', 'FOREIGN');

    if (edit === 'ident') {
      const oldOp = `${OP_FILTER} (ძველი identificationNumber: ${before.identificationNumber})`;
      const old = RsHubApi.expectOk(oldOp, await this.api.filterBusinesses({ identificationNumber: before.identificationNumber }));
      assertCondition(oldOp, !(old.content || []).some((r: any) => r.id === created.id),
        'ძველი ნომრით ისევ პოულობს', 'ძველი ნომრით ბიზნესი აღარ უნდა მოიძებნოს', old);
    }
  }

  /** პაგინაცია: გვერდი 1 და 2 — ზომა ≤ pageSize, id-ები არ მეორდება, newest first */
  async checkPagination(pageSize: number) {
    const op = `${OP_FILTER} (pageSize: ${pageSize})`;
    const p1 = RsHubApi.expectOk(op, await this.api.filterBusinesses({ pageIndex: 1, pageSize }));
    const p2 = RsHubApi.expectOk(op, await this.api.filterBusinesses({ pageIndex: 2, pageSize }));
    const r1: any[] = p1.content || [];
    const r2: any[] = p2.content || [];

    assertCondition(op, p1.totalElements > pageSize, `totalElements = ${p1.totalElements}`,
      `საკმარისი ჩანაწერი 2 გვერდისთვის (> ${pageSize})`, p1);
    assertCondition(op, r1.length === pageSize && r2.length > 0 && r2.length <= pageSize,
      `გვერდი 1: ${r1.length}, გვერდი 2: ${r2.length}`, `გვერდი 1 = ${pageSize}, გვერდი 2 = 1..${pageSize}`, { p1, p2 });
    assertCondition(op, p1.totalPages === Math.ceil(p1.totalElements / pageSize),
      `totalPages ${p1.totalPages}, totalElements ${p1.totalElements}`, `totalPages = ceil(totalElements / ${pageSize})`, p1);

    const overlap = r2.filter((r) => r1.some((x) => x.id === r.id));
    assertCondition(op, overlap.length === 0, `${overlap.length} ჩანაწერი ორივე გვერდზეა`,
      'გვერდებს შორის გამეორება არ არის', overlap);

    const all = [...r1, ...r2];
    const unsorted = all.findIndex((r, i) => i > 0 && new Date(r.createdAt) > new Date(all[i - 1].createdAt));
    assertCondition(op, unsorted === -1, `დალაგება დარღვეულია row #${unsorted}-ზე`,
      'createdAt კლებადობით (newest first)', all.map((r) => r.createdAt));
  }

  /** გაგზავნილი body-ს ყველა ველი response-ში იგივეა */
  private verifyFields(op: string, actual: any, body: any) {
    for (const key of Object.keys(body)) assertField(op, actual, key, body[key]);
  }
}
