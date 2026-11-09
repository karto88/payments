import { APIRequestContext } from '@playwright/test';
import { AdminAuthPage } from '../../../pages/AdminAuthPage';
import { assertCondition } from '../../assertions';

export const PANEL = 'https://newadmin.dev.keepz.me';

export type Residency = 'RESIDENT' | 'FOREIGN';
export type Scheme = 'WALLET' | 'SYSTEM_OPERATOR';

export interface ApiResult {
  status: number;
  body: any;
  value: any;
}

type Params = Record<string, string | number | boolean | undefined>;

/**
 * RS — Distributor Hub ადმინ API (newadmin, ადმინის token — AdminAuthPage).
 * მხოლოდ HTTP გამოძახებები; flow-ები და შემოწმებები — RsBusinessHelper / RsClientHelper.
 * Docs: RS Integration Test Guide → api.js (Admin panel · Hub businesses / Hub clients)
 */
export class RsHubApi {
  private token?: string;

  constructor(private request: APIRequestContext, private base = PANEL) {}

  /** ადმინის token (სხვა admin endpoint-ებისთვის, მაგ. ტრანზაქციის refund) */
  adminToken(): Promise<string> { return this.auth(); }

  /** ადმინის token — ერთხელ helper-ის ინსტანსზე */
  private async auth(): Promise<string> {
    if (!this.token) this.token = await new AdminAuthPage(this.request, this.base).authenticate();
    return this.token;
  }

  async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string,
    opts: { params?: Params; data?: any } = {}): Promise<ApiResult> {
    const token = await this.auth();
    const params = Object.fromEntries(
      Object.entries(opts.params || {}).filter(([, v]) => v !== undefined)
    ) as Record<string, string | number | boolean>;

    const res = await this.request.fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      params,
      data: opts.data,
    });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status(), body, value: body?.value };
  }

  /** 2xx უნდა მოვიდეს — თორემ გასაგები error (assertions.ts) */
  static expectOk(op: string, res: ApiResult): any {
    assertCondition(op, res.status >= 200 && res.status < 300,
      `HTTP ${res.status}${res.body?.statusCode ? ` (code ${res.body.statusCode}: ${res.body.message})` : ''}`,
      'HTTP 2xx', res.body);
    return res.value;
  }

  // ─── Business ───

  createBusiness(data: any) { return this.call('POST', '/api/distributor-hub-business', { data }); }
  getBusiness(id: string) { return this.call('GET', `/api/distributor-hub-business/${id}`); }
  updateBusiness(id: string, data: any) { return this.call('PUT', `/api/distributor-hub-business/${id}`, { data }); }
  filterBusinesses(params: Params) { return this.call('GET', '/api/distributor-hub-business/filter', { params }); }
  walletClientsWithoutBusiness() { return this.call('GET', '/api/distributor-hub-business/wallet-clients-without-business'); }
  linkClients(businessId: string, clientIds: string[]) {
    return this.call('POST', `/api/distributor-hub-business/${businessId}/clients`, { data: { clientIds } });
  }
  unlinkClient(businessId: string, clientId: string) {
    return this.call('DELETE', `/api/distributor-hub-business/${businessId}/clients/${clientId}`);
  }

  // ─── Client ───

  createClient(data: any) { return this.call('POST', '/api/distributor-hub-client', { data }); }
  getClient(id: string) { return this.call('GET', `/api/distributor-hub-client/${id}`); }
  filterClients(params: Params) { return this.call('GET', '/api/distributor-hub-client/filter', { params }); }
  /** ბალანსის შევსება / ჩამოჭრა (amount > 0 — credit, < 0 — debit) */
  updateBalance(id: string, params: Params) { return this.call('PUT', `/api/distributor-hub-client/${id}`, { params }); }

  // ─── RS registration (api.js → Admin panel · RS registrations) ───

  createRegistration(data: any) { return this.call('POST', '/api/v1/rs/registrations', { data }); }
  getRegistration(id: string) { return this.call('GET', `/api/v1/rs/registrations/${id}`); }
  updateRegistration(id: string, data: any) { return this.call('PUT', `/api/v1/rs/registrations/${id}`, { data }); }
  lookupRegistration(params: Params) { return this.call('GET', '/api/v1/rs/registrations/lookup', { params }); }
  submitRegistration(id: string) { return this.call('POST', `/api/v1/rs/registrations/${id}/submit`); }
  submitChanges(id: string) { return this.call('POST', `/api/v1/rs/registrations/${id}/submit-changes`); }
  cancelRegistration(id: string, data: any) { return this.call('POST', `/api/v1/rs/registrations/${id}/cancel`, { data }); }

  // ─── RS restrictions — ყადაღა / ინკასო (api.js → Admin panel · RS restrictions) ───

  getRestrictions(params: Params) { return this.call('GET', '/api/v1/rs/restrictions', { params }); }
  getRestriction(id: string) { return this.call('GET', `/api/v1/rs/restrictions/${id}`); }
  /** hold-ების თავიდან განაწილება (მაგ. ახალი wallet-ის მიბმის შემდეგ) */
  reallocate(id: string) { return this.call('POST', `/api/v1/rs/restrictions/${id}/reallocate`); }
}

export const RS_SIM = 'https://rs-service.dev.keepz.me/api/rs/v1/simulator/keepz';
export const DISTRIBUTOR = 'https://distributor.dev.keepz.me';

/**
 * RS სიმულატორი (dev, "Play RS") — ჩვენ ვთამაშობთ RS-ის როლს. header X-RS-Simulator-Token (.env RS_SIM_TOKEN).
 *   📋 პასუხი ყოველთვის HTTP 200 — ჩვენი სისტემის პასუხი body-შია: items[].code (null = მიღებულია, რიცხვი = RS-ის კოდი).
 */
export class RsSimulatorApi {
  constructor(private request: APIRequestContext) {}

  async order(path: string, params: Params): Promise<any> {
    const res = await this.request.post(`${RS_SIM}${path}`, {
      headers: { 'X-RS-Simulator-Token': process.env.RS_SIM_TOKEN || '' },
      params: params as Record<string, string | number | boolean>,
    });
    assertCondition(`POST $SIM${path}`, res.ok(), `HTTP ${res.status()}`, 'HTTP 200 (401 — RS_SIM_TOKEN არასწორია)', await res.text());
    return res.json();
  }

  /** RS ადასტურებს გადამხდელს → რეგისტრაცია APPROVED (30 წმ-ის ლოდინის გარეშე) */
  approveTaxpayer(personId: string) { return this.order('/orders/honest-tax-payer', { personId }); }
  /** RS აგზავნის ყადაღას ident-ზე */
  lien(personId: string, amount: number | string, lienNumber: string, personIdAlt?: string) {
    return this.order('/orders/lien', { personId, amount, lienNumber, ...(personIdAlt ? { personIdAlt } : {}) });
  }
  /** RS ეკითხება: ეს გადამხდელი ჩვენი კლიენტია? (პასუხი — CHECK_PAYER_RESPONSE, GET /messages) */
  checkPayer(personId: string) { return this.order('/orders/check-payer', { personId }); }

  /** RS-ის შეკვეთა RS-ის ველების სახელებით; forgeSignature: true — ყალბი ხელმოწერა (უნდა უარვყოთ code 4-ით) */
  async rawOrder(items: any[], forgeSignature = false): Promise<any> {
    const res = await this.request.post(`${RS_SIM}/orders`, {
      headers: { 'X-RS-Simulator-Token': process.env.RS_SIM_TOKEN || '' },
      data: { items, forgeSignature },
    });
    assertCondition('POST $SIM/orders', res.ok(), `HTTP ${res.status()}`, 'HTTP 200', await res.text());
    return res.json();
  }

  /** რა გავუგზავნეთ RS-ს (ბოლო N შეტყობინება): operation, status, signedXml */
  async messages(limit = 20): Promise<any[]> {
    const res = await this.request.get(`${RS_SIM}/messages`, {
      headers: { 'X-RS-Simulator-Token': process.env.RS_SIM_TOKEN || '' }, params: { limit },
    });
    return res.json();
  }
  /** RS ხსნის ყადაღას */
  obtainLien(lienNumber: string) { return this.order('/orders/obtain-lien', { lienNumber }); }
  /** RS იგივე შეტყობინებას ხელახლა აგზავნის (rsMessageId — წინა პასუხიდან) */
  resend(rsMessageId: string) { return this.order(`/orders/resend/${rsMessageId}`, {}); }
}

/** wallet-ის (დისტრიბუტორის) API: client_credentials → token → გადარიცხვა IBAN-ზე */
export class DistributorApi {
  constructor(private request: APIRequestContext) {}

  async token(clientId: string, clientSecret: string): Promise<string> {
    const res = await this.request.post(`${DISTRIBUTOR}/api/auth`, {
      data: { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
    });
    const body = await res.json().catch(() => null);
    assertCondition('POST distributor /api/auth', res.ok() && !!body?.value?.access_token,
      `HTTP ${res.status()}`, 'HTTP 200 + value.access_token', body);
    return body.value.access_token;
  }

  async transfer(token: string, data: any): Promise<ApiResult> {
    const res = await this.request.post(`${DISTRIBUTOR}/api/distributor/`, { headers: { Authorization: `Bearer ${token}` }, data });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status(), body, value: body?.value };
  }
}

// ─── სატესტო მონაცემები (გამოგონილი ნომრები — არა რეალური პირების) ───

export const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

const LAST_NAMES = ['Champlin', 'Wolf', 'Gutkowski', 'Berge', 'Kessler', 'Sporer', 'Schroeder', 'Jaskolski', 'Hane',
  'Kuhn', 'Mraz', 'Bartell', 'Lockman', 'Weissnat', 'Hermiston', 'Rempel', 'Kautzer', 'Feeney', 'Bogan', 'Dibbert',
  'Gislason', 'Hessel', 'Jacobi', 'Kemmer', 'Lebsack', 'Marvin', 'Nienow', 'Okuneva', 'Pagac', 'Quigley', 'Runolfsdottir',
  'Schaden', 'Tromp', 'Upton', 'Veum', 'Waelchi', 'Yost', 'Zieme', 'Abshire', 'Bednar', 'Cormier', 'Durgan', 'Ernser',
  'Fadel', 'Grady', 'Hilpert', 'Ledner', 'Mosciski', 'Nolan', 'Prosacco', 'Reichert', 'Stamm', 'Torphy', 'Wuckert'];
const SUFFIXES = ['LLC', 'Inc', 'Group', 'and Sons'];
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** Postman-ის {{$randomCompanyName}}-ის მსგავსი (faker ფორმატები) + "QA " წინ — მაგ. "QA Wolf, Gutkowski and Berge" */
export const randomCompanyName = () => {
  const formats = [
    () => `${pick(LAST_NAMES)}, ${pick(LAST_NAMES)} and ${pick(LAST_NAMES)}`,
    () => `${pick(LAST_NAMES)} - ${pick(LAST_NAMES)}`,
    () => `${pick(LAST_NAMES)} ${pick(LAST_NAMES)} ${pick(SUFFIXES)}`,
  ];
  return `QA ${pick(formats)()}`;
};
/** YYYY-MM-DD, თბილისის დროით; daysAgo — რამდენი დღით ადრე */
export const date = (daysAgo = 0) =>
  new Date(Date.now() - daysAgo * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tbilisi' });
