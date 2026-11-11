import { APIRequestContext } from '@playwright/test';
import { RsHubApi, ApiResult, Residency, digits, date, randomCompanyName } from './RsHubApi';
import { RsBusinessHelper } from './RsBusinessHelper';
import { RsClientHelper } from './RsClientHelper';
import { assertCondition, assertField, assertKeysPresent } from '../../assertions';

const OP_CREATE = 'POST /api/v1/rs/registrations';
const OP_GET = 'GET /api/v1/rs/registrations/{id}';
const OP_UPDATE = 'PUT /api/v1/rs/registrations/{id}';
const OP_SUBMIT = 'POST /api/v1/rs/registrations/{id}/submit';
const OP_SUBMIT_CHANGES = 'POST /api/v1/rs/registrations/{id}/submit-changes';
const OP_CANCEL = 'POST /api/v1/rs/registrations/{id}/cancel';
const OP_BIZ_UPDATE = 'PUT /api/distributor-hub-business/{id}';
const OP_UNLINK = 'DELETE /api/distributor-hub-business/{id}/clients/{clientId}';

const REG_KEYS = ['id', 'partner', 'clientUuid', 'clientNo', 'status', 'data', 'dataDiffersFields'];
const PARTNER = 'keepz';
const INTEGRATOR = 'distributor-hub';
/** dev-ზე RS სიმულატორი რეგისტრაციას ~30 წმ-ში ამტკიცებს */
const APPROVE_TIMEOUT = 60_000;
/** hub-ის RS job (enrollment / ENROLLMENT_ENDED) — ~2 წთ */
const HUB_JOB_TIMEOUT = 150_000;

/** dataDiffersFields API-დან JSON-ტექსტად მოდის ("[\"ownerFullName\"]") ან null → მასივი */
const differs = (reg: any): string[] => {
  const v = reg?.dataDiffersFields;
  return !v ? [] : Array.isArray(v) ? v : JSON.parse(v);
};

/** მოსალოდნელი უარი: HTTP + Keepz / rs-service statusCode */
export interface Rejection {
  http: number;
  code: number;
}

export type ApprovedEdit = 'rename' | 'altNumber';
export type RegistrationRejectCase =
  | 'walletOtherIdent' | 'sameIdentNoWallet' | 'submitTwice' | 'submitChangesNothing'
  | 'residencyAfterSubmit' | 'businessResidencyAfterSubmit' | 'cancelWrongConfirmation'
  | 'cancelTwice' | 'editCancelled' | 'futureOperDate' | 'businessFutureOperDate';

/**
 * RS რეგისტრაცია (rs-service ადმინ პანელიდან) — Register to RS / submit / edit / submit changes / cancel + wallet enrollment.
 *   📋 Resident — RS იცნობს ident-ით (clientNo არ აქვს); Foreign — clientNo 10 სიმბოლო.
 *   📋 NOT_SUBMITTED → submit → PENDING_RS_APPROVAL → (სიმულატორი ~30 წმ) → APPROVED.
 *   📋 APPROVED: residency ჩაკეტილია; RS-ში გაგზავნილი ველის ცვლილება → dataDiffersFields → submit-changes.
 *   📋 ერთი wallet = ერთი გადამხდელი (7021); Cancel ხურავს enrollment-ებს და wallet თავისუფლდება.
 * Docs: RS Integration Test Guide → api.js (panel-reg-*), data.js (RSR-*, ENR-*, BIZ-24)
 */
export class RsRegistrationHelper {
  private api: RsHubApi;

  constructor(request: APIRequestContext) {
    this.api = new RsHubApi(request);
  }

  /** რეგისტრაციის data (api.js → panel-reg-create) */
  static buildData(residency: Residency, overrides: any = {}): any {
    const base = residency === 'RESIDENT'
      ? { residency, identNumber: `9${digits(8)}`, ownerFullName: randomCompanyName(), operDate: date(30), knownDate: date(10) }
      : {
        residency, ownerFullName: randomCompanyName(), operDate: date(30),
        legalAddressCountry: 'Germany', legalAddressCity: 'Berlin', legalAddressLine: 'Friedrichstrasse 1',
        actualAddressCountry: 'Germany', actualAddressCity: 'Berlin', actualAddressLine: 'Friedrichstrasse 1',
      };
    return { ...base, ...overrides };
  }

  // ─── Positive ───

  /**
   * Register to RS (submit: false) → NOT_SUBMITTED.
   *   Resident: clientNo = null · Foreign: clientNo 10 სიმბოლო.
   *   withWallet: ახალი WALLET კლიენტი → enrollments[]-ში CLIENT:<id>, ACTIVE.
   */
  async register(residency: Residency, withWallet: boolean) {
    const walletId = withWallet ? await this.newWallet() : undefined;
    const reg = await this.create(RsRegistrationHelper.buildData(residency), walletId);

    if (residency === 'RESIDENT') {
      assertCondition(OP_CREATE, reg.clientNo === null || reg.clientNo === undefined,
        `Resident-ზე clientNo მოვიდა: ${reg.clientNo}`, 'clientNo = null (Resident-ს RS ident-ით იცნობს)', reg);
    } else {
      assertCondition(OP_CREATE, typeof reg.clientNo === 'string' && reg.clientNo.length === 10,
        `Foreign-ზე clientNo არასწორია: ${reg.clientNo}`, 'clientNo — 10 სიმბოლო', reg);
    }
    if (walletId) await this.expectEnrollment(reg.id, walletId, 'ACTIVE');
    return reg;
  }

  /** submit → PENDING_RS_APPROVAL → სიმულატორი → APPROVED (HONEST_TAX_PAYER) */
  async submitAndApprove() {
    const reg = await this.create(RsRegistrationHelper.buildData('RESIDENT'));
    const pending = RsHubApi.expectOk(OP_SUBMIT, await this.api.submitRegistration(reg.id));
    assertField(OP_SUBMIT, pending, 'status', 'PENDING_RS_APPROVAL');

    const approved = await this.waitApproved(reg.id);
    assertField(OP_GET, approved, 'approvalSource', 'HONEST_TAX_PAYER');
    assertCondition(OP_GET, !!approved.firstSubmittedAt && !!approved.approvedAt,
      'firstSubmittedAt / approvedAt ცარიელია', 'ორივე თარიღი შევსებულია', approved);
    console.log(`✅ Approved — ${reg.id}`);
  }

  /**
   * APPROVED რეგისტრაციის რედაქტირება:
   *   rename    — ownerFullName → dataDiffersFields = [ownerFullName], fieldChanges +1 → submit-changes → ახალი NEW_CLIENT, differs სუფთავდება
   *   altNumber — personalNumberAlt RS-ში არ იგზავნება → dataDiffersFields ცარიელი რჩება
   */
  async editApproved(edit: ApprovedEdit) {
    const { reg, data } = await this.approvedRegistration();

    if (edit === 'altNumber') {
      const updated = RsHubApi.expectOk(OP_UPDATE, await this.api.updateRegistration(reg.id, { ...data, personalNumberAlt: `9${digits(8)}` }));
      assertCondition(OP_UPDATE, differs(updated).length === 0,
        `dataDiffersFields: ${JSON.stringify(updated.dataDiffersFields)}`, 'ცარიელი — alt. ნომერი RS-ში არ იგზავნება', updated);
      console.log(`✅ Alt. number changed — no data differs · ${reg.id}`);
      return;
    }

    const before = RsHubApi.expectOk(OP_GET, await this.api.getRegistration(reg.id));
    const newName = randomCompanyName();
    const updated = RsHubApi.expectOk(OP_UPDATE, await this.api.updateRegistration(reg.id, { ...data, ownerFullName: newName }));
    assertField(OP_UPDATE, updated.data, 'ownerFullName', newName);
    assertCondition(OP_UPDATE, JSON.stringify(differs(updated)) === '["ownerFullName"]',
      `dataDiffersFields: ${JSON.stringify(updated.dataDiffersFields)}`, '["ownerFullName"]', updated);

    const mid = RsHubApi.expectOk(OP_GET, await this.api.getRegistration(reg.id));
    assertCondition(OP_GET, mid.fieldChanges.length === before.fieldChanges.length + 1,
      `fieldChanges: ${before.fieldChanges.length} → ${mid.fieldChanges.length}`, 'fieldChanges +1 (ownerFullName)', mid.fieldChanges);

    const sent = RsHubApi.expectOk(OP_SUBMIT_CHANGES, await this.api.submitChanges(reg.id));
    assertField(OP_SUBMIT_CHANGES, sent, 'status', 'APPROVED');

    const after = await this.poll(OP_GET, reg.id, (v) => differs(v.registration).length === 0, 15_000,
      'dataDiffersFields სუფთავდება, როცა RS დაადასტურებს (~1 წმ)');
    const newClient = (v: any) => v.messages.filter((m: any) => m.operation === 'NEW_CLIENT').length;
    assertCondition(OP_GET, newClient(after) === newClient(before) + 1,
      `NEW_CLIENT მესიჯები: ${newClient(before)} → ${newClient(after)}`, 'ახალი NEW_CLIENT მესიჯი', after.messages);
    console.log(`✅ Changes submitted to RS — ${reg.id}`);
  }

  /** Edit business (Approved რეგისტრაციით) → ცვლილება რეგისტრაციაშიც იწერება + dataDiffersFields */
  async editBusinessWithRegistration() {
    const { business, reg } = await this.approvedBusiness();
    const newName = randomCompanyName();
    await this.updateBusiness(business.id, { ownerFullName: newName }, true);

    const v = RsHubApi.expectOk(OP_GET, await this.api.getRegistration(reg.id));
    assertField(OP_GET, v.registration.data, 'ownerFullName', newName);
    assertCondition(OP_GET, differs(v.registration).includes('ownerFullName'),
      `dataDiffersFields: ${JSON.stringify(v.registration.dataDiffersFields)}`, 'შეიცავს ownerFullName', v.registration);
    console.log(`✅ Business edit synced to registration — ${reg.id}`);
  }

  /** იგივე wallet + იგივე ident → ახალი რეგისტრაცია არ იქმნება, ბრუნდება არსებული (RSR-07) */
  async sameWalletSameIdent() {
    const walletId = await this.newWallet();
    const data = RsRegistrationHelper.buildData('RESIDENT');
    const first = await this.create(data, walletId);
    const second = await this.create(data, walletId);
    assertField(OP_CREATE, second, 'id', first.id);
    console.log(`✅ Same wallet + same ident → existing registration ${first.id}`);
  }

  /**
   * Cancel → CANCELLED, enrollments CLOSED → wallet თავისუფლდება:
   *   იგივე wallet სხვა ident-ით რეგისტრირდება (7021 აღარ არის).
   */
  async cancelFreesWallet() {
    const walletId = await this.newWallet();
    const reg = await this.create(RsRegistrationHelper.buildData('RESIDENT'), walletId);

    const cancelled = RsHubApi.expectOk(OP_CANCEL, await this.api.cancelRegistration(reg.id,
      { confirmation: 'delete', submittedByMistake: false, note: 'QA autotest' }));
    assertField(OP_CANCEL, cancelled, 'status', 'CANCELLED');
    assertCondition(OP_CANCEL, !!cancelled.cancelledAt, 'cancelledAt ცარიელია', 'cancelledAt შევსებულია', cancelled);
    await this.expectEnrollment(reg.id, walletId, 'CLOSED');

    const again = await this.create(RsRegistrationHelper.buildData('RESIDENT'), walletId);
    assertCondition(OP_CREATE, again.id !== reg.id, 'დაბრუნდა გაუქმებული რეგისტრაცია', 'ახალი რეგისტრაცია', again);
    await this.expectEnrollment(again.id, walletId, 'ACTIVE');
    console.log(`✅ Cancelled ${reg.id} → wallet re-registered ${again.id}`);
  }

  /** ბიზნესზე მიბმული მეორე WALLET კლიენტი ~2 წთ-ში რეგისტრაციის enrollments-ში ჩნდება (ENR-05) — 🐞 KD-2608 */
  async autoEnrollLinkedWallet() {
    const { business, reg } = await this.approvedBusiness();
    const second = await this.newWallet(business.id);
    await this.poll(OP_GET, reg.id, (v) => v.enrollments.some((e: any) => e.holderRef === `CLIENT:${second}` && e.status === 'ACTIVE'),
      HUB_JOB_TIMEOUT, `ბიზნესზე მიბმული WALLET კლიენტი CLIENT:${second} enrollments-შია (ACTIVE) ~2 წთ-ში`);
    console.log(`✅ Auto-enrolled CLIENT:${second} → ${reg.id}`);
  }

  /** Unlink → hub-ი აგზავნის ENROLLMENT_ENDED → enrollment CLOSED (ENR-07) */
  async unlinkEndsEnrollment() {
    const { business, reg, walletId } = await this.approvedBusiness();
    RsHubApi.expectOk(OP_UNLINK, await this.api.unlinkClient(business.id, walletId));
    await this.poll(OP_GET, reg.id, (v) => v.enrollments.some((e: any) => e.holderRef === `CLIENT:${walletId}` && e.status === 'CLOSED'),
      HUB_JOB_TIMEOUT, `CLIENT:${walletId} enrollment CLOSED ~2 წთ-ში`);
    console.log(`✅ Unlinked → enrollment CLOSED · ${reg.id}`);
  }

  // ─── Negative ───

  /** არავალიდური მოქმედება → მოსალოდნელი HTTP + code; არაფერი შეიცვალა */
  async rejected(kind: RegistrationRejectCase, expect: Rejection) {
    switch (kind) {
      case 'walletOtherIdent': {
        const walletId = await this.newWallet();
        await this.create(RsRegistrationHelper.buildData('RESIDENT'), walletId);
        return this.expectRejected(OP_CREATE, await this.api.createRegistration(RsRegistrationHelper.body(RsRegistrationHelper.buildData('RESIDENT'), walletId)), expect);
      }
      case 'sameIdentNoWallet': {
        const data = RsRegistrationHelper.buildData('RESIDENT');
        await this.create(data);
        return this.expectRejected(OP_CREATE, await this.api.createRegistration(RsRegistrationHelper.body(data)), expect);
      }
      case 'submitTwice': {
        const reg = await this.create(RsRegistrationHelper.buildData('RESIDENT'));
        RsHubApi.expectOk(OP_SUBMIT, await this.api.submitRegistration(reg.id));
        return this.expectRejected(OP_SUBMIT, await this.api.submitRegistration(reg.id), expect);
      }
      case 'submitChangesNothing': {
        const { reg } = await this.approvedRegistration();
        return this.expectRejected(OP_SUBMIT_CHANGES, await this.api.submitChanges(reg.id), expect);
      }
      case 'residencyAfterSubmit': {
        const { reg } = await this.approvedRegistration();
        const foreign = RsRegistrationHelper.buildData('FOREIGN', { ownerFullName: reg.data.ownerFullName, identNumber: reg.data.identNumber });
        await this.expectRejected(OP_UPDATE, await this.api.updateRegistration(reg.id, foreign), expect);
        return this.expectUnchanged(reg.id, 'residency', 'RESIDENT');
      }
      case 'businessResidencyAfterSubmit': {
        const { business } = await this.approvedBusiness();
        const foreign = RsRegistrationHelper.buildData('FOREIGN');
        delete foreign.ownerFullName;
        const res = await this.updateBusiness(business.id, foreign, false);
        return this.expectRejected(OP_BIZ_UPDATE, res, expect);
      }
      case 'cancelWrongConfirmation': {
        const reg = await this.create(RsRegistrationHelper.buildData('RESIDENT'));
        await this.expectRejected(OP_CANCEL, await this.api.cancelRegistration(reg.id, { confirmation: 'yes' }), expect);
        return this.expectUnchanged(reg.id, 'status', 'NOT_SUBMITTED');
      }
      case 'cancelTwice': {
        const reg = await this.cancelled();
        return this.expectRejected(OP_CANCEL, await this.api.cancelRegistration(reg.id, { confirmation: 'delete' }), expect);
      }
      case 'editCancelled': {
        const reg = await this.cancelled();
        return this.expectRejected(OP_UPDATE, await this.api.updateRegistration(reg.id, { ...reg.data, ownerFullName: randomCompanyName() }), expect);
      }
      case 'futureOperDate': {
        const data = RsRegistrationHelper.buildData('RESIDENT', { operDate: date(-30), knownDate: date(-30) });
        return this.expectRejected(OP_CREATE, await this.api.createRegistration(RsRegistrationHelper.body(data)), expect);
      }
      case 'businessFutureOperDate': {
        const body = { ...RsBusinessHelper.buildBody({ residency: 'RESIDENT' }), operDate: date(-30), knownDate: date(-30) };
        return this.expectRejected('POST /api/distributor-hub-business', await this.api.createBusiness(body), expect);
      }
    }
  }

  /** Edit business დაკავებული ident-ით → 1481 და რეგისტრაციის ident არ იცვლება (ცნობილი ხარვეზი 11) */
  async businessTakenIdentKeepsRegistration() {
    const { business, reg } = await this.approvedBusiness();
    const other = RsHubApi.expectOk('POST /api/distributor-hub-business',
      await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const res = await this.updateBusiness(business.id, { identificationNumber: other.identificationNumber }, false);
    // KD-2612 გასწორდა (11.11): Approved-ის შემდეგ ident-ის შეცვლა საერთოდ იკრძალება → 409 / 1500 (Not submitted-ზე — 1481); რეგისტრაცია უცვლელია
    await this.expectRejected(OP_BIZ_UPDATE, res, { http: 409, code: 1500 });
    await this.expectUnchanged(reg.id, 'identNumber', reg.data.identNumber);
  }

  // ─── შიდა ───

  /** Register to RS body (api.js → panel-reg-create); walletId → enrollment CLIENT:<id> */
  static body(data: any, walletId?: string) {
    return {
      partnerCode: PARTNER,
      data,
      enrollment: walletId ? { integratorCode: INTEGRATOR, holderRef: `CLIENT:${walletId}`, holderKind: 'CLIENT' } : null,
      submit: false,
    };
  }

  private async create(data: any, walletId?: string) {
    const reg = RsHubApi.expectOk(OP_CREATE, await this.api.createRegistration(RsRegistrationHelper.body(data, walletId)));
    assertKeysPresent(OP_CREATE, reg, REG_KEYS);
    assertField(OP_CREATE, reg, 'status', 'NOT_SUBMITTED');
    assertField(OP_CREATE, reg.data, 'residency', data.residency);
    console.log(`✅ Registration Created — ${data.ownerFullName} · ${data.residency} · ${reg.id}${walletId ? ` · wallet CLIENT:${walletId}` : ''}`);
    return reg;
  }

  /** ახალი WALLET კლიენტი (businessId-ით ან მის გარეშე) → clientId */
  private async newWallet(businessId?: string): Promise<string> {
    const created = RsHubApi.expectOk('POST /api/distributor-hub-client',
      await this.api.createClient(RsClientHelper.buildBody('WALLET', businessId)));
    return created.clientId;
  }

  /** submit + APPROVED რეგისტრაცია (wallet-ის გარეშე) */
  private async approvedRegistration() {
    const data = RsRegistrationHelper.buildData('RESIDENT');
    const reg = await this.create(data);
    RsHubApi.expectOk(OP_SUBMIT, await this.api.submitRegistration(reg.id));
    await this.waitApproved(reg.id);
    return { reg, data };
  }

  /** ბიზნესი + მიბმული WALLET კლიენტი + იმავე ident-ით Register to RS (ამ wallet-ით) → APPROVED */
  private async approvedBusiness() {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business',
      await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    // 09.11-დან wallet-ს რეგისტრაციაზე ვერ ვირჩევთ (1499): wallet ბიზნესზე → რეგისტრაცია თავისით (NOT_SUBMITTED) → submit → APPROVED
    const walletId = await this.newWallet(business.id);
    const until = Date.now() + HUB_JOB_TIMEOUT;
    let found: any;
    while (!found && Date.now() < until) {
      found = (await this.api.lookupRegistration({ identNumber: business.identificationNumber })).value?.registration;
      if (!found) await new Promise((r) => setTimeout(r, 4000));
    }
    assertCondition('GET /api/v1/rs/registrations/lookup', !!found, 'რეგისტრაცია არ შეიქმნა', 'wallet-ის მიბმისას რეგისტრაცია თავისით იქმნება', business.identificationNumber);
    const reg = RsHubApi.expectOk(OP_GET, await this.api.getRegistration(found.id)).registration;
    RsHubApi.expectOk(OP_SUBMIT, await this.api.submitRegistration(reg.id));
    await this.waitApproved(reg.id);
    return { business, reg, walletId };
  }

  private async cancelled() {
    const reg = await this.create(RsRegistrationHelper.buildData('RESIDENT'));
    RsHubApi.expectOk(OP_CANCEL, await this.api.cancelRegistration(reg.id, { confirmation: 'delete', note: 'QA autotest' }));
    return reg;
  }

  /** ბიზნესის PUT — GET-იდან სრული body + version, ცვლილებები ზემოდან (RsBusinessHelper-ის პატერნი) */
  private async updateBusiness(id: string, changes: any, expectOk: boolean): Promise<ApiResult> {
    const current = RsHubApi.expectOk('GET /api/distributor-hub-business/{id}', await this.api.getBusiness(id));
    const body = { ...RsBusinessHelper.updateBody(current), ...changes };
    const res = await this.api.updateBusiness(id, body);
    if (expectOk) RsHubApi.expectOk(OP_BIZ_UPDATE, res);
    return res;
  }

  private async waitApproved(id: string) {
    const v = await this.poll(OP_GET, id, (x) => x.registration.status === 'APPROVED', APPROVE_TIMEOUT,
      'status APPROVED (სიმულატორი ~30 წმ)');
    return v.registration;
  }

  private async expectEnrollment(regId: string, walletId: string, status: 'ACTIVE' | 'CLOSED') {
    const v = RsHubApi.expectOk(OP_GET, await this.api.getRegistration(regId));
    const e = v.enrollments.find((x: any) => x.holderRef === `CLIENT:${walletId}`);
    assertCondition(OP_GET, !!e && e.status === status && e.integrator === INTEGRATOR,
      e ? `enrollment status ${e.status}, integrator ${e.integrator}` : `CLIENT:${walletId} enrollments-ში არ არის`,
      `CLIENT:${walletId} — ${status}, integrator ${INTEGRATOR}`, v.enrollments);
  }

  private async expectUnchanged(regId: string, field: string, expected: any) {
    const v = RsHubApi.expectOk(OP_GET, await this.api.getRegistration(regId));
    assertField(`${OP_GET} (უარის შემდეგ უცვლელი)`, v.registration.data[field] !== undefined ? v.registration.data : v.registration, field, expected);
  }

  /** GET /{id} სანამ პირობა შესრულდება (ან timeout → გასაგები error) */
  private async poll(op: string, id: string, done: (v: any) => boolean, timeout: number, expected: string) {
    const until = Date.now() + timeout;
    let v: any;
    while (true) {
      v = RsHubApi.expectOk(op, await this.api.getRegistration(id));
      if (done(v)) return v;
      if (Date.now() > until) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    assertCondition(op, false, `${Math.round(timeout / 1000)} წმ-ში პირობა არ შესრულდა`, expected, v);
  }

  private async expectRejected(op: string, res: ApiResult, expect: Rejection) {
    const got = `HTTP ${res.status}${res.body?.statusCode ? ` / code ${res.body.statusCode}` : ''}`;
    const why = res.status < 300 ? ' — API-მ მიიღო (უნდა უარეყო)' : res.status >= 500 ? ' — სერვერის შეცდომა (500)' : '';
    assertCondition(op, res.status === expect.http && res.body?.statusCode === expect.code,
      `მოვიდა ${got}${why}`, `HTTP ${expect.http} / code ${expect.code}`, res.body);
    console.log(`✅ Rejected — ${op} → ${got}`);
  }
}
