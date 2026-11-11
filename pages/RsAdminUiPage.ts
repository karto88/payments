import { Page, Locator } from '@playwright/test';

export const DASHBOARD = 'https://dashboard.dev.keepz.me';

export interface BusinessForm {
  residency?: 'RESIDENT' | 'FOREIGN';
  ownerFullName: string;
  identNumber?: string;
  operDate: string;
  knownDate?: string;
  legalAddressCountry?: string;
  legalAddressCity?: string;
  legalAddressLine?: string;
  actualAddressCountry?: string;
  actualAddressCity?: string;
  actualAddressLine?: string;
}

export interface RestrictionOverview {
  status: string;
  requested: number;
  restricted: number;
  remaining: number;
  executed: number;
  reason: string;
}

/**
 * RS ადმინ პანელი (dashboard.dev.keepz.me) — Page Object: შესვლა, Dist. Businesses, RS registration, Liens & collections.
 * მხოლოდ UI მოქმედებები და წაკითხვა; შემოწმებები — RsFrontHelper.
 *   📋 ფანჯრები MUI Modal-ია (role=dialog არ აქვთ) → `.MuiModal-root`
 *   📋 wallet-ის მიბმისას ბიზნესს RS რეგისტრაცია თავისით ექმნება (Not submitted) → Open registration → Submit to RS
 * ეკრანები: KD-2559 (Dist. Businesses, Registration details, Liens & collections modal)
 */
export class RsAdminUiPage {
  constructor(readonly page: Page) {}

  // ─── შესვლა ───

  async login() {
    await this.page.goto(`${DASHBOARD}/login`);
    await this.page.locator('input[name=phone]').fill(process.env.ADMIN_USERNAME || '591078180');
    await this.page.getByRole('button', { name: 'Log in' }).click();
    await this.page.getByText(/^admin$/i).first().click();
    await this.page.locator('input[type=password]').fill(process.env.ADMIN_PASSWORD || '');
    await this.page.locator('button[type=submit]').first().click();
    await this.page.waitForURL(/\/dashboard\?/);
  }

  /** ბოლო გახსნილი ფანჯარა */
  modal(): Locator {
    return this.page.locator('.MuiModal-root').last();
  }

  /** ბოლო toast-ის ტექსტი (მაგ. "Business created", "Clients linked", "Submitted to RS") */
  async toast(text: string, timeout = 15_000): Promise<boolean> {
    return this.page.locator('.Toastify__toast', { hasText: text }).first().waitFor({ timeout }).then(() => true, () => false);
  }

  // ─── Dist. Businesses ───

  /** Create business (Resident) → Create → გადადის ბიზნესის გვერდზე → id */
  async createBusiness(b: BusinessForm): Promise<string> {
    await this.openBusinesses();
    await this.page.getByRole('button', { name: 'Create business' }).click();
    await this.fillBusinessForm(b);
    return this.submitBusinessForm();
  }

  /** Create business ფანჯრის შევსება (Resident / Foreign) — ცარიელ ველს არ ეხება */
  async fillBusinessForm(b: Partial<BusinessForm>) {
    const m = this.modal();
    if (b.residency) {
      await m.locator('#residency').click();
      await this.page.getByRole('option', { name: b.residency === 'FOREIGN' ? 'Foreign' : 'Resident', exact: true }).click();
    }
    const fields: [keyof BusinessForm, string][] = [['ownerFullName', 'ownerFullName'], ['identNumber', 'identNumber'], ['operDate', 'operDate'], ['knownDate', 'knownDate'],
      ['legalAddressCountry', 'legalAddressCountry'], ['legalAddressCity', 'legalAddressCity'], ['legalAddressLine', 'legalAddressLine'],
      ['actualAddressCountry', 'actualAddressCountry'], ['actualAddressCity', 'actualAddressCity'], ['actualAddressLine', 'actualAddressLine']];
    for (const [key, name] of fields) {
      const v = b[key];
      if (v) await m.locator(`input[name=${name}]`).fill(String(v));
    }
  }

  /** Create → ბიზნესის გვერდი → id */
  async submitBusinessForm(): Promise<string> {
    await this.modal().getByRole('button', { name: 'Create', exact: true }).click();
    await this.page.waitForURL(/\/distribution-hub-businesses\/[0-9a-f-]{36}/, { timeout: 20_000 });
    return this.page.url().match(/distribution-hub-businesses\/([0-9a-f-]{36})/)![1];
  }

  /** Create (კლიენტის მწკრივიდან — გვერდი სიაზე რჩება) → ფანჯარა იხურება */
  async submitBusinessFormStay() {
    await this.modal().getByRole('button', { name: 'Create', exact: true }).click();
    await this.page.locator('.MuiModal-root').first().waitFor({ state: 'detached', timeout: 20_000 });
  }

  /** Create-ზე დაჭერა უარყოფის მოლოდინით → წითლად მონიშნული ველები (name) */
  async submitBusinessFormInvalid(): Promise<string[]> {
    await this.modal().getByRole('button', { name: 'Create', exact: true }).click();
    await this.page.waitForTimeout(1000);
    return this.modal().locator('input[aria-invalid=true]').evaluateAll((els) => els.map((e) => (e as any).name as string));
  }

  async openBusinesses(tab?: 'without-business') {
    await this.page.goto(`${DASHBOARD}/distribution-hub-businesses${tab ? `?tab=${tab}` : ''}`);
    await this.page.waitForLoadState('networkidle');
  }

  /** Businesses ცხრილი: [Owner, Identification number, Residency, Clients, Updated] */
  async businessRows(): Promise<string[][]> {
    return this.tableRows(this.page.locator('table'));
  }

  /** ძებნა ident / personal number-ით → ცხრილი ახლდება (debounce) */
  async searchBusinesses(text: string) {
    const loaded = this.page.waitForResponse((r) => r.url().includes(`identificationNumber=${encodeURIComponent(text)}`), { timeout: 15_000 });
    await this.page.getByPlaceholder(/Search by identification/).fill(text);
    await loaded;
    await this.page.locator('tbody tr', { hasText: text }).first().waitFor({ timeout: 10_000 }).catch(() => {});
  }

  /** ფილტრი (Business filters): Owner / Residency → Apply */
  async filterBusinesses(f: { owner?: string; residency?: 'Resident' | 'Foreign' }) {
    await this.page.locator('#filter-btn').click();
    const m = this.modal();
    if (f.owner) await m.locator('input[name=name]').fill(f.owner);
    if (f.residency) {
      await m.locator('#residency').click();
      await this.page.getByRole('option', { name: f.residency, exact: true }).click();
    }
    await m.getByRole('button', { name: 'Apply' }).click();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
  }

  /** "Clients without business" ტაბის რიცხვი */
  async clientsWithoutBusinessCount(): Promise<number> {
    const t = (await this.page.getByRole('tab', { name: /^Clients without business/ }).textContent()) || '';
    return Number(t.replace('Clients without business', '').trim() || 0);
  }

  /** "Clients without business" მწკრივი კლიენტის id-ით (ან undefined): [Client, Client ID, Status, Created, Actions] */
  async clientWithoutBusiness(clientId: string): Promise<string[] | undefined> {
    const row = this.page.locator('tbody tr', { hasText: clientId });
    if (!(await row.count())) return undefined;
    return (await row.first().locator('td').allInnerTexts()).map((c) => c.replace(/\s+/g, ' ').trim());
  }

  /** კლიენტის მწკრივიდან Create business → ფანჯრის ტექსტი (ბანერი) + წინასწარ შევსებული Operation date */
  async openCreateBusinessForClient(clientId: string): Promise<{ text: string; operDate: string }> {
    await this.page.locator('tbody tr', { hasText: clientId }).getByRole('button', { name: 'Create business' }).click();
    const m = this.modal();
    await m.locator('input[name=operDate]').waitFor();
    return { text: (await m.innerText()).replace(/\s*\n+\s*/g, ' | '), operDate: await m.locator('input[name=operDate]').inputValue() };
  }

  async openBusiness(id: string) {
    await this.page.goto(`${DASHBOARD}/distribution-hub-businesses/${id}`);
    await this.page.waitForLoadState('networkidle');
  }

  // ─── Dist. Integrators — WALLET კლიენტის შექმნა ───

  /**
   * Dist. Integrators → "+" → New Integrator: Name, Scheme Wallet (ბიზნესის გარეშე), IBAN, STANDARD, ვალუტა GEL,
   * ⚠️ ფორმა 5-ივე ვალუტის კონფიგს ითხოვს (min / max / საკომისიო), მაშინაც კი, როცა ჩართულია მხოლოდ GEL → ვავსებთ ყველას
   * For testing (isMock) → Create → toast "Integrator was created successfully!"
   */
  async createWalletClient(name: string, businessOwner?: string): Promise<{ clientId: string; clientSecret: string }> {
    await this.page.goto(`${DASHBOARD}/distribution-hub-integrators/create`);
    await this.page.waitForLoadState('networkidle');
    await this.page.getByText('Basic Configuration', { exact: true }).click();
    await this.page.locator('input[name=clientName]').fill(name);
    await this.pickOption('#scheme', 'Wallet');
    if (businessOwner) {
      // Business (autocomplete — Search by owner name) → wallet იქმნება ბიზნესზე მიბმული
      await this.page.getByPlaceholder('Search by owner name').fill(businessOwner);
      await this.page.getByRole('option', { name: businessOwner }).first().click();
    }
    await this.pickOption('#distributeMethod', 'IBAN');
    await this.pickOption('#distributionStrategy', 'STANDARD');
    await this.page.getByPlaceholder('Search', { exact: true }).click();
    await this.page.getByRole('option', { name: 'GEL', exact: true }).click();
    await this.page.keyboard.press('Escape');
    await this.page.getByText('Commission Rules', { exact: true }).click();
    for (const c of ['GEL', 'USD', 'EUR', 'CNY', 'RUR']) {
      await this.page.locator(`input[name="currencyConfigs.${c}.0.minTransactionAmount"]`).fill('0.01');
      await this.page.locator(`input[name="currencyConfigs.${c}.0.maxTransactionAmount"]`).fill('100000');
      await this.pickOption(`#commissionRateType-${c}-0`, 'FIXED');
      await this.page.locator(`input[name="currencyConfigs.${c}.0.commissionTiers.0.commission"]`).fill('0');
    }
    if (!(await this.page.locator('input[name=isMock]').isChecked())) await this.page.getByText('For testing', { exact: true }).click();
    const created = this.page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/distributor-hub-client$/.test(r.url()), { timeout: 20_000 });
    await this.page.getByRole('button', { name: 'Create', exact: true }).click();
    const body = await (await created).json();
    return body.value; // { clientId, clientSecret }
  }

  /** New Integrator: ცარიელი ფორმა (მხოლოდ Scheme Wallet) → Create → წითლად მონიშნული ველები + შეცდომის ტექსტები */
  async submitEmptyWalletForm(): Promise<{ invalid: string[]; messages: string[] }> {
    await this.page.goto(`${DASHBOARD}/distribution-hub-integrators/create`);
    await this.page.waitForLoadState('networkidle');
    await this.page.getByText('Basic Configuration', { exact: true }).click();
    await this.pickOption('#scheme', 'Wallet');
    await this.page.getByRole('button', { name: 'Create', exact: true }).click();
    await this.page.waitForTimeout(1500);
    const invalid = await this.page.locator('[aria-invalid=true]').evaluateAll((els) => [...new Set(els.map((e) => (e as any).name || (e as any).id))] as string[]);
    const messages = [...new Set((await this.page.locator('.Mui-error.MuiFormHelperText-root').allInnerTexts()).map((t) => t.trim()))];
    return { invalid, messages };
  }

  /** Dist. Integrators სია: (Show Test Integrators) + ძებნა სახელით → მწკრივები [Name, Scheme, Status, Integrator ID, Dis. Method, Dis. Type, Enabled Currencies, Balance, Created At, Action] */
  async findIntegrators(name: string, showTest: boolean): Promise<string[][]> {
    await this.page.goto(`${DASHBOARD}/distribution-hub-integrators`);
    await this.page.waitForLoadState('networkidle');
    const box = this.page.locator('input[type=checkbox]').first();
    if ((await box.isChecked()) !== showTest) {
      const loaded = this.page.waitForResponse((r) => r.url().includes(`showMock=${showTest}`), { timeout: 15_000 });
      await this.page.getByText('Show Test Integrators').click();
      await loaded;
    }
    const searched = this.page.waitForResponse((r) => r.url().includes('distributor-hub-client/filter') && r.url().includes('searchText=QA'), { timeout: 15_000 });
    await this.page.getByPlaceholder('Search').fill(name);
    await searched;
    await this.page.waitForTimeout(800);
    return this.tableRows(this.page.locator('table'));
  }

  /** Dist. Integrators მწკრივზე "Test" ნიშანი */
  async integratorHasTestChip(name: string): Promise<boolean> {
    // Name უჯრაში ნიშანი სახელს წინ უდგას: "Test" + "QA UI Wallet …"
    const cell = (await this.page.locator('tbody tr', { hasText: name }).first().locator('td').first().innerText()).replace(/\s+/g, '');
    return cell.startsWith('Test') && cell.includes(name.replace(/\s+/g, ''));
  }

  private async pickOption(combobox: string, option: string) {
    await this.page.locator(combobox).click();
    await this.page.getByRole('option', { name: option, exact: true }).click();
  }

  /** გვერდის მთელი ტექსტი (sidebar-ის გარეშე), ერთ ხაზად: "a | b | c" */
  async pageText(): Promise<string> {
    return (await this.page.locator('body').innerText()).split('Wiki').pop()!.replace(/\s*\n+\s*/g, ' | ');
  }

  /** ბიზნესის გვერდი → Wallet clients ცხრილი: [Client, Status, Balances, Created, Actions] */
  async businessWalletRows(): Promise<string[][]> {
    return this.tableRows(this.page.locator('table', { has: this.page.locator('th', { hasText: 'Balances' }) }));
  }

  /**
   * რეგისტრაცია → Edit data → ველების შეცვლა → Save.
   *   აბრუნებს: რომელი ველები იყო გამორთული (RS-ში გაგზავნილი) და ფანჯრის მინიშნება
   */
  async editRegistration(changes: Record<string, string>): Promise<{ disabled: string[]; hint: string }> {
    await this.page.getByRole('button', { name: 'Edit data' }).click();
    const m = this.modal();
    await m.locator('input[name=ownerFullName]').waitFor();
    const disabled: string[] = [];
    for (const [name, value] of Object.entries(changes)) {
      const input = m.locator(`input[name=${name}]`);
      if (await input.isDisabled()) { disabled.push(name); continue; }
      await input.fill(value);
    }
    const hint = (await m.innerText()).match(/Sent to RS, can't be changed[^\n]*/)?.[0] || '';
    await m.getByRole('button', { name: 'Save' }).click();
    return { disabled, hint };
  }

  /** Link clients → მონიშნე wallet სახელით → "Link (1)" */
  async linkClient(clientName: string) {
    await this.page.getByRole('button', { name: 'Link clients' }).click();
    const m = this.modal();
    await m.getByText(clientName, { exact: true }).click();
    await m.getByRole('button', { name: /^Link \(/ }).click();
  }

  /** ბიზნესის გვერდის მთელი ტექსტი (RS registration ბლოკი, Wallet clients, Liens & collections) */
  async businessText(): Promise<string> {
    await this.page.getByText('Wallet clients').waitFor();
    return (await this.page.locator('body').innerText()).split('Wiki').pop()!.replace(/\s*\n+\s*/g, ' | ');
  }

  /** ბიზნესის გვერდიდან → Open registration → რეგისტრაციის id */
  async openRegistrationFromBusiness(): Promise<string> {
    await this.page.getByRole('button', { name: 'Open registration' }).click();
    await this.page.waitForURL(/\/rs-registrations\/[0-9a-f-]{36}/);
    await this.page.waitForLoadState('networkidle');
    return this.page.url().match(/rs-registrations\/([0-9a-f-]{36})/)![1];
  }

  /** ყველა ხილული toast ერთ ხაზად */
  async toasts(): Promise<string> {
    return (await this.page.locator('.Toastify__toast').allInnerTexts()).join(' | ');
  }

  /** ბიზნესის გვერდი → RS registration პანელი (სტატუსი, ღილაკები, Owner, Client number, First submitted, Approved) */
  async businessRsPanel(): Promise<string> {
    const t = await this.businessText();
    const i = t.indexOf('RS registration');
    const j = t.indexOf('Wallet clients', i);
    return t.slice(i, j > i ? j : i + 300);
  }

  /** ბიზნესის გვერდი → RS პანელი → Refresh */
  async refreshBusinessRsPanel() {
    await this.page.getByRole('button', { name: 'Refresh' }).first().click();
    await this.page.waitForLoadState('networkidle');
  }

  /** ბიზნესის გვერდი → Wallet clients → wallet-ის მწკრივის Unlink ღილაკი გამორთულია? */
  async unlinkDisabled(clientName: string): Promise<boolean> {
    return this.page.locator('tbody tr', { hasText: clientName }).first().getByRole('button', { name: 'Unlink' }).isDisabled();
  }

  // ─── Register to RS (RS registrations გვერდი / merchant-ის RS ტაბი) ───

  /** RS registrations → Register to RS → ფანჯარა */
  async openRegisterToRs() {
    await this.page.goto(`${DASHBOARD}/rs-registrations`);
    await this.page.waitForLoadState('networkidle');
    await this.page.getByRole('button', { name: /Register to RS/ }).first().click();
    await this.modal().getByText("Creates the taxpayer's RS registration").waitFor();
  }

  /** merchant-ის გვერდი → RS ტაბი; აბრუნებს ტაბის ტექსტს ("RS registration | …") */
  async openMerchantRsTab(merchantId: string): Promise<string> {
    await this.page.goto(`${DASHBOARD}/merchants/${merchantId}/details?tab=rs`);
    await this.page.waitForLoadState('networkidle');
    await this.page.getByText('RS registration').first().waitFor();
    const t = await this.pageText();
    return t.slice(t.indexOf('RS registration'), t.indexOf('©') > 0 ? t.indexOf('©') : undefined);
  }

  /** merchant-ის RS ტაბი → Register to RS → ფანჯარა */
  async registerFromMerchantTab() {
    await this.page.getByRole('button', { name: 'Register to RS' }).click();
    await this.modal().getByText("Creates the taxpayer's RS registration").waitFor();
  }

  /** Register to RS ფანჯრის ტექსტი ერთ ხაზად */
  async registerModalText(): Promise<string> {
    return (await this.modal().innerText()).replace(/\s*\n+\s*/g, ' | ');
  }

  /** Wallet type ჩამონათვალი (გახსნა → წაკითხვა → დახურვა) */
  async registerWalletTypes(): Promise<string[]> {
    await this.modal().getByRole('combobox').first().click();
    const options = (await this.page.getByRole('option').allInnerTexts()).map((o) => o.trim());
    await this.page.keyboard.press('Escape');
    // ჩამონათვალიც .MuiModal-root-ია — სანამ არ გაქრება, modal() მას აბრუნებს
    await this.page.getByRole('listbox').waitFor({ state: 'detached' });
    return options;
  }

  async selectRegisterWalletType(type: 'No wallet' | 'Payment merchant') {
    await this.modal().getByRole('combobox').first().click();
    await this.page.getByRole('option', { name: type, exact: true }).click();
    await this.modal().getByRole('combobox').first().filter({ hasText: type }).waitFor();
  }

  /** Merchant ველში ძებნა → ჩამონათვალი; `pick` → შესაბამის ვარიანტზე დაჭერა */
  async searchRegisterMerchant(query: string, pick = true): Promise<string[]> {
    const input = this.modal().getByRole('combobox').nth(1);
    await input.click();
    await input.fill(query);
    await this.page.getByRole('option').filter({ hasText: query }).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const options = (await this.page.getByRole('option').allInnerTexts()).map((o) => o.trim());
    if (pick) await this.page.getByRole('option').filter({ hasText: query }).first().click();
    return options;
  }

  /** ფანჯრის ველები: name (ან placeholder-ის გარეშე — "#index") → { value, disabled } */
  async registerFormValues(): Promise<Record<string, { value: string; disabled: boolean }>> {
    const list = await this.modal().locator('input').evaluateAll((els: any[]) => els.map((e) => [e.name, e.value, e.disabled] as [string, string, boolean]));
    return Object.fromEntries(list.map(([name, value, disabled], i) => [name || `#${i}`, { value, disabled }]));
  }

  async fillRegisterForm(data: Record<string, string>) {
    for (const [name, value] of Object.entries(data)) await this.modal().locator(`input[name=${name}]`).fill(value);
  }

  /** Save and review → შედეგი: toast, ველების შეცდომები, URL, ღია ფანჯრის ტექსტი (წარმატებისას — "Submit to RS | DATA TO SEND …") */
  async saveAndReview(): Promise<{ toast: string; errors: string; url: string; modal: string }> {
    await this.modal().getByRole('button', { name: 'Save and review' }).click();
    await this.page.locator('.Toastify__toast').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await this.page.waitForTimeout(1500);
    const errors = (await this.modal().locator('.MuiFormHelperText-root.Mui-error').allInnerTexts().catch(() => [])).join(' | ');
    const modal = (await this.page.locator('.MuiModal-root').count()) ? await this.registerModalText() : '';
    return { toast: await this.toasts(), errors, url: this.page.url(), modal };
  }

  // ─── RS registration ───

  async openRegistration(id: string, tab?: 'restrictions' | 'wallets') {
    await this.page.goto(`${DASHBOARD}/rs-registrations/${id}${tab ? `?tab=${tab}` : ''}`);
    await this.page.waitForLoadState('networkidle');
  }

  /** რეგისტრაციის სტატუსი — სათაურის გვერდით (მაგ. "Not submitted", "Pending RS approval", "Approved") */
  async registrationStatus(): Promise<string> {
    const pill = this.page.locator('h1').last().locator('xpath=following-sibling::*[1]');
    return ((await pill.innerText()) || '').trim();
  }

  /** სტატუსის tooltip (aria-label), მაგ. "Saved in Keepz. Not sent to RS yet." */
  async registrationStatusTooltip(): Promise<string> {
    return (await this.page.locator('h1').last().locator('xpath=following-sibling::*[1]//*[@aria-label]').first().getAttribute('aria-label')) || '';
  }

  /** Submit to RS → ფანჯარაში ჩანს გასაგზავნი მონაცემები → Submit to RS; აბრუნებს ფანჯრის ტექსტს */
  async submitToRs(): Promise<string> {
    await this.page.getByRole('button', { name: 'Submit to RS' }).click();
    const m = this.modal();
    await m.getByText('DATA TO SEND').waitFor();
    const text = (await m.innerText()).replace(/\s*\n+\s*/g, ' | ');
    await m.getByRole('button', { name: 'Submit to RS' }).click();
    return text;
  }

  /** ტაბის რიცხვი, მაგ. "Wallets1" → 1 */
  async tabCount(name: 'Wallets' | 'Liens & collections'): Promise<number> {
    const t = ((await this.page.getByRole('tab', { name: new RegExp(`^${name}`) }).textContent()) || '').replace(name, '').trim();
    return Number(t || 0);
  }

  async openTab(name: 'Data' | 'Wallets' | 'Field changes' | 'RS messages' | 'Liens & collections' | 'History') {
    await this.page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** ტაბის ცხრილის მწკრივები (Wallets / Liens & collections) */
  async tabRows(): Promise<string[][]> {
    return this.tableRows(this.page.locator('main table, table').last());
  }

  /** Liens & collections მწკრივი RS reference-ით: [ref, type, person, requested, restricted, remaining, executed, status, received] */
  async restrictionRow(rsNumber: string, timeout = 20_000): Promise<string[]> {
    const row = this.page.locator('tbody tr', { hasText: rsNumber }).last();
    await row.waitFor({ timeout });
    return (await row.locator('td').allInnerTexts()).map((c) => c.replace(/\s+/g, ' ').trim());
  }

  // ─── Collection / Lien ფანჯარა ───

  /** მწკრივზე დაჭერა → ფანჯარა. ⚠️ Playwright-ის ჩვეულებრივი click მწკრივს არ ხსნის → DOM click */
  async openRestriction(rsNumber: string, timeout = 20_000) {
    const row = this.page.locator('tbody tr', { hasText: rsNumber }).last();
    await row.waitFor({ timeout });
    await row.dispatchEvent('click');
    await this.modal().getByRole('tab', { name: 'Overview' }).waitFor({ timeout: 15_000 });
  }

  /**
   * ფანჯრის სტატუსი + 4 თანხა + Status reason.
   *   სახელები 10.11-დან: RESTRICTED → HELD NOW, REMAINING → STILL OWED, EXECUTED → PAID TO TREASURY (ორივე იკითხება)
   */
  async restrictionOverview(): Promise<RestrictionOverview> {
    await this.modal().getByRole('tab', { name: 'Overview' }).click();
    const text = (await this.modal().innerText()).replace(/\s*\n+\s*/g, ' | ');
    const amount = (label: string) => Number((text.match(new RegExp(`(?:${label}) \\| ₾ ([\\d.]+)`)) || [])[1] ?? NaN);
    return {
      status: (text.match(/^[^|]*· [^|]+ \| ([^|]+) \|/) || [])[1]?.trim() || '',
      requested: amount('REQUESTED'), restricted: amount('RESTRICTED|HELD NOW'), remaining: amount('REMAINING|STILL OWED'), executed: amount('EXECUTED|PAID TO TREASURY'),
      reason: (text.match(/Status reason \| ([^|]+)/) || [])[1]?.trim() || '',
    };
  }

  /** ფანჯრის ტაბის ცხრილი (Holds per wallet) */
  async modalTab(tab: 'Holds per wallet'): Promise<string[][]> {
    await this.modal().getByRole('tab', { name: tab }).click();
    await this.page.waitForTimeout(800);
    return this.tableRows(this.modal().locator('table'));
  }

  /**
   * Executions ტაბი (10.11-დან — ბარათები; "Treasury transfers" ტაბი ამოიღეს და აქ გადმოვიდა):
   *   text — მთელი ტექსტი ერთ ხაზად · statuses — თითო ბარათის სტატუსი (Amount received / Completed …) ·
   *   accomplished — თითო ბარათის Accomplished თანხა · transfers — ყველა ბარათის TRANSFERS მწკრივი [Wallet, Amount, Status, Paid, Wallet reference, Last error, Completed]
   */
  async executions(): Promise<{ text: string; statuses: string[]; accomplished: number[]; transfers: string[][] }> {
    await this.modal().getByRole('tab', { name: 'Executions' }).click();
    await this.page.waitForTimeout(800);
    const text = (await this.modal().innerText()).replace(/\s*\n+\s*/g, ' | ');
    const statuses = [...text.matchAll(/\d{4} \| ([^|]+?) \| Source/g)].map((m) => m[1].trim());
    const accomplished = [...text.matchAll(/Accomplished \| ₾ ([\d.]+)/g)].map((m) => Number(m[1]));
    const transfers: string[][] = [];
    const rows = this.modal().locator('table tbody tr');
    for (let i = 0; i < await rows.count(); i++) {
      transfers.push((await rows.nth(i).locator('td').allInnerTexts()).map((c) => c.replace(/\s+/g, ' ').trim()));
    }
    return { text, statuses, accomplished, transfers };
  }

  /** Reallocate holds → დადასტურება "Reallocate" → POST /restrictions/{id}/reallocate; აბრუნებს HTTP სტატუსს */
  async reallocateHolds(): Promise<number> {
    await this.modal().getByRole('button', { name: 'Reallocate holds' }).click();
    const confirm = this.modal();
    await confirm.getByText('Reallocate holds?').waitFor();
    const [res] = await Promise.all([
      this.page.waitForResponse((r) => r.request().method() === 'POST' && /\/restrictions\/[^/]+\/reallocate$/.test(r.url())),
      confirm.getByRole('button', { name: 'Reallocate', exact: true }).click(),
    ]);
    return res.status();
  }

  async modalButtons(): Promise<string[]> {
    return (await this.modal().locator('button').allInnerTexts()).map((b) => b.trim()).filter(Boolean);
  }

  // ─── RS → Liens & collections (საერთო გვერდი, /rs-restrictions) ───

  async openRestrictionsPage() {
    await this.page.goto(`${DASHBOARD}/rs-restrictions`);
    await this.page.waitForLoadState('networkidle');
  }

  /** ძებნა "Search by RS reference" → სია ახლდება */
  async searchRestrictions(rsReference: string) {
    const res = this.page.waitForResponse((r) => /\/api\/v1\/rs\/restrictions\?/.test(r.url()), { timeout: 15_000 }).catch(() => null);
    await this.page.getByPlaceholder('Search by RS reference').fill(rsReference);
    await res;
    await this.page.waitForTimeout(800);
  }

  /** ფილტრი (Lien and collection filters): Type, Status, Identification number, Registration ID → Apply */
  async filterRestrictions(f: { type?: 'Collection' | 'Lien'; status?: string; personId?: string; registrationId?: string }) {
    await this.page.locator('#filter-btn').click();
    const m = this.modal();
    await m.getByText('Lien and collection filters').waitFor();
    for (const [id, value] of [['type', f.type], ['status', f.status]] as const) {
      if (!value) continue;
      await m.locator(`#${id}`).click();
      await this.page.getByRole('option', { name: value, exact: true }).click();
    }
    if (f.personId) await m.locator('input[name=personId]').fill(f.personId);
    if (f.registrationId) await m.locator('input[name=registrationId]').fill(f.registrationId);
    const res = this.page.waitForResponse((r) => /\/api\/v1\/rs\/restrictions\?/.test(r.url()), { timeout: 15_000 }).catch(() => null);
    await m.getByRole('button', { name: 'Apply' }).click();
    await res;
    await this.page.waitForTimeout(800);
  }

  /** საერთო სიის მწკრივები: [RS reference, Type, Person (+ ident), Requested, Restricted, Remaining, Executed, Status, Received]; ცარიელი სია → [] */
  async restrictionsRows(): Promise<string[][]> {
    const body = this.page.locator('table tbody');
    await body.waitFor({ timeout: 15_000 });
    if (/No Items/i.test(await body.innerText())) return [];
    return this.tableRows(this.page.locator('table'));
  }

  /**
   * ფანჯრის History / Audit ტაბი → მოვლენები (ახალი ზემოთ): { title, entity, actor }
   *   მწკრივი: "11 Nov 2026, 15:40 | Manual payment recorded | Collection cycle | User: … | Before, after and payload"
   */
  async modalEvents(tab: 'History' | 'Audit'): Promise<{ title: string; entity: string; actor: string }[]> {
    await this.modal().getByRole('tab', { name: tab }).click();
    await this.modal().getByText('Before, after and payload').first().waitFor({ timeout: 15_000 });
    await this.page.waitForTimeout(500);
    const text = (await this.modal().innerText()).replace(/\s*\n+\s*/g, ' | ');
    return [...text.matchAll(/\d{2} \w{3} \d{4}, \d{2}:\d{2} \| (.+?) \| (.+?) \| (.+?) \| Before, after and payload/g)]
      .map((m) => ({ title: m[1], entity: m[2], actor: m[3] }));
  }

  /** History / Audit — მოვლენის "Before, after and payload" გაშლა (ტექსტის მიხედვით, `title` + `entity`) → JSON */
  async eventPayload(title: string, entity: string): Promise<any> {
    const links = this.modal().getByText('Before, after and payload');
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      // მოვლენის მწკრივი = უახლოესი წინაპარი, რომელშიც "title" არის და მხოლოდ ერთი "Before, after and payload"
      const text = await links.nth(i).evaluate((el) => {
        let p = el.parentElement;
        while (p && !(p.innerText.split('Before, after and payload').length === 2 && /\d{2}:\d{2}/.test(p.innerText))) p = p.parentElement;
        return p ? p.innerText.replace(/\s*\n+\s*/g, ' | ') : '';
      });
      if (!text.includes(`| ${title} | ${entity} |`)) continue;
      await links.nth(i).click();
      await this.page.waitForTimeout(600);
      const raw = await links.nth(i).evaluate((el) => {
        let p = el.parentElement;
        while (p && !(p.innerText.split('Before, after and payload').length === 2 && p.innerText.includes('{'))) p = p.parentElement;
        const t = p?.innerText || '';
        return t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
      });
      try { return JSON.parse(raw); } catch { return raw; }
    }
    return undefined;
  }

  /** ფანჯრის Overview-ს ველი (მაგ. "Priority" → "3", "Collection status" → "1") */
  async modalField(label: string): Promise<string> {
    await this.modal().getByRole('tab', { name: 'Overview' }).click();
    const text = (await this.modal().innerText()).replace(/\s*\n+\s*/g, ' | ');
    return (text.match(new RegExp(`\\| ${label} \\| ([^|]+?) \\|`)) || [])[1]?.trim() || '';
  }

  /** Return collection → მიზეზი → Return collection */
  async returnCollection(reason: string) {
    await this.modal().getByRole('button', { name: 'Return collection' }).click();
    const confirm = this.modal();
    await confirm.locator('textarea[name=reason]').fill(reason);
    await confirm.getByRole('button', { name: 'Return collection' }).click();
  }

  /** Overview → TODAY ბლოკი ("Not asked today…" / "Amount received | RS asks ₾ X today…" / "No amount | …" / "Completed | …") */
  async todayText(): Promise<string> {
    await this.modal().getByRole('tab', { name: 'Overview' }).click();
    const text = (await this.modal().innerText()).replace(/\s*\n+\s*/g, ' | ');
    return (text.match(/TODAY \| (.*?) \| REQUESTED/) || [])[1]?.trim() || '';
  }

  /** Record manual payment → ფორმა; აბრუნებს ფორმის ტექსტს და წინასწარ შევსებულ amount / paidAt-ს */
  async openManualPaymentForm(): Promise<{ text: string; amount: string; paidAt: string }> {
    await this.modal().getByRole('button', { name: 'Record manual payment' }).click();
    const f = this.modal();
    await f.locator('[name=bankReference]').waitFor();
    return {
      text: (await f.innerText()).replace(/\s*\n+\s*/g, ' | '),
      amount: await f.locator('[name=amount]').inputValue(),
      paidAt: await f.locator('[name=paidAt]').inputValue(),
    };
  }

  /**
   * ფორმის ველების შევსება (მხოლოდ გადაცემული).
   *   ⚠️ Amount paid — ნიღბიანი ველია ("−" და ასოები არ იწერება, fill() არასწორ მნიშვნელობას უგულებელყოფს) → ვშლით და ვკრეფთ კლავიშებით, როგორც ადამიანი
   */
  async fillManualPayment(v: { amount?: string; paidAt?: string; bankReference?: string; note?: string }) {
    const f = this.modal();
    for (const [name, value] of Object.entries(v)) {
      if (value === undefined) continue;
      const input = f.locator(`[name=${name}]`);
      if (name === 'amount') {
        await input.fill('');
        await input.pressSequentially(value);
      } else await input.fill(value);
    }
  }

  /** Amount paid ველის მიმდინარე მნიშვნელობა (ნიღბის შემდეგ) */
  async manualPaymentAmount(): Promise<string> {
    return this.modal().locator('[name=amount]').inputValue();
  }

  /**
   * ფორმა → Record manual payment → შედეგი: ველების შეცდომები, toast, გაიგზავნა თუ არა POST …/manual-payment (HTTP), დაიხურა თუ არა ფორმა
   *   📋 არასწორ მნიშვნელობაზე ფორმა ბექზე არაფერს აგზავნის — შეცდომა ველთან ჩნდება
   */
  async submitManualPayment(): Promise<{ errors: string[]; toast: string; http: number | null; closed: boolean }> {
    const f = this.modal();
    let http: number | null = null;
    const onResponse = (r: any) => { if (/\/manual-payment$/.test(r.url())) http = r.status(); };
    this.page.on('response', onResponse);
    await f.getByRole('button', { name: 'Record manual payment' }).click();
    await this.page.waitForTimeout(2000);
    this.page.off('response', onResponse);
    const closed = !(await f.locator('[name=bankReference]').isVisible().catch(() => false));
    const errors = closed ? [] : (await f.locator('.MuiFormHelperText-root').allInnerTexts()).map((x) => x.trim()).filter((x) => x && !/^\d+ \/ 500$/.test(x));
    // ბრაუზერის ვალიდაცია (მაგ. Paid at max → "Value must be … or earlier.") — MUI-ს შეცდომამდე ბლოკავს
    if (!closed) errors.push(...(await f.locator('input').evaluateAll((els: any[]) => els.filter((e) => !e.validity.valid).map((e) => e.validationMessage))));
    return { errors, toast: await this.toasts(), http, closed };
  }

  /** Request amount from RS → დადასტურება: Request amount */
  async requestAmount() {
    await this.modal().getByRole('button', { name: 'Request amount from RS' }).click();
    await this.modal().getByRole('button', { name: 'Request amount', exact: true }).click();
  }

  async closeModal() {
    await this.page.keyboard.press('Escape');
    await this.page.locator('.MuiModal-root').first().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  }

  private async tableRows(table: Locator): Promise<string[][]> {
    await table.first().waitFor({ timeout: 15_000 });
    const rows = table.first().locator('tbody tr');
    const out: string[][] = [];
    for (let i = 0; i < await rows.count(); i++) {
      out.push((await rows.nth(i).locator('td').allInnerTexts()).map((c) => c.replace(/\s+/g, ' ').trim()));
    }
    return out;
  }
}
