import { APIRequestContext } from '@playwright/test';
import { RsHubApi, Scheme, randomCompanyName, digits } from './RsHubApi';
import { RsBusinessHelper } from './RsBusinessHelper';
import { assertCondition, assertField, assertKeysPresent } from '../../assertions';

const OP_CREATE = 'POST /api/distributor-hub-client';
const OP_GET = 'GET /api/distributor-hub-client/{id}';
const OP_FILTER = 'GET /api/distributor-hub-client/filter';
const OP_BIZ_GET = 'GET /api/distributor-hub-business/{id}';
const OP_BIZ_FILTER = 'GET /api/distributor-hub-business/filter';
const OP_FREE = 'GET /api/distributor-hub-business/wallet-clients-without-business';
const OP_LINK = 'POST /api/distributor-hub-business/{id}/clients';
const OP_UNLINK = 'DELETE /api/distributor-hub-business/{id}/clients/{clientId}';

const CLIENT_KEYS = ['clientId', 'clientName', 'status', 'scheme', 'businessId', 'isMock',
  'distributeMethod', 'distributionStrategy', 'balances', 'currencyConfigs'];
const BIZ_CLIENT_KEYS = ['clientId', 'clientName', 'scheme', 'active', 'createdAt', 'balances'];

export interface ClientConfig {
  scheme: Scheme;
  /** true — ახალი business იქმნება და კლიენტი შექმნისასვე ებმება (businessId body-ში) */
  withBusiness: boolean;
  /** body-ის ველების შეცვლა (distributeMethod, distributionStrategy, currencyConfigs) — GET-ში იგივე უნდა დაბრუნდეს */
  body?: any;
}

/**
 * currencyConfigs-ის ერთი ჩანაწერი (provider + ლიმიტები + საკომისიოს tier-ები).
 * default: DEFAULT · 0.01–100000 · FIXED 0 from 0. ველი undefined → body-დან ამოიშლება (ნეგატიურებისთვის).
 */
export const currencyConfig = (config: any = {}, tier: any = {}) => clean({
  provider: 'DEFAULT',
  minTransactionAmount: 0.01,
  maxTransactionAmount: 100000,
  commissionTiers: [clean({ commission: 0, commissionRateType: 'FIXED', startAmount: 0, ...tier })],
  ...config,
});

/** { GEL: [currencyConfig(...)] } */
export const gel = (config: any = {}, tier: any = {}) => ({ GEL: [currencyConfig(config, tier)] });

/** undefined მნიშვნელობის ველები ამოიშლება */
function clean(obj: any) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export type ClientFilter = 'name' | 'clientId' | 'hideMock';

/**
 * RS — Distributor Hub კლიენტი (საფულე) + ბიზნესზე მიბმა/მოხსნა, ადმინ პანელიდან.
 *   📋 WALLET — RS-ს ექვემდებარება (businessId-ით); SYSTEM_OPERATOR — არა (business-ს ვერ ებმება).
 *   📋 მიბმა: შექმნისას businessId-ით ან POST /business/{id}/clients — ორივე იწყებს RS enrollment-ს.
 */
export class RsClientHelper {
  private api: RsHubApi;
  private biz: RsBusinessHelper;

  constructor(request: APIRequestContext) {
    this.api = new RsHubApi(request);
    this.biz = new RsBusinessHelper(request);
  }

  /** სატესტო body (api.js → panel-client-create), isMock — dev-ზე სატესტო კლიენტი */
  static buildBody(scheme: Scheme, businessId?: string, overrides: any = {}): any {
    return clean({
      clientName: `${randomCompanyName()} ${digits(4)}`, // უნიკალური — სახელი უკვე არსებობს → 1186
      scheme,
      ...(businessId ? { businessId } : {}),
      distributeMethod: 'IBAN',
      distributionStrategy: 'STANDARD',
      isMock: true,
      status: true,
      currencyConfigs: gel(),
      ...overrides,
    });
  }

  /**
   * კლიენტის შექმნა → GET /{id} (scheme, businessId, status, isMock) →
   *   withBusiness: ბიზნესის clients[]-შია, clientCount = 1, თავისუფალ სიაში არ არის
   *   WALLET ბიზნესის გარეშე: თავისუფალ სიაშია (wallet-clients-without-business)
   *   SYSTEM_OPERATOR: თავისუფალ სიაში არ არის (მხოლოდ WALLET ებმება)
   */
  async createClient(config: ClientConfig) {
    const business = config.withBusiness ? await this.biz.createBusiness({ residency: 'RESIDENT' }) : undefined;
    const client = await this.create(config.scheme, business?.id, config.body);

    if (business) {
      await this.verifyLinked(business, [client.clientId]);
    } else {
      assertCondition(OP_GET, client.businessId == null, `businessId = ${client.businessId}`, 'businessId = null', client);
      await this.verifyInFreeList(client.clientId, config.scheme === 'WALLET');
    }
  }

  /**
   * მიბმა: ბიზნესი + WALLET კლიენტ(ებ)ი ბიზნესის გარეშე → POST /business/{id}/clients →
   *   response.clients[]-შია → კლიენტის businessId = ბიზნესის id → clientCount = N → თავისუფალ სიაში აღარ არის
   */
  async linkClients(count: number) {
    const business = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const clients = [];
    for (let i = 0; i < count; i++) clients.push(await this.create('WALLET'));
    const ids = clients.map((c) => c.clientId);
    for (const id of ids) await this.verifyInFreeList(id, true);

    const linked = RsHubApi.expectOk(OP_LINK, await this.api.linkClients(business.id, ids));
    const missing = ids.filter((id) => !(linked.clients || []).some((c: any) => c.clientId === id));
    assertCondition(OP_LINK, missing.length === 0, `response.clients-ში აკლია: ${missing.join(', ')}`,
      `ყველა მიბმული კლიენტი: ${ids.join(', ')}`, linked);
    console.log(`✅ Linked ${count} client(s) → business ${business.id}`);

    await this.verifyLinked(business, ids);
  }

  /**
   * მოხსნა: ბიზნესი + მიბმული WALLET კლიენტი → DELETE /business/{id}/clients/{clientId} →
   *   response.clients[]-ში აღარ არის → კლიენტის businessId = null → clientCount = 0 → ისევ თავისუფალ სიაშია
   */
  async unlinkClient() {
    const business = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const client = await this.create('WALLET', business.id);

    const after = RsHubApi.expectOk(OP_UNLINK, await this.api.unlinkClient(business.id, client.clientId));
    assertCondition(OP_UNLINK, !(after.clients || []).some((c: any) => c.clientId === client.clientId),
      'კლიენტი ისევ business.clients-შია', 'კლიენტი მოხსნილია (clients-ში არ არის)', after);
    console.log(`✅ Unlinked client ${client.clientId} ← business ${business.id}`);

    const fetched = RsHubApi.expectOk(OP_GET, await this.api.getClient(client.clientId));
    assertCondition(OP_GET, fetched.businessId == null, `businessId = ${fetched.businessId}`,
      'მოხსნის შემდეგ businessId = null', fetched);
    await this.verifyClientCount(business, 0);
    await this.verifyInFreeList(client.clientId, true);
  }

  /**
   * კლიენტების ფილტრი (WALLET + business):
   *   name — searchText = სახელის ნაწილი, სხვა რეგისტრით | clientId — searchText = clientId
   *   hideMock — showMock=false → mock კლიენტი სიაში არ ჩანს
   */
  async checkFilter(by: ClientFilter) {
    const business = await this.biz.createBusiness({ residency: 'RESIDENT' });
    const client = await this.create('WALLET', business.id);

    const searchText = by === 'name' ? client.clientName.slice(3).toLowerCase() : by === 'clientId' ? client.clientId : client.clientName;
    const showMock = by !== 'hideMock';
    const op = `${OP_FILTER} (searchText: ${searchText}, showMock: ${showMock})`;

    const page = RsHubApi.expectOk(op, await this.api.filterClients({ searchText, showMock, pageIndex: 1, pageSize: 50 }));
    assertKeysPresent(op, page, ['content', 'totalElements', 'totalPages']);
    const rows: any[] = page.content || [];
    const ours = rows.find((r) => r.clientId === client.clientId);

    if (by === 'hideMock') {
      assertCondition(op, !ours, 'mock კლიენტი სიაში ჩანს', 'showMock=false → mock კლიენტი დამალულია', page);
      return;
    }

    assertCondition(op, !!ours, `კლიენტი ${client.clientId} სიაში არ არის`, 'ჩვენი კლიენტი სიაშია', page);
    assertField(op, ours, 'scheme', 'WALLET');
    assertField(op, ours, 'businessId', business.id);
    assertField(op, ours, 'isMock', true);

    const mismatch = rows.filter((r) => by === 'clientId'
      ? !String(r.clientId).includes(searchText)
      : !String(r.clientName).toLowerCase().includes(searchText));
    assertCondition(op, mismatch.length === 0, `${mismatch.length} row searchText-ს არ ემთხვევა`,
      `ყველა row-ში ${by === 'clientId' ? 'clientId' : 'clientName'} შეიცავს "${searchText}"`, mismatch);
  }

  // ─── საერთო ნაბიჯები ───

  /** შექმნა + GET /{id}: გაგზავნილი ველები ემთხვევა */
  private async create(scheme: Scheme, businessId?: string, overrides?: any): Promise<any> {
    const body = RsClientHelper.buildBody(scheme, businessId, overrides);
    const created = RsHubApi.expectOk(OP_CREATE, await this.api.createClient(body));
    assertKeysPresent(OP_CREATE, created, ['clientId', 'clientSecret']);

    const client = RsHubApi.expectOk(OP_GET, await this.api.getClient(created.clientId));
    assertKeysPresent(OP_GET, client, CLIENT_KEYS);
    assertField(OP_GET, client, 'clientId', created.clientId);
    assertField(OP_GET, client, 'clientName', body.clientName);
    assertField(OP_GET, client, 'scheme', scheme);
    assertField(OP_GET, client, 'status', true);
    assertField(OP_GET, client, 'isMock', true);
    if (businessId) assertField(OP_GET, client, 'businessId', businessId);
    assertField(OP_GET, client, 'distributeMethod', body.distributeMethod);
    assertField(OP_GET, client, 'distributionStrategy', body.distributionStrategy);
    this.verifyCurrencyConfigs(client, body.currencyConfigs);

    console.log(`✅ Client Created — ${body.clientName} · ${scheme} · ${created.clientId}${businessId ? ` · business ${businessId}` : ''}`);
    return client;
  }

  /** currencyConfigs: ყოველი ვალუტა / provider — ლიმიტები და tier-ები ზუსტად ისაა, რაც გავგზავნეთ */
  private verifyCurrencyConfigs(client: any, sent: any) {
    const op = `${OP_GET} (currencyConfigs)`;
    const got = client.currencyConfigs || {};
    for (const [cur, configs] of Object.entries<any[]>(sent)) {
      for (const cfg of configs) {
        const saved = (got[cur] || []).find((c: any) => c.provider === cfg.provider);
        assertCondition(op, !!saved, `${cur} / ${cfg.provider} კონფიგი არ შეინახა`, `${cur} / ${cfg.provider} არსებობს`, got);
        assertField(op, saved, 'minTransactionAmount', cfg.minTransactionAmount);
        assertField(op, saved, 'maxTransactionAmount', cfg.maxTransactionAmount);
        assertCondition(op, saved.commissionTiers?.length === cfg.commissionTiers.length,
          `${cur} / ${cfg.provider}: tier-ები ${saved.commissionTiers?.length}`, `${cfg.commissionTiers.length} tier`, saved);
        cfg.commissionTiers.forEach((tier: any, i: number) => {
          for (const k of Object.keys(tier)) assertField(`${op} ${cur}/${cfg.provider} tier #${i + 1}`, saved.commissionTiers[i], k, tier[k]);
        });
      }
    }
  }

  /** ბიზნესზე მიბმულია: client.businessId, business.clients[], clientCount, თავისუფალ სიაში არ არის */
  private async verifyLinked(business: any, clientIds: string[]) {
    for (const id of clientIds) {
      const client = RsHubApi.expectOk(OP_GET, await this.api.getClient(id));
      assertField(OP_GET, client, 'businessId', business.id);
    }

    const fetched = RsHubApi.expectOk(OP_BIZ_GET, await this.api.getBusiness(business.id));
    const rows: any[] = fetched.clients || [];
    for (const id of clientIds) {
      const row = rows.find((c) => c.clientId === id);
      assertCondition(OP_BIZ_GET, !!row, `კლიენტი ${id} business.clients-ში არ არის`, 'მიბმული კლიენტი clients[]-შია', fetched);
      assertKeysPresent(OP_BIZ_GET, row, BIZ_CLIENT_KEYS);
      assertField(OP_BIZ_GET, row, 'scheme', 'WALLET');
    }

    await this.verifyClientCount(business, clientIds.length);
    for (const id of clientIds) await this.verifyInFreeList(id, false);
  }

  /** business filter-ში clientCount */
  private async verifyClientCount(business: any, expected: number) {
    const op = `${OP_BIZ_FILTER} (identificationNumber: ${business.identificationNumber})`;
    const page = RsHubApi.expectOk(op, await this.api.filterBusinesses({ identificationNumber: business.identificationNumber }));
    const row = (page.content || []).find((r: any) => r.id === business.id);
    assertCondition(op, !!row, `ბიზნესი ${business.id} სიაში არ არის`, 'ბიზნესი სიაშია', page);
    assertField(op, row, 'clientCount', expected);
  }

  /** wallet-clients-without-business: shouldBe — უნდა იყოს თუ არა სიაში */
  private async verifyInFreeList(clientId: string, shouldBe: boolean) {
    const list = RsHubApi.expectOk(OP_FREE, await this.api.walletClientsWithoutBusiness());
    const found = (list || []).some((c: any) => c.clientId === clientId);
    assertCondition(OP_FREE, found === shouldBe,
      `კლიენტი ${clientId} ${found ? 'სიაშია' : 'სიაში არ არის'}`,
      shouldBe ? 'ბიზნესის გარეშე WALLET კლიენტი სიაშია' : 'კლიენტი თავისუფალ სიაში არ უნდა იყოს',
      { clientId, count: (list || []).length });
  }
}
