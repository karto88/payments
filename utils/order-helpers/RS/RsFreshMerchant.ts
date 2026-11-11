import { APIRequestContext } from '@playwright/test';
import { AdminAuthPage } from '../../../pages/AdminAuthPage';
import { AuthDevicePage } from '../../../pages/AuthDevicePage';
import { RefundReportsHelper, MERCHANT_599000555 } from '../RefundReportsHelper';
import { ApiResult, digits } from './RsHubApi';
import { assertCondition } from '../../assertions';

const OP_CREATE = 'POST /api/v1/merchant/createMerchant';
const OP_BALANCE = 'GET walletportal /wallet/balances (ახალი merchant)';
const OP_CASH_OUT = 'POST walletportal /wallet/cash-out (merchant-ის გატანა)';
const ADMIN = 'https://newadmin.dev.keepz.me';
const WALLETPORTAL = 'https://walletportal.dev.keepz.me/api/v1/wallet';
/** სატესტო ნომრები (dev-ზე SMS კოდი 111111): 995 300000001 … 995 300001000 — თითო ახალ merchant-ზე ერთი */
const PHONE_FIRST = 300000001;
const PHONE_LAST = 300001000;
/** merchant-ის IBAN (გატანა აქ მიდის) — სატესტო ანგარიში */
const IBAN = 'GE29TB7197445064300124';
/** ⚠️ რეალური ფული: add money / გატანა ≤ 1 ₾ */
const MAX_AMOUNT = 1;
const TIMEOUT = 30_000;

const round = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ახალი სატესტო merchant (payment-service), BALANCE flow — ფული ბალანსზე რჩება (ყადაღა / ინკასო მას ყინავს).
 *   📋 ნომერი — შემდეგი თავისუფალი 300000001…300001000-დან (dev-ზე OTP 111111) → შესვლა მისი ნომრით
 *   📋 ბალანსი: add money (💳 ბარათი + ბანკის OTP — შენი ტელეფონი) · გატანა (cash-out merchant-ის IBAN-ზე)
 */
export class RsFreshMerchant {
  id = '';
  phone = '';
  name = '';
  private accessToken?: string;

  constructor(private request: APIRequestContext, readonly ident: string, readonly officialName: string) {}

  /** ყოველ ტესტს თავისი request აქვს (წინა ტესტისა დახურულია) → merchant ერთია მთელ ფაილზე, request — მიმდინარე ტესტის */
  use(request: APIRequestContext): this {
    this.request = request;
    return this;
  }

  /** ადმინი ქმნის merchant-ს (BALANCE flow, Identification Number = ident) შემდეგი თავისუფალი ნომრით */
  async create(): Promise<this> {
    const token = await new AdminAuthPage(this.request).authenticate();
    let phone = await this.nextFreePhone();
    for (let attempt = 0; attempt < 5; attempt++, phone++) {
      const data = {
        merchantType: 'MERCHANT', name: `QA RS Merchant ${digits(4)}`, officialName: this.officialName, personalNumber: this.ident,
        iban: IBAN, email: `qa.rs.${digits(6)}@mailinator.com`, saleId: 17, accountManagerId: 720, commissionType: 'SENDER', distributionFlow: 'BALANCE',
        phoneNumberDetails: { phoneNumber: String(phone), countryCode: '995' }, branchName: 'QA RS Branch', merchantGroupId: 278, geoMask: false, isMock: true,
      };
      const res = await this.request.post(`${ADMIN}/api/v1/merchant/createMerchant`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { merchantData: { name: 'blob', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) } },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok() && attempt < 4) continue; // ნომერი დაკავებული აღმოჩნდა → შემდეგი
      const v = body?.value;
      assertCondition(OP_CREATE, res.ok() && v?.identificationNumber === this.ident, `HTTP ${res.status()}: ${body?.message ?? ''}`, `HTTP 2xx, identificationNumber ${this.ident}`, body);
      const flow = v.branchDTOSet?.[0]?.distributionFlow;
      assertCondition(OP_CREATE, flow === 'BALANCE', `distributionFlow ${flow}`, 'BALANCE flow — ფული ბალანსზე რჩება (STANDARD-ზე ყადაღა ვერაფერს გაყინავს)', v.branchDTOSet);
      Object.assign(this, { id: v.databaseId, phone: String(phone), name: v.name });
      await this.verify(token);
      console.log(`✅ Merchant ${this.name} — 995${this.phone}, ident ${this.ident}, BALANCE flow, Temporary Verified (${this.id})`);
      return this;
    }
    throw new Error('unreachable');
  }

  async balance(): Promise<number> {
    const res = await this.request.get(`${WALLETPORTAL}/balances`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    const body = await res.json().catch(() => ({}));
    assertCondition(OP_BALANCE, res.ok(), `HTTP ${res.status()}`, 'HTTP 200', body);
    return round((body.value || []).find((b: any) => b.currency === 'GEL')?.amount ?? 0);
  }

  /** add money ბარათით (💳 + ბანკის OTP) → ახალი ბალანსი (add money-ზე საკომისიოა: 0.6 → +0.59) */
  async addMoney(amount: number): Promise<number> {
    this.guard(amount);
    const before = await this.balance();
    await new RefundReportsHelper(this.request).addMoneyTopUp(this.phone, amount, 'GEL');
    const after = await this.waitBalance((b) => b > before, `add money ${amount} → ბალანსი > ${before}`);
    console.log(`✅ Merchant add money ${amount} → balance ${before} → ${after}`);
    return after;
  }

  /** გატანა merchant-ის IBAN-ზე */
  async cashOut(amount: number): Promise<ApiResult> {
    const res = await this.request.post(`${WALLETPORTAL}/cash-out?merchantId=${this.id}`, {
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      data: { amount: amount.toFixed(2), currencyCode: 'GEL', iban: IBAN },
    });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status(), body, value: body?.value };
  }

  /** გატანა გადის (2xx) → ბალანსი −amount */
  async expectCashOutOk(amount: number) {
    const before = await this.balance();
    const res = await this.cashOut(amount);
    assertCondition(OP_CASH_OUT, res.status >= 200 && res.status < 300, `HTTP ${res.status}, code ${res.body?.statusCode}: ${res.body?.message}`,
      `${amount} ₾ — HTTP 2xx (თავისუფალი თანხა საკმარისია)`, res.body);
    await this.waitBalance((b) => b === round(before - amount), `ბალანსი ${before} − ${amount}`);
    console.log(`✅ Merchant cash-out ${amount} ₾ OK — balance ${round(before - amount)}`);
  }

  /** გატანა თავისუფალზე მეტის → 412 / 2501, ბალანსი უცვლელი */
  async expectCashOutRejected(amount: number) {
    const before = await this.balance();
    const res = await this.cashOut(amount);
    assertCondition(OP_CASH_OUT, res.status === 412 && res.body?.statusCode === 2501, `HTTP ${res.status}, code ${res.body?.statusCode}`,
      `${amount} ₾ — HTTP 412 / code 2501 (გაყინულ ფულს ვერ გაიტანს)`, res.body);
    assertCondition(OP_BALANCE, (await this.balance()) === before, 'ბალანსი შეიცვალა', `ბალანსი უცვლელი ${before}`, null);
    console.log(`✅ Merchant cash-out ${amount} ₾ rejected (2501)`);
  }

  /**
   * ბალანსი ზუსტად `target`: მეტია → ზედმეტის გატანა · ნაკლებია → add money (💳 OTP), მერე ზედმეტის გატანა
   *   (ყადაღა / ინკასო ამ დროს არ უნდა იყოს — გატანა მთელ თავისუფალს იღებს)
   */
  async setBalance(target: number) {
    this.guard(target);
    let b = await this.balance();
    if (b < target) b = await this.addMoney(Math.min(MAX_AMOUNT, round(target - b + 0.05)));
    if (b > target) {
      const res = await this.cashOut(round(b - target));
      assertCondition(OP_CASH_OUT, res.status >= 200 && res.status < 300, `HTTP ${res.status}: ${res.body?.message}`, `ზედმეტის (${round(b - target)}) გატანა`, res.body);
      b = await this.waitBalance((x) => x === round(target), `ბალანსი ${target}`);
    }
    assertCondition(OP_BALANCE, b === round(target), `ბალანსი ${b}`, `ბალანსი ${target}`, null);
  }

  /** ტესტის ბოლოს: მთელი ბალანსის გატანა → 0 (ფული ერთჯერად merchant-ზე არ რჩება) */
  async drain() {
    const b = await this.balance();
    if (b > 0) {
      const res = await this.cashOut(b);
      assertCondition(OP_CASH_OUT, res.status >= 200 && res.status < 300, `HTTP ${res.status}: ${res.body?.message}`, `მთელი ბალანსის (${b}) გატანა`, res.body);
      await this.waitBalance((x) => x === 0, 'ბალანსი 0');
    }
    console.log(`✅ Merchant ${this.phone} drained: ${b} → 0`);
  }

  /** RS რეგისტრაციის body-ს enrollment — merchant-ის wallet */
  enrollment() {
    return { integratorCode: 'payment-service', holderRef: `MERCHANT:${this.id}`, holderKind: 'MERCHANT' };
  }

  // ─── შიდა ───

  /**
   * ახალი merchant ვერიფიცირებული არ არის → ადმინი ანიჭებს Temporary Verified-ს (როგორც UI-დან ხელით):
   *   GET /merchant/{id} → PUT /merchant/update (multipart blob) generalVerificationStatus TEMPORARY_VERIFIED, isVerified true
   */
  private async verify(token: string) {
    const headers = { Authorization: `Bearer ${token}` };
    const current = (await (await this.request.get(`${ADMIN}/api/v1/merchant/${this.id}`, { headers })).json().catch(() => ({}))).value || {};
    // GET აბრუნებს saleId / accountManagerId / merchantGroupId-ს ობიექტად ({id, name}), update ელოდება id-ს ტექსტად
    const idOf = (x: any) => (x && typeof x === 'object' ? String(x.id) : x);
    // ⚠️ update მთელ merchant-ს გადაწერს: GET-ს ~20 ველი აკლია (isActive, isLocked, …) → არასრული payload → merchant BLOCKED (შესვლა 3050).
    //    ამიტომ საფუძველი — სრული update-ის შაბლონი (ყველა ველი), ზემოდან — ამ merchant-ის მონაცემები
    const payload = {
      ...MERCHANT_599000555, ...current, merchantId: this.id, databaseId: this.id, marketplaceId: null, documentNames: [], details: MERCHANT_599000555.details,
      saleId: idOf(current.saleId), accountManagerId: idOf(current.accountManagerId), merchantGroupId: idOf(current.merchantGroupId),
      phoneNumberDetails: { phoneNumber: this.phone, countryCode: '995' }, phoneNumber: this.phone, countryCode: '995',
      personalNumber: this.ident, iban: IBAN, isActive: true, isLocked: false, status: 'ACTIVE',
      generalVerificationStatus: 'TEMPORARY_VERIFIED', isVerified: true,
    };
    const res = await this.request.put(`${ADMIN}/api/v1/merchant/update`, {
      headers, multipart: { merchantData: { name: 'blob', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) } },
    });
    const after = (await (await this.request.get(`${ADMIN}/api/v1/merchant/${this.id}`, { headers })).json().catch(() => ({}))).value || {};
    assertCondition('PUT /api/v1/merchant/update (Temporary Verified)',
      res.ok() && after.generalVerificationStatus === 'TEMPORARY_VERIFIED' && after.isVerified === true && after.status === 'ACTIVE',
      `HTTP ${res.status()}, status ${after.status}, verification ${after.generalVerificationStatus}, isVerified ${after.isVerified}`,
      'status ACTIVE (არ დაიბლოკა), generalVerificationStatus TEMPORARY_VERIFIED, isVerified true', await res.text().catch(() => ''));
  }

  private async token(): Promise<string> {
    if (!this.accessToken) this.accessToken = await new AuthDevicePage(this.request).authenticate(this.phone);
    return this.accessToken;
  }

  /** პირველი ნომერი, რომელზეც merchant ჯერ არ არის (ნომრები რიგრიგობით გამოიყენება → ორობითი ძებნა) */
  private async nextFreePhone(): Promise<number> {
    const auth = new AuthDevicePage(this.request);
    const taken = async (n: number) => (await (await auth.checkPhone(String(n), '995')).json().catch(() => ({})))?.value?.businessExists === true;
    let lo = PHONE_FIRST, hi = PHONE_LAST + 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (await taken(mid)) lo = mid + 1; else hi = mid;
    }
    assertCondition('სატესტო ნომრები', lo <= PHONE_LAST, 'ყველა ნომერი გამოყენებულია', `თავისუფალი ნომერი ${PHONE_FIRST}–${PHONE_LAST}`, null);
    return lo;
  }

  private async waitBalance(ok: (b: number) => boolean, why: string): Promise<number> {
    let last = NaN;
    for (const until = Date.now() + TIMEOUT; Date.now() < until; await sleep(2000)) {
      last = await this.balance();
      if (ok(last)) return last;
    }
    assertCondition(OP_BALANCE, false, `ბალანსი ${last}`, why, { balance: last });
    return last;
  }

  private guard(amount: number) {
    assertCondition('ტესტის კონფიგი', amount > 0 && amount <= MAX_AMOUNT, `${amount} ₾`, `0 < თანხა ≤ ${MAX_AMOUNT} ₾ (რეალური ფული)`, amount);
  }
}

