import { APIRequestContext, Page } from '@playwright/test';
import { RsFrontHelper } from './RsFrontHelper';
import { RsHubApi, date, digits } from '../RsHubApi';
import { RsBusinessHelper } from '../RsBusinessHelper';
import { RsClientHelper } from '../RsClientHelper';
import { RsFreshMerchant } from '../RsFreshMerchant';
import { assertCondition } from '../../../assertions';

const OP_MODAL = 'UI RS registrations — Register to RS';
const OP_MTAB = 'UI Merchant → RS ტაბი';
const OP_PANEL = 'UI Dist. Businesses — RS registration პანელი';
const OP_REG = 'GET /api/v1/rs/registrations/{id}';
const OP_LOOKUP = 'GET /api/v1/rs/registrations/lookup';
const OP_CREATE = 'POST /api/v1/rs/registrations';

const HINT = 'Distributor hub wallets are registered through their business';
const CREATED = 'Registration created';
const ERR_OTHER_TAXPAYER = "This wallet is already linked to another taxpayer's RS registration.";
const ERR_OPEN_EXISTS = 'An open registration already exists for this identification number';
const NOT_REGISTERED = 'Not registered with RS.';

/**
 * RS ფრონტი — რეგისტრაცია (ფრონტის განახლება 10.11):
 *   📋 Register to RS (RS registrations გვერდი): Wallet type მხოლოდ "No wallet" / "Payment merchant"; hub wallet-ები — ბიზნესიდან (ბმული)
 *   📋 merchant-ის გვერდი → RS ტაბი: "Not registered with RS." + Register to RS (merchant წინასწარ არჩეულია) / რეგისტრაციის სტატუსი + Open registration
 *   📋 ბიზნესის გვერდი → RS პანელი: Refresh · Open registration · Submit to RS; Register ღილაკი ამოღებულია
 *   ⚠️ ახალი merchant — ნომრების pool-იდან (995300000001…, OTP 111111) — შენი SMS არ სჭირდება
 */
export class RsFrontRegisterHelper extends RsFrontHelper {
  constructor(page: Page, private req: APIRequestContext) {
    super(page, req);
  }

  // ─── Register to RS ფანჯარა ───

  /** Wallet type: მხოლოდ "No wallet" / "Payment merchant" (Distributor hub აღარ არის) → მინიშნება + ბმული → Dist. Businesses */
  async walletTypeOptions() {
    await this.ui.login();
    await this.ui.openRegisterToRs();
    const options = await this.ui.registerWalletTypes();
    assertCondition(OP_MODAL, options.join(' · ') === 'No wallet · Payment merchant', `Wallet type: ${options.join(' · ')}`, 'No wallet · Payment merchant', options);
    const text = await this.ui.registerModalText();
    assertCondition(OP_MODAL, text.includes(HINT), 'მინიშნება არ ჩანს', `"${HINT}…"`, text);
    await this.ui.modal().getByRole('link', { name: /Businesses/ }).click();
    await this.ui.page.waitForURL(/\/distribution-hub-businesses/);
    console.log(`✅ Wallet type: ${options.join(' · ')}; hint link → ${this.ui.page.url()}`);
  }

  /**
   * Payment merchant: ძებნა ident-ით → "სახელი · ident" → არჩევა → Owner full name / ident ივსება → Save and review →
   *   "Registration created", რეგისტრაციის გვერდი + Submit to RS ფანჯარა (DATA TO SEND = ჩვენი მონაცემები) → API: NOT_SUBMITTED, merchant-ის wallet ACTIVE
   */
  async registerMerchant() {
    const m = await this.freshMerchant();
    await this.ui.login();
    await this.ui.openRegisterToRs();
    await this.ui.selectRegisterWalletType('Payment merchant');
    const options = await this.ui.searchRegisterMerchant(m.ident);
    assertCondition(OP_MODAL, options.some((o) => o === `${m.name} · ${m.ident}`), `ჩამონათვალი: ${options.join(' || ')}`, `"${m.name} · ${m.ident}"`, options);
    const v = await this.ui.registerFormValues();
    assertCondition(OP_MODAL, v.identNumber?.value === m.ident && !!v.ownerFullName?.value, `ident ${v.identNumber?.value}, owner ${v.ownerFullName?.value}`,
      `merchant-ის არჩევისას ივსება: ident ${m.ident}, Owner full name`, v);
    await this.ui.fillRegisterForm({ ownerFullName: m.officialName, operDate: date(30), knownDate: date(10) });
    const regId = await this.expectCreated(await this.ui.saveAndReview(), m.ident, m.officialName);
    await this.expectMerchantEnrolled(regId, m);
    await this.cancel(regId);
    console.log(`✅ Register to RS (Payment merchant ${m.name}) → registration ${regId} NOT_SUBMITTED, merchant wallet ACTIVE`);
  }

  /** Payment merchant, merchant არ არის არჩეული → Save and review → Merchant: "Field is required", რეგისტრაცია არ იქმნება */
  async merchantRequired() {
    const ident = `9${digits(8)}`;
    await this.ui.login();
    await this.ui.openRegisterToRs();
    await this.ui.selectRegisterWalletType('Payment merchant');
    await this.ui.fillRegisterForm({ ownerFullName: 'QA RS NoMerchant', identNumber: ident, operDate: date(30), knownDate: date(10) });
    const r = await this.ui.saveAndReview();
    assertCondition(OP_MODAL, r.errors.includes('Field is required') && !r.toast.includes(CREATED) && !/rs-registrations\/[0-9a-f-]{36}/.test(r.url),
      `errors: ${r.errors || '-'} · toast: ${r.toast || '-'} · ${r.url}`, 'Merchant: "Field is required", რეგისტრაცია არ იქმნება', r);
    await this.expectNoRegistration(ident);
    console.log('✅ Payment merchant without merchant → "Field is required"');
  }

  /** ბიზნესს (hub wallet) უკვე აქვს რეგისტრაცია → merchant იგივე ident-ით → Register to RS → იგივე რეგისტრაცია (ახალი არ იქმნება), 2 wallet */
  async merchantJoinsBusinessRegistration() {
    const { business, regId } = await this.businessWithDraft();
    const m = await this.freshMerchant(business.identificationNumber, business.ownerFullName);
    await this.ui.login();
    await this.ui.openRegisterToRs();
    await this.ui.selectRegisterWalletType('Payment merchant');
    await this.ui.searchRegisterMerchant(m.ident);
    await this.ui.fillRegisterForm({ ownerFullName: business.ownerFullName, operDate: date(30), knownDate: date(10) });
    const got = await this.expectCreated(await this.ui.saveAndReview(), m.ident, business.ownerFullName);
    assertCondition(OP_MODAL, got === regId, `რეგისტრაცია ${got}`, `ბიზნესის რეგისტრაცია ${regId} (ერთი გადამხდელი — ერთი ღია რეგისტრაცია)`, null);
    const v = await this.expectMerchantEnrolled(regId, m);
    const active = v.enrollments.filter((e: any) => e.status === 'ACTIVE');
    assertCondition(OP_REG, active.length === 2, `${active.length} wallet`, '2 wallet: CLIENT (distributor-hub) + MERCHANT (payment-service)', v.enrollments);
    console.log(`✅ Merchant ${m.name} joined business registration ${regId} — 2 wallets`);
  }

  /** merchant უკვე მიბმულია სხვა გადამხდელის ღია რეგისტრაციაზე → სხვა ident-ით Register to RS → შეცდომა, რეგისტრაცია არ იქმნება */
  async merchantLinkedToOtherTaxpayer() {
    const m = await this.freshMerchant();
    RsHubApi.expectOk(OP_CREATE, await this.api.createRegistration({
      partnerCode: 'keepz', submit: false, enrollment: m.enrollment(),
      data: { residency: 'RESIDENT', identNumber: m.ident, ownerFullName: m.officialName, operDate: date(30), knownDate: date(10) },
    }));
    const other = `9${digits(8)}`;
    await this.ui.login();
    await this.ui.openRegisterToRs();
    await this.ui.selectRegisterWalletType('Payment merchant');
    await this.ui.searchRegisterMerchant(m.ident);
    await this.ui.fillRegisterForm({ ownerFullName: 'QA RS Other Taxpayer', identNumber: other, operDate: date(30), knownDate: date(10) });
    const r = await this.ui.saveAndReview();
    assertCondition(OP_MODAL, r.toast.includes(ERR_OTHER_TAXPAYER) && r.errors.includes(ERR_OTHER_TAXPAYER) && !r.toast.includes(CREATED),
      `toast: ${r.toast || '-'} · errors: ${r.errors || '-'}`, `toast + Merchant ველთან: "${ERR_OTHER_TAXPAYER}"`, r);
    await this.expectNoRegistration(other);
    console.log(`✅ Merchant linked to ${m.ident} → other ident ${other} rejected`);
  }

  /** No wallet + ახალი ident → "Registration created", რეგისტრაცია wallet-ის გარეშე (0 wallet) */
  async noWalletNewIdent() {
    const ident = `9${digits(8)}`;
    const owner = `QA RS NoWallet ${digits(4)}`;
    await this.ui.login();
    await this.ui.openRegisterToRs();
    await this.ui.fillRegisterForm({ ownerFullName: owner, identNumber: ident, operDate: date(30), knownDate: date(10) });
    const regId = await this.expectCreated(await this.ui.saveAndReview(), ident, owner);
    const v = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(regId));
    assertCondition(OP_REG, v.registration.status === 'NOT_SUBMITTED' && v.enrollments.length === 0, `${v.registration.status}, ${v.enrollments.length} wallet`, 'NOT_SUBMITTED, 0 wallet', v);
    await this.cancel(regId);
    console.log(`✅ No wallet → registration ${regId} without wallets`);
  }

  /** No wallet + ident, რომელსაც ღია რეგისტრაცია აქვს → "An open registration already exists…", ახალი არ იქმნება */
  async noWalletOpenIdent() {
    const { business, regId } = await this.businessWithDraft();
    await this.ui.login();
    await this.ui.openRegisterToRs();
    await this.ui.fillRegisterForm({ ownerFullName: 'QA RS Dup', identNumber: business.identificationNumber, operDate: date(30), knownDate: date(10) });
    const r = await this.ui.saveAndReview();
    assertCondition(OP_MODAL, r.toast.includes(ERR_OPEN_EXISTS) && r.errors.includes(ERR_OPEN_EXISTS) && !r.toast.includes(CREATED),
      `toast: ${r.toast || '-'} · errors: ${r.errors || '-'}`, `toast + ident ველთან: "${ERR_OPEN_EXISTS}"`, r);
    const again = RsHubApi.expectOk(OP_LOOKUP, await this.api.lookupRegistration({ identNumber: business.identificationNumber }));
    assertCondition(OP_LOOKUP, again.registration.id === regId, `lookup → ${again.registration.id}`, `იგივე რეგისტრაცია ${regId}`, again.registration);
    console.log(`✅ No wallet, ident ${business.identificationNumber} with open registration → rejected`);
  }

  // ─── merchant-ის RS ტაბი ───

  /**
   * ახალი merchant → RS ტაბი: "Not registered with RS." + Register to RS → ფანჯარა: Payment merchant და merchant წინასწარ არჩეული (გამორთული),
   *   Owner / ident ივსება → Save and review → "Registration created" → RS ტაბი: Not submitted, Owner, Open registration → რეგისტრაციის გვერდი
   */
  async registerFromMerchantTab() {
    const m = await this.freshMerchant();
    await this.ui.login();
    const before = await this.ui.openMerchantRsTab(m.id);
    assertCondition(OP_MTAB, before.includes(NOT_REGISTERED) && before.includes('Register to RS'), `ტაბი: ${before}`, `"${NOT_REGISTERED}" + Register to RS`, before);
    await this.ui.registerFromMerchantTab();
    const v = await this.ui.registerFormValues();
    const picked = Object.values(v).find((x) => x.value === `${m.name} · ${m.ident}`);
    assertCondition(OP_MTAB, v.holderKind?.value === 'MERCHANT' && v.holderKind.disabled && !!picked?.disabled && v.identNumber?.value === m.ident,
      JSON.stringify({ holderKind: v.holderKind, merchant: picked, ident: v.identNumber }), `Payment merchant + "${m.name} · ${m.ident}" (გამორთული), ident ${m.ident}`, v);
    await this.ui.fillRegisterForm({ ownerFullName: m.officialName, operDate: date(30), knownDate: date(10) });
    const regId = await this.expectCreated(await this.ui.saveAndReview(), m.ident, m.officialName);
    await this.expectMerchantEnrolled(regId, m);
    const after = await this.ui.openMerchantRsTab(m.id);
    assertCondition(OP_MTAB, after.includes('Not submitted') && after.includes(`Owner full name | ${m.officialName}`) && after.includes('Open registration'),
      `ტაბი: ${after}`, `Not submitted · Owner full name ${m.officialName} · Open registration`, after);
    await this.ui.page.getByRole('button', { name: 'Open registration' }).click();
    await this.ui.page.waitForURL(new RegExp(`/rs-registrations/${regId}`));
    await this.cancel(regId);
    console.log(`✅ Merchant RS tab: Not registered → Register to RS → ${regId} Not submitted → Open registration`);
  }

  // ─── ბიზნესის RS პანელი ───

  /**
   * ბიზნესი + wallet (რეგისტრაცია Not submitted) → პანელი: Refresh · Open registration · Submit to RS →
   *   Submit to RS → ფანჯარა (DATA TO SEND) → "Submitted to RS" → Pending RS approval → RS ადასტურებს → Refresh → Approved, თარიღები = API
   */
  async businessPanelSubmitAndRefresh() {
    const { business, regId } = await this.businessWithDraft();
    await this.ui.login();
    await this.ui.openBusiness(business.id);
    const p1 = await this.ui.businessRsPanel();
    assertCondition(OP_PANEL, /RS registration \| Refresh \| Open registration \| Submit to RS \| Not submitted/.test(p1) && !p1.includes('Register to RS'),
      `პანელი: ${p1}`, 'Refresh · Open registration · Submit to RS · Not submitted (Register to RS აღარ არის)', p1);
    const modal = await this.ui.submitToRs();
    assertCondition(OP_PANEL, modal.includes(`"ownerIdentNumber": "${business.identificationNumber}"`) && modal.includes(`"ownerFullName": "${business.ownerFullName}"`),
      `ფანჯარა: ${modal}`, `DATA TO SEND: ident ${business.identificationNumber}, owner ${business.ownerFullName}`, modal);
    assertCondition(OP_PANEL, await this.ui.toast('Submitted to RS'), 'toast არ გამოჩნდა', 'toast "Submitted to RS"', null);
    await this.ui.openBusiness(business.id);
    const p2 = await this.ui.businessRsPanel();
    assertCondition(OP_PANEL, p2.includes('Pending RS approval') && !p2.includes('| Submit to RS |'), `პანელი: ${p2}`, 'Pending RS approval, Submit to RS აღარ ჩანს', p2);

    await this.sim.approveTaxpayer(business.identificationNumber);
    const r = await this.poll(async () => {
      const x = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(regId)).registration;
      return x.status === 'APPROVED' ? x : undefined;
    }, 60_000, 3000);
    assertCondition(OP_REG, !!r, 'APPROVED არ მოვიდა', 'APPROVED', regId);
    await this.ui.refreshBusinessRsPanel();
    const p3 = await this.poll(async () => {
      const t = await this.ui.businessRsPanel();
      // სტატუსი "Open registration"-ის შემდეგ მოდის ("Approved | <თარიღი>" — ცალკე ველია)
      return /Open registration \| Approved \|/.test(t) ? t : (await this.ui.refreshBusinessRsPanel(), undefined);
    }, 30_000, 2000);
    assertCondition(OP_PANEL, !!p3 && !p3.includes('First submitted | - |') && !p3.includes('Approved | - |'), `პანელი: ${p3 ?? await this.ui.businessRsPanel()}`,
      'Refresh → Approved, First submitted და Approved თარიღით', r);
    console.log(`✅ Business RS panel: Submit to RS → Pending → Refresh → Approved (${regId})`);
  }

  // ─── შიდა ───

  private async freshMerchant(ident = `9${digits(8)}`, owner = `QA RS Owner ${digits(4)}`) {
    return new RsFreshMerchant(this.req, ident, owner).create();
  }

  /** ბიზნესი + hub wallet (API) → რეგისტრაცია თავისით (Not submitted) */
  private async businessWithDraft() {
    const business = RsHubApi.expectOk('POST /api/distributor-hub-business', await this.api.createBusiness(RsBusinessHelper.buildBody({ residency: 'RESIDENT' })));
    const client = RsHubApi.expectOk('POST /api/distributor-hub-client', await this.api.createClient(RsClientHelper.buildBody('WALLET', business.id, { clientName: `QA UI Wallet ${digits(6)}` })));
    const reg = await this.poll(async () => (await this.api.lookupRegistration({ identNumber: business.identificationNumber })).value?.registration, 120_000, 4000);
    assertCondition(OP_LOOKUP, reg?.status === 'NOT_SUBMITTED', `${reg?.status ?? 'არ შეიქმნა'}`, 'wallet-ის მიბმისას რეგისტრაცია თავისით: NOT_SUBMITTED', business.identificationNumber);
    return { business, client, regId: reg.id as string };
  }

  /** Save and review → "Registration created", რეგისტრაციის გვერდი, Submit to RS ფანჯარა ჩვენი მონაცემებით → რეგისტრაციის id */
  private async expectCreated(r: { toast: string; errors: string; url: string; modal: string }, ident: string, owner: string): Promise<string> {
    const id = (r.url.match(/rs-registrations\/([0-9a-f-]{36})/) || [])[1];
    assertCondition(OP_MODAL, r.toast.includes(CREATED) && !!id && r.modal.includes('DATA TO SEND') && r.modal.includes(`"ownerIdentNumber": "${ident}"`) && r.modal.includes(`"ownerFullName": "${owner}"`),
      `toast: ${r.toast || '-'} · errors: ${r.errors || '-'} · ${r.url} · ${r.modal.slice(0, 300)}`, `"${CREATED}" → რეგისტრაციის გვერდი, Submit to RS: ident ${ident}, owner ${owner}`, r);
    await this.ui.modal().getByRole('button', { name: 'Cancel' }).click();
    return id;
  }

  private async expectMerchantEnrolled(regId: string, m: RsFreshMerchant) {
    let last: any;
    const ok = await this.poll(async () => {
      last = RsHubApi.expectOk(OP_REG, await this.api.getRegistration(regId));
      return last.enrollments.some((e: any) => e.holderRef === `MERCHANT:${m.id}` && e.integrator === 'payment-service' && e.status === 'ACTIVE') ? last : undefined;
    }, 120_000, 4000);
    assertCondition(OP_REG, !!ok, JSON.stringify(last?.enrollments?.map((e: any) => [e.holderRef, e.integrator, e.status])),
      `MERCHANT:${m.id} (payment-service) ACTIVE`, last?.enrollments);
    return ok;
  }

  private async expectNoRegistration(ident: string) {
    const res = await this.api.lookupRegistration({ identNumber: ident });
    assertCondition(OP_LOOKUP, !res.value?.registration, `რეგისტრაცია ${res.value?.registration?.id} (${res.value?.registration?.status})`, `ident ${ident}-ზე რეგისტრაცია არ შეიქმნა`, res.value);
  }

  /** ტესტის ბოლოს: Not submitted რეგისტრაცია → გაუქმება (merchant თავისუფლდება) */
  private async cancel(regId: string) {
    await this.api.cancelRegistration(regId, { confirmation: 'delete', submittedByMistake: false, note: 'QA front autotest' }).catch(() => undefined);
  }
}
