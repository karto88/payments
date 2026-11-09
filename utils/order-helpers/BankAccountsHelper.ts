import { APIRequestContext, chromium, Page } from '@playwright/test';
import { AdminAuthPage } from '../../pages/AdminAuthPage';
import { GmailHelper } from '../GmailHelper';
import { assertCondition, assertKeysPresent } from '../assertions';

type Env = 'dev' | 'prod';

// dev / prod — განსხვავდება მხოლოდ URL (dev-ის გარეშე) და ადმინის credentials (.env: ADMIN_* / PROD_ADMIN_*)
const ENV = (env: Env) => env === 'prod'
  ? { admin: 'https://newadmin.keepz.me', dashboard: 'https://dashboard.keepz.me',
      username: process.env.PROD_ADMIN_USERNAME!, password: process.env.PROD_ADMIN_PASSWORD! }
  : { admin: 'https://newadmin.dev.keepz.me', dashboard: 'https://dashboard.dev.keepz.me',
      username: process.env.ADMIN_USERNAME || '591078180', password: process.env.ADMIN_PASSWORD! };

const CONSENT_KEYS = ['id', 'consentId', 'providerId', 'provider', 'providerName', 'name', 'visibility', 'status',
  'validUntil', 'frequencyPerDay', 'callsUsedToday', 'lastSyncAt', 'lastSyncFailed', 'createdAt', 'accounts'];
const ACCOUNT_KEYS = ['id', 'iban', 'currency', 'balanceAmount', 'balanceFetchedAt', 'balanceFailed'];
const TRANSACTION_KEYS = ['id', 'consentId', 'providerId', 'provider', 'accountId', 'accountIban', 'transactionId',
  'bookingDate', 'amount', 'currency'];

export type Provider = 'BOG' | 'TBC' | 'LIBERTY';
export const PROVIDER_ID: Record<Provider, number> = { TBC: 1, BOG: 2, LIBERTY: 4 };

export interface TransactionFilter {
  page?: number;
  size?: number;
  dateFrom?: string; // yyyy-MM-dd
  dateTo?: string;
  providerId?: number;
  accountId?: number;
  iban?: string;
  transactionId?: string;
  counterpartyIban?: string;
  consentId?: number;
}

/**
 * Bank Accounts (Open Banking AIS) — ადმინ პანელის მოდული (KD-2438 BE / KD-2439 FE).
 *   - დაკავშირება: ადმინ პანელი (Connect bank) → ბანკის გვერდი (real Chrome) → callback → finalise
 *   - დანარჩენი API-ით: newadmin /api/v1/bank-account (ადმინის token — AdminAuthPage)
 */
export class BankAccountsHelper {
  private token = '';

  private cfg: ReturnType<typeof ENV>;
  private API: string;
  private DASHBOARD: string;

  constructor(private request: APIRequestContext, env: Env = 'dev') {
    this.cfg = ENV(env);
    this.API = `${this.cfg.admin}/api/v1/bank-account`;
    this.DASHBOARD = this.cfg.dashboard;
  }

  // ─────────────────────────── დაკავშირება ───────────────────────────

  /** Connect bank → ბანკში თანხმობა → callback → consent valid + ანგარიშები */
  async connectBank(provider: Provider, name: string, opts: { private?: boolean } = {}) {
    const OP = `Connect bank (${provider}${opts.private ? ' · Private' : ''}) → finalise`;
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const page = await browser.newPage();
    try {
      await this.startConnect(page, provider, name, opts.private);

      if (provider === 'BOG') await this.approveBOG(page, gmail);
      if (provider === 'TBC') await this.approveTBC(page, gmail);
      if (provider === 'LIBERTY') await this.approveLiberty(page, gmail);

      // ბანკიდან დაბრუნება ადმინ პანელში (web callback)
      const backToDashboard = await page.waitForURL((u) => u.hostname === new URL(this.DASHBOARD).hostname, { timeout: 30000 })
        .then(() => true).catch(() => false);
      assertCondition(OP, backToDashboard,
        `ბანკმა ადმინ პანელში არ დააბრუნა — გადავიდა ${page.url().split('?')[0]}`,
        `redirect ${this.DASHBOARD} (web callback) → finalise`, { landedOn: page.url().split('?')[0] });

      // processing / pending → ადმინში Bank accounts გვერდზე ახალი ბარათი უნდა გამოჩნდეს
      await page.waitForLoadState('networkidle');
      if (!page.url().includes('/bank-accounts')) {
        await page.waitForURL(/\/bank-accounts/, { timeout: 60000 }).catch(() => page.goto(`${this.DASHBOARD}/bank-accounts`));
      }
      const card = page.getByText(name, { exact: true }).first();
      let cardVisible = false;
      for (let i = 0; i < 6 && !cardVisible; i++) {
        cardVisible = await card.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
        if (!cardVisible) await page.reload({ waitUntil: 'networkidle' });
      }
      assertCondition(OP, cardVisible, `ადმინის Bank accounts გვერდზე "${name}" არ გამოჩნდა`,
        `ბარათი "${name}" ჩანს ${this.DASHBOARD}/bank-accounts`, { page: page.url().split('?')[0] });
      await page.waitForTimeout(3000); // ბარათის სანახავად
    } finally {
      await browser.close();
    }

    // consent valid + ანგარიშები
    const consent = await this.waitConsent(name);
    console.log(`🏦 ${consent.providerName} "${consent.name}" #${consent.id} — ${consent.status} · ანგარიშები ${consent.accounts.length} · valid until ${consent.validUntil}`);
    assertCondition(OP, consent.status === 'valid', `consent-ის status: ${consent.status}`, 'status = valid', consent);
    assertCondition(OP, consent.accounts.length > 0, 'consent-ს ანგარიშები არ აქვს', 'მინიმუმ 1 ანგარიში (IBAN × ვალუტა)', consent);
    const visibility = opts.private ? 'PRIVATE' : 'SHARED';
    assertCondition(OP, consent.visibility === visibility, `visibility: ${consent.visibility}`, `visibility = ${visibility}`, consent);
    return consent;
  }

  /**
   * Private connection: მხოლოდ შემქმნელი ადმინი ხედავს. მეორე ადმინი (.env ADMIN2_*) — private-ს ვერ ხედავს
   * (არც ბარათს, არც ტრანზაქციებს), shared consent-ებს ხედავს.
   */
  async checkPrivateVisibility(name: string) {
    const OP = 'GET /bank-account/consents (Private connection)';
    const mine = await this.getConsents();
    const priv = mine.filter((c) => c.name === name && c.visibility === 'PRIVATE').sort((a, b) => b.id - a.id)[0];
    assertCondition(OP, !!priv, `შემქმნელი ადმინი private consent "${name}"-ს ვერ ხედავს`, `"${name}" PRIVATE სიაშია`,
      mine.map((c) => ({ id: c.id, name: c.name, visibility: c.visibility })));
    const shared = mine.filter((c) => c.visibility === 'SHARED' && c.status === 'valid').map((c) => c.id);

    // მეორე ადმინი
    const token2 = await new AdminAuthPage(this.request, this.cfg.admin).authenticate(process.env.ADMIN2_USERNAME!, process.env.ADMIN2_PASSWORD!);
    const headers2 = { Authorization: `Bearer ${token2}` };
    const OP2 = `${OP} — მეორე ადმინი`;
    const res = await this.request.get(`${this.API}/consents`, { headers: headers2 });
    const others: any[] = (await res.json().catch(() => ({}))).value || [];
    console.log(`👤 მეორე ადმინი ხედავს: ${others.map((c) => `#${c.id} ${c.visibility}`).join(', ')} · private #${priv.id}`);

    assertCondition(OP2, !others.some((c) => c.id === priv.id), `მეორე ადმინი სხვის private consent-ს #${priv.id} ხედავს`,
      'სხვისი private consent არ ჩანს', others.find((c) => c.id === priv.id));
    const missingShared = shared.filter((id) => !others.some((c) => c.id === id));
    assertCondition(OP2, !missingShared.length, `მეორე ადმინი shared consent-ებს ვერ ხედავს: #${missingShared.join(', #')}`,
      'ყველა shared consent ჩანს', others.map((c) => ({ id: c.id, visibility: c.visibility })));

    const tx = await this.request.get(`${this.API}/transactions`, { headers: headers2, params: { page: 0, size: 20, consentId: priv.id } });
    const txBody = await tx.json().catch(() => ({}));
    const leaked = tx.ok() ? (txBody.value?.content || []).filter((t: any) => t.consentId === priv.id).length : 0;
    assertCondition(OP2, leaked === 0, `მეორე ადმინი private consent-ის ${leaked} ტრანზაქციას ხედავს`, 'private-ის ტრანზაქციები არ ჩანს',
      txBody.value?.content?.slice(0, 3));
    const all = await this.request.get(`${this.API}/transactions`, { headers: headers2, params: { page: 0, size: 500 } });
    const leakedAll = ((await all.json().catch(() => ({}))).value?.content || []).filter((t: any) => t.consentId === priv.id).length;
    assertCondition(OP2, leakedAll === 0, `ფილტრის გარეშე სიაში private-ის ${leakedAll} ტრანზაქცია ჩანს`, 'private-ის ტრანზაქციები არ ჩანს', null);

    const one = await this.request.get(`${this.API}/consents/${priv.id}`, { headers: headers2 });
    assertCondition(`GET /bank-account/consents/{id} (სხვისი private)`, one.status() >= 400 && one.status() < 500,
      `status ${one.status()} — სხვისი private consent-ის დეტალები იხსნება`, '403 / 404', await one.json().catch(() => ''));
  }

  /** ბანკში უარი ("არ ვეთანხმები") → ადმინში დაბრუნება + error toast → consent არ ემატება (KD-2439: "უარის შემთხვევაში error toast") */
  async cancelAtBank(provider: 'TBC', name: string) {
    const OP = `Connect bank (${provider}) → ბანკში უარი`;
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();

    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const page = await browser.newPage();
    try {
      await this.startConnect(page, provider, name);
      await this.loginTBC(page, gmail);
      await page.locator('#agreeButton').waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: 'არ ვეთანხმები' }).first().click();

      const back = await page.waitForURL((u) => u.hostname === new URL(this.DASHBOARD).hostname, { timeout: 60000 })
        .then(() => true).catch(() => false);
      assertCondition(OP, back, `უარის შემდეგ ადმინ პანელში არ დაბრუნდა — ${page.url().split('?')[0]}`,
        `redirect ${this.DASHBOARD} + error toast`, { landedOn: page.url().split('?')[0] });

      // error toast (MUI Snackbar / Alert)
      const toast = page.locator('[role=alert], .MuiAlert-message, .Toastify__toast').first();
      const toastText = await toast.waitFor({ state: 'visible', timeout: 15000 }).then(() => toast.innerText()).catch(() => '');
      console.log(`🚫 ${provider} უარი — toast: ${toastText || '(არ გამოჩნდა)'}`);
      assertCondition(OP, !!toastText, 'უარის შემდეგ error toast არ გამოჩნდა', 'error toast', { page: page.url().split('?')[0] });
      await page.waitForTimeout(3000);
    } finally {
      await browser.close();
    }

    const added = (await this.getConsents()).filter((c) => c.name === name && c.status === 'valid');
    assertCondition(OP, !added.length, `უარის მიუხედავად consent დაემატა: #${added.map((c) => c.id).join(', #')}`,
      `"${name}" valid consent არ არის`, added);
  }

  /** ადმინ პანელი → Bank accounts → Connect bank მოდალი: ბანკი → სახელი → Continue to bank */
  private async startConnect(page: Page, provider: Provider, name: string, isPrivate = false) {
    await this.loginDashboard(page);
    await page.goto(`${this.DASHBOARD}/bank-accounts`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Connect bank' }).first().click();
    await page.locator(`input[name=providerId][value="${PROVIDER_ID[provider]}"]`).check({ force: true });
    await page.locator('#ob-connection-name').fill(name);
    if (isPrivate) await page.getByText('Private connection', { exact: true }).click();
    await page.locator('button[type=submit]', { hasText: 'Continue to bank' }).click();
  }

  /** BOG: login → OTP → ანგარიშები (Full information) → I agree → NEXT */
  private async approveBOG(page: Page, gmail: GmailHelper) {
    await page.waitForSelector('bd-text-field#username', { timeout: 30000 });
    await page.click('bd-text-field#username');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.BOG_USERNAME!, { delay: 80 });
    await page.click('bd-text-field#password');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.BOG_PASSWORD!, { delay: 80 });
    await page.waitForTimeout(500);
    await page.click('#kc-login');
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(30, undefined, 'BOG');
    await page.locator('input#input').fill(otp);
    await page.waitForTimeout(500);
    await page.locator('bd-button#kc-login').click();
    await page.waitForLoadState('networkidle');

    // ანგარიშების არჩევა — ყოველ ანგარიშზე "Full information" (ყოველი 4 toggle-დან პირველი)
    await page.locator('#kc-ob-select-accounts-submit-button').waitFor({ timeout: 30000 });
    const toggles = page.locator('bd-toggle');
    const count = await toggles.count();
    for (let i = 0; i < count; i += 4) {
      await toggles.nth(i).click({ force: true });
      await page.waitForTimeout(500);
    }
    await page.locator('#kc-ob-select-accounts-submit-button').click();
    await page.waitForLoadState('networkidle');

    // თანხმობის გვერდი — I agree → NEXT
    await page.locator('bd-checkbox#confirm').click();
    await page.waitForTimeout(500);
    await page.locator('#form-submit').click();
  }

  /** TBC: login → OTP (OpenBankingHelper-ის იგივე) → წესები (ბოლომდე scroll) → ანგარიშები → ვეთანხმები */
  private async approveTBC(page: Page, gmail: GmailHelper) {
    await this.loginTBC(page, gmail);
    await this.acceptTBC(page);
  }

  /** TBC login + OTP (OpenBankingHelper-ის იგივე) */
  private async loginTBC(page: Page, gmail: GmailHelper) {
    await page.waitForSelector('#UserName', { timeout: 30000 });
    await page.click('#UserName');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.TBC_USERNAME!, { delay: 80 });
    await page.click('#Password');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.TBC_PASSWORD!, { delay: 80 });
    await page.waitForTimeout(500);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(60, undefined, 'TBC');
    await page.waitForSelector('input[name="OtpCode"]', { timeout: 10000 });
    await page.click('input[name="OtpCode"]');
    await page.waitForTimeout(300);
    await page.keyboard.type(otp, { delay: 80 });
    await page.waitForTimeout(500);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
  }

  /** TBC თანხმობა: წესები → ანგარიში → Summary → ვეთანხმები */
  private async acceptTBC(page: Page) {
    // წესები და პირობები — ღილაკი ირთვება მხოლოდ ტექსტის ბოლომდე ჩამოსქროლვის შემდეგ
    const agree = page.locator('#agreeButton');
    await agree.waitFor({ timeout: 30000 });
    await page.evaluate(`(() => {
      for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 5) el.scrollTop = el.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    })()`);
    await page.waitForTimeout(1000);
    await agree.click();

    // ანგარიშები — მხოლოდ GE95TB7197445064300003 (Accounts[0]): ანგარიში + ბალანსები + ტრანზაქციები → ვეთანხმები
    const summary = page.locator('#summaryButton');
    await summary.waitFor({ state: 'visible', timeout: 30000 });
    for (const field of ['IsSelectedAccounts', 'IsSelectedBalances', 'IsSelectedTransactions']) {
      const box = page.locator(`#ConsentDetails_AisAccess_Accounts_0__${field}`);
      if (!(await box.isChecked())) await box.check({ force: true });
      await page.waitForTimeout(300);
    }
    await summary.click();

    // ბოლო ნაბიჯი (Summary) — ვეთანხმები
    await page.waitForURL(/Sessions\/Summary/i, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'ვეთანხმები' }).last().click();
  }

  /** Liberty: login → SMS კოდი (Gmail-ში მოდის, subject "Liberty") → 4 უჯრა → თანხმობა */
  private async approveLiberty(page: Page, gmail: GmailHelper) {
    await page.waitForSelector('#username', { timeout: 30000 });
    await page.locator('#username').fill(process.env.LIBERTY_USERNAME!);
    await page.locator('#password').fill(process.env.LIBERTY_PASSWORD!);
    await page.locator('#login-form-submit').click();

    const otp = await gmail.getLatestOTP(60, undefined, 'LIBERTY');
    await page.locator('#otp-code-first').waitFor({ state: 'visible', timeout: 30000 });
    const cells = ['#otp-code-first', '#otp-code-second', '#otp-code-third', '#otp-code-forth'];
    for (let i = 0; i < cells.length; i++) {
      await page.click(cells[i]);
      await page.keyboard.type(otp[i], { delay: 100 });
    }
    // TODO: OTP-ის შემდეგი გვერდები (ანგარიშები / თანხმობა) — ჯერ ვერ ვნახეთ (მომხმარებელი დაიბლოკა)
  }

  private async loginDashboard(page: Page) {
    await page.goto(`${this.DASHBOARD}/login`);
    await page.locator('input[name=phone]').fill(this.cfg.username);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByText(/^admin$/i).first().click();
    await page.locator('input[type=password]').fill(this.cfg.password);
    await page.locator('button[type=submit]').first().click();
    await page.waitForURL(/\/dashboard\?/);
  }

  /** consent სახელით — finalise-ს შეიძლება რამდენიმე წამი დასჭირდეს */
  private async waitConsent(name: string) {
    let consent: any;
    for (let i = 0; i < 6; i++) {
      // ერთი სახელით რამდენიმე consent შეიძლება იყოს — ვიღებთ უახლესს (ყველაზე დიდი id)
      consent = (await this.getConsents()).filter((c: any) => c.name === name).sort((a: any, b: any) => b.id - a.id)[0];
      if (consent?.status === 'valid') break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    assertCondition(`GET /bank-account/consents`, !!consent, `consent "${name}" სიაში არ არის`, `consent "${name}" სიაშია`, null);
    return consent;
  }

  // ─────────────────────────── consent-ები ───────────────────────────

  /** სია: ველები + ანგარიშები (IBAN × ვალუტა) + ბალანსი + ლიმიტი */
  async checkConsentList(provider?: Provider) {
    const OP = 'GET /bank-account/consents';
    const consent = await this.validConsent(provider);
    assertKeysPresent(OP, consent, CONSENT_KEYS);
    for (const account of consent.accounts) assertKeysPresent(OP, account, ACCOUNT_KEYS);

    const pairs = consent.accounts.map((a: any) => `${a.iban}/${a.currency}`);
    assertCondition(OP, new Set(pairs).size === pairs.length, 'ერთი და იგივე IBAN/ვალუტა მეორდება', 'თითო IBAN × ვალუტა ერთხელ', pairs);
    assertCondition(OP, consent.callsUsedToday <= consent.frequencyPerDay,
      `callsUsedToday ${consent.callsUsedToday} > frequencyPerDay ${consent.frequencyPerDay}`, 'callsUsedToday ≤ frequencyPerDay', consent);
    console.log(`🏦 #${consent.id} ${consent.providerName} — ${pairs.join(', ')} · განახლებები ${consent.callsUsedToday}/${consent.frequencyPerDay}`);
  }

  /** ბალანსის განახლება: callsUsedToday +1, lastSyncAt ახლდება, ბალანსი მოდის */
  async checkRefresh(provider?: Provider) {
    const OP = 'POST /bank-account/consents/{id}/refresh';
    const before = await this.validConsent(provider);
    assertCondition(OP, before.callsUsedToday < before.frequencyPerDay,
      `დღიური ლიმიტი ამოწურულია (${before.callsUsedToday}/${before.frequencyPerDay})`, 'მინიმუმ 1 განახლება დარჩენილი', before);

    const res = await this.request.post(`${this.API}/consents/${before.id}/refresh`, { headers: await this.headers() });
    const body = await res.json().catch(() => ({}));
    assertCondition(OP, res.ok(), `status ${res.status()}`, '200', body);

    const after = body.value;
    console.log(`🔄 #${after.id} — განახლებები ${before.callsUsedToday} → ${after.callsUsedToday}/${after.frequencyPerDay} · lastSyncAt ${after.lastSyncAt} · failed ${after.lastSyncFailed}`);
    assertCondition(OP, after.callsUsedToday === before.callsUsedToday + 1,
      `callsUsedToday ${before.callsUsedToday} → ${after.callsUsedToday}`, `callsUsedToday = ${before.callsUsedToday + 1}`, after);
    assertCondition(OP, !!after.lastSyncAt && after.lastSyncAt !== before.lastSyncAt,
      `lastSyncAt არ განახლდა (${after.lastSyncAt})`, 'lastSyncAt ახალი დრო', after);
    assertCondition(OP, after.lastSyncFailed === false, `lastSyncFailed = ${after.lastSyncFailed} (${after.lastSyncError})`, 'lastSyncFailed = false', after);
    const noBalance = after.accounts.filter((a: any) => a.canFetchBalance !== false && a.balanceAmount == null);
    assertCondition(OP, !noBalance.length, `ბალანსი არ მოვიდა: ${noBalance.map((a: any) => `${a.iban}/${a.currency}`).join(', ')}`,
      'ყოველ ანგარიშს balanceAmount', after.accounts);
  }

  // ─────────────────────────── ტრანზაქციები ───────────────────────────

  /** სია: 200, გვერდის ველები, დალაგება ჯერ უახლესი */
  async checkTransactions(filter: TransactionFilter = {}) {
    const OP = 'GET /bank-account/transactions';
    const page = await this.getTransactions({ page: 0, size: 20, ...filter });
    assertKeysPresent(OP, page, ['content', 'totalElements', 'totalPages', 'number', 'size']);
    for (const t of page.content) assertKeysPresent(OP, t, TRANSACTION_KEYS);

    const dates = page.content.map((t: any) => t.bookingDate);
    const sorted = [...dates].sort().reverse();
    assertCondition(OP, JSON.stringify(dates) === JSON.stringify(sorted), 'ტრანზაქციები უახლესიდან არ არის დალაგებული',
      'bookingDate კლებადობით', dates);
    console.log(`📄 ტრანზაქციები: ${page.totalElements} · გვერდი ${page.number + 1}/${page.totalPages} (size ${page.size})`);
    return page;
  }

  /** ბანკის უახლესი ტრანზაქციები: მხოლოდ ამ ბანკის, მისი consent-ის ანგარიშებიდან, ჯერ უახლესი */
  async checkBankTransactions(provider: Provider) {
    const OP = `GET /bank-account/transactions (${provider})`;
    const consent = await this.validConsent(provider);
    const page = await this.checkTransactions({ providerId: PROVIDER_ID[provider] });
    assertCondition(OP, page.content.length > 0, `${provider}-ის ტრანზაქციები არ მოვიდა`, 'მინიმუმ 1 ტრანზაქცია', page);
    const ibans = consent.accounts.map((a: any) => a.iban);
    const wrong = page.content.filter((t: any) => t.providerId !== PROVIDER_ID[provider] || !ibans.includes(t.accountIban));
    assertCondition(OP, !wrong.length, `${wrong.length} ტრანზაქცია სხვა ბანკის / სხვა ანგარიშისაა`,
      `providerId ${PROVIDER_ID[provider]} · IBAN ∈ ${[...new Set(ibans)].join(', ')}`, wrong.slice(0, 3));
    const latest = page.content[0];
    console.log(`🏦 ${provider} უახლესი: ${latest.bookingDate} · ${latest.amount} ${latest.currency} · ${latest.transactionId}`);
  }

  /** დეტალები: იგივე ველები რაც სიაში + ბანკის სრული პასუხი (raw) */
  async checkTransactionDetails(provider?: Provider) {
    const OP = `GET /bank-account/transactions/{id}${provider ? ` (${provider})` : ''}`;
    const first = (await this.getTransactions({ page: 0, size: 1, providerId: provider && PROVIDER_ID[provider] })).content[0];
    assertCondition(OP, !!first, 'ტრანზაქციები არ არის — დეტალების შესამოწმებელი არაფერია', 'მინიმუმ 1 ტრანზაქცია', null);

    const res = await this.request.get(`${this.API}/transactions/${first.id}`, { headers: await this.headers() });
    const body = await res.json().catch(() => ({}));
    assertCondition(OP, res.ok(), `status ${res.status()}`, '200', body);
    const details = body.value;
    for (const key of TRANSACTION_KEYS) {
      assertCondition(OP, details[key] === first[key], `${key}: სიაში ${first[key]}, დეტალებში ${details[key]}`, `${key} = ${first[key]}`, details);
    }
    assertCondition(OP, !!details.raw && Object.keys(details.raw).length > 0, 'ბანკის სრული პასუხი (raw) ცარიელია',
      'raw — ბანკის პასუხის ყველა ველი', details);
    console.log(`🧾 ${details.transactionId} — ${details.amount} ${details.currency} · raw ველები: ${Object.keys(details.raw).join(', ')}`);
  }

  /** ფილტრი: ყველა დაბრუნებული ტრანზაქცია ფილტრს აკმაყოფილებს */
  async checkFilter(name: string, filter: TransactionFilter, matches: (t: any) => boolean) {
    const OP = `GET /bank-account/transactions (${name})`;
    const page = await this.checkTransactions(filter);
    const wrong = page.content.filter((t: any) => !matches(t));
    assertCondition(OP, !wrong.length, `${wrong.length} ტრანზაქცია ფილტრს არ ემთხვევა`, `ყველა ტრანზაქცია: ${JSON.stringify(filter)}`,
      wrong.slice(0, 3));
  }

  /** ფილტრის მნიშვნელობები არსებული ტრანზაქციიდან (ანგარიში, IBAN, ID-ის ნაწილი…) */
  async sampleTransaction(where: (t: any) => boolean = () => true) {
    const found = (await this.getTransactions({ page: 0, size: 100 })).content.find(where);
    assertCondition('GET /bank-account/transactions', !!found, 'შესაფერისი ტრანზაქცია არ არის — ფილტრის შესამოწმებელი არაფერია',
      'მინიმუმ 1 ტრანზაქცია (ძიების ველით)', null);
    return found;
  }

  /** პაგინაცია: size დაცულია, გვერდები არ მეორდება */
  async checkPagination(size: number) {
    const OP = `GET /bank-account/transactions (size ${size})`;
    const p1 = await this.checkTransactions({ page: 0, size });
    assertCondition(OP, p1.content.length <= size, `მოვიდა ${p1.content.length} > size ${size}`, `≤ ${size}`, p1.content.length);
    if (p1.totalPages > 1) {
      const p2 = await this.getTransactions({ page: 1, size });
      const repeated = p2.content.filter((t: any) => p1.content.some((x: any) => x.id === t.id));
      assertCondition(OP, !repeated.length, `მეორე გვერდზე ${repeated.length} ტრანზაქცია მეორდება`, 'გვერდები არ ემთხვევა', repeated);
    }
  }

  /** სამივე ბანკი სიაში valid-ად, თითოეულს ანგარიშები */
  async checkAllBanksConnected(providers: Provider[]) {
    const OP = 'GET /bank-account/consents (ყველა ბანკი)';
    const consents = await this.getConsents();
    const missing = providers.filter((p) =>
      !consents.some((c) => c.providerId === PROVIDER_ID[p] && c.status === 'valid' && c.accounts?.length));
    assertCondition(OP, !missing.length, `valid consent არ აქვს: ${missing.join(', ')}`, `valid consent ანგარიშებით: ${providers.join(', ')}`,
      consents.map((c) => ({ id: c.id, provider: c.provider, name: c.name, status: c.status, accounts: c.accounts?.length })));
  }

  // ─────────────────── ჩანაცვლება / გათიშვა (KD-2438) ───────────────────

  /** იმავე ანგარიშის ახალი consent ძველს ანაცვლებს: ძველი სიიდან ქრება, ტრანზაქციები არ ორმაგდება */
  async checkReplaced(provider: Provider) {
    const OP = `GET /bank-account/consents (${provider} — ჩანაცვლება)`;
    const consents = (await this.getConsents()).filter((c) => c.providerId === PROVIDER_ID[provider])
      .sort((a, b) => b.id - a.id);
    const [latest, ...older] = consents;
    assertCondition(OP, latest?.status === 'valid', `უახლესი ${provider} consent არ არის valid`, 'უახლესი consent valid', latest);
    const ibans = new Set(latest.accounts.map((a: any) => a.iban));
    const stale = older.filter((c) => c.accounts?.some((a: any) => ibans.has(a.iban)));
    assertCondition(OP, !stale.length,
      `ჩანაცვლებული consent სიაში რჩება: ${stale.map((c) => `#${c.id} (${c.status})`).join(', ')}`,
      'ძველი consent სიიდან ქრება ანგარიშებთან და ტრანზაქციებთან ერთად',
      stale.map((c) => ({ id: c.id, status: c.status, lastSyncError: c.lastSyncError })));
    await this.checkNoDuplicateTransactions(provider);
  }

  /** ერთი transactionId სიაში ერთხელ */
  async checkNoDuplicateTransactions(provider?: Provider) {
    const OP = `GET /bank-account/transactions${provider ? ` (${provider})` : ''} — დუბლიკატები`;
    const page = await this.getTransactions({ page: 0, size: 500, providerId: provider && PROVIDER_ID[provider] });
    const seen = new Map<string, number[]>();
    for (const t of page.content) seen.set(`${t.accountIban}/${t.transactionId}`, [...(seen.get(`${t.accountIban}/${t.transactionId}`) || []), t.consentId]);
    const dups = [...seen].filter(([, ids]) => ids.length > 1);
    console.log(`🔁 ${provider || 'ყველა'}: ტრანზაქციები ${page.totalElements} · დუბლიკატი ${dups.length}`);
    assertCondition(OP, !dups.length, `${dups.length} ტრანზაქცია ორჯერ ჩანს`, 'ყოველი transactionId ერთხელ',
      dups.slice(0, 3).map(([id, consentIds]) => ({ transactionId: id, consentIds })));
  }

  /** გათიშვა (DELETE consent): ბარათი და მისი ტრანზაქციები ქრება, სხვა consent-ები რჩება */
  async disconnect(provider: Provider) {
    const OP = `DELETE /bank-account/consents/{id} (${provider})`;
    const before = await this.getConsents();
    const target = before.filter((c) => c.providerId === PROVIDER_ID[provider] && c.status === 'valid').sort((a, b) => b.id - a.id)[0];
    assertCondition(OP, !!target, `${provider}-ის valid consent არ არის — გასათიში არაფერია`, `${provider} valid consent`, null);
    const others = before.filter((c) => c.id !== target.id && c.status === 'valid').map((c) => c.id);

    const res = await this.request.delete(`${this.API}/consents/${target.id}`, { headers: await this.headers() });
    const body = await res.json().catch(() => ({}));
    assertCondition(OP, res.ok(), `status ${res.status()}`, '200', body);

    const after = await this.getConsents();
    console.log(`🗑️ ${provider} #${target.id} გაითიშა — სიაში ${after.length} consent`);
    assertCondition(OP, !after.some((c) => c.id === target.id), `#${target.id} გათიშვის შემდეგ ისევ სიაშია`, 'consent სიიდან ქრება',
      after.find((c) => c.id === target.id));
    const lost = others.filter((id) => !after.some((c) => c.id === id && c.status === 'valid'));
    assertCondition(OP, !lost.length, `გათიშვამ სხვა consent-ებიც შეცვალა: #${lost.join(', #')}`, 'სხვა consent-ები უცვლელია', lost);
    const left = await this.getTransactions({ page: 0, size: 20, consentId: target.id });
    assertCondition(OP, left.totalElements === 0, `#${target.id}-ის ${left.totalElements} ტრანზაქცია ისევ სიაშია`, 'გათიშული consent-ის ტრანზაქციები ქრება',
      left.content.slice(0, 3));
  }

  /** ლიმიტის ამოწურვის შემდეგ refresh უარყოფილია გასაგები შეცდომით, მთვლელი არ იზრდება */
  async checkRefreshLimit(provider: Provider) {
    const OP = `POST /bank-account/consents/{id}/refresh (${provider} — ლიმიტი)`;
    let consent = await this.validConsent(provider);
    for (let i = 0; i < 5 && consent.callsUsedToday < consent.frequencyPerDay; i++) {
      const r = await this.request.post(`${this.API}/consents/${consent.id}/refresh`, { headers: await this.headers() });
      if (r.ok()) consent = (await r.json()).value;
    }
    const res = await this.request.post(`${this.API}/consents/${consent.id}/refresh`, { headers: await this.headers() });
    const body = await res.json().catch(() => ({}));
    const after = await this.validConsent(provider);
    console.log(`⛔ ${provider} #${consent.id} ლიმიტის მერე refresh → ${res.status()} ${body.message || ''} · მთვლელი ${consent.callsUsedToday} → ${after.callsUsedToday}/${after.frequencyPerDay}`);
    assertCondition(OP, res.status() >= 400 && res.status() < 500, `ლიმიტის ამოწურვის მერე refresh გავიდა (status ${res.status()})`,
      '4xx — გასაგები შეცდომის კოდით', body);
    assertCondition(OP, after.callsUsedToday === consent.callsUsedToday, `უარყოფილ refresh-ზე მთვლელი გაიზარდა ${consent.callsUsedToday} → ${after.callsUsedToday}`,
      'მთვლელი უცვლელი', after);
  }

  // ─────────────────────────── ძიება ───────────────────────────

  /** Transaction ID — სრული: მოდის ზუსტად ეს ტრანზაქცია, ერთხელ */
  async checkSearchTransactionIdExact(provider: Provider) {
    const OP = `GET /bank-account/transactions (Transaction ID სრული · ${provider})`;
    const sample = await this.sampleTransaction((t) => t.providerId === PROVIDER_ID[provider]);
    const page = await this.checkTransactions({ transactionId: sample.transactionId });
    const wrong = page.content.filter((t: any) => !t.transactionId.includes(sample.transactionId));
    assertCondition(OP, !wrong.length, `${wrong.length} ტრანზაქცია ძიებას არ ემთხვევა`, `transactionId ⊇ ${sample.transactionId}`, wrong.slice(0, 3));
    const same = page.content.filter((t: any) => t.transactionId === sample.transactionId && t.accountIban === sample.accountIban);
    assertCondition(OP, same.length === 1, `${sample.transactionId} სიაში ${same.length}-ჯერ ჩანს`, '1 ტრანზაქცია',
      same.map((t: any) => ({ id: t.id, consentId: t.consentId, transactionId: t.transactionId })));
  }

  /** Counterparty (Recipient) IBAN — სრული ან ნაწილობრივი (მაგ. TB0000000450109783) */
  async checkSearchCounterpartyIban(provider: Provider, partial: boolean) {
    const sample = await this.sampleTransaction((t) => t.providerId === PROVIDER_ID[provider] && !!(t.creditorIban || t.debtorIban));
    const iban: string = sample.creditorIban || sample.debtorIban;
    const query = partial ? iban.slice(4) : iban;
    await this.checkFilter(`Counterparty IBAN ${partial ? 'ნაწილობრივი' : 'სრული'} · ${provider}`, { counterpartyIban: query },
      (t) => `${t.creditorIban || ''}|${t.debtorIban || ''}`.includes(query));
  }

  /** ძიება არარსებული მნიშვნელობით → ცარიელი სია (არა შეცდომა) */
  async checkSearchNotFound(filter: TransactionFilter) {
    const OP = `GET /bank-account/transactions (არარსებული: ${JSON.stringify(filter)})`;
    const page = await this.checkTransactions(filter);
    assertCondition(OP, page.totalElements === 0, `მოვიდა ${page.totalElements} ტრანზაქცია`, '0 ტრანზაქცია', page.content.slice(0, 3));
  }

  // ─────────────────────────── ნეგატიური (API) ───────────────────────────

  /** token-ის გარეშე API მიუწვდომელია */
  async checkNoToken() {
    for (const path of ['/consents', '/transactions', '/providers']) {
      const res = await this.request.get(`${this.API}${path}`);
      assertCondition(`GET /bank-account${path} (token-ის გარეშე)`, [401, 403].includes(res.status()),
        `status ${res.status()}`, '401 / 403', await res.text().catch(() => ''));
    }
  }

  /** არარსებული consent-ის გათიშვა / განახლება → 4xx (არა 200 / 500) */
  async checkUnknownConsent() {
    const id = 99999999;
    for (const [method, path] of [['DELETE', `/consents/${id}`], ['POST', `/consents/${id}/refresh`], ['GET', `/consents/${id}`]] as const) {
      const res = await this.request.fetch(`${this.API}${path}`, { method, headers: await this.headers() });
      assertCondition(`${method} /bank-account${path.replace(String(id), '{არარსებული id}')}`, res.status() >= 400 && res.status() < 500,
        `status ${res.status()}`, '4xx (404)', await res.json().catch(() => ''));
    }
  }

  // ─────────────────────────── API ───────────────────────────

  private async headers() {
    if (!this.token) {
      this.token = await new AdminAuthPage(this.request, this.cfg.admin).authenticate(this.cfg.username, this.cfg.password);
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  async getConsents(): Promise<any[]> {
    const res = await this.request.get(`${this.API}/consents`, { headers: await this.headers() });
    const body = await res.json().catch(() => ({}));
    assertCondition('GET /bank-account/consents', res.ok(), `status ${res.status()}`, '200', body);
    return body.value;
  }

  /** პირველი valid consent (ბანკით ან ნებისმიერი) — დანარჩენი ტესტები ამას იყენებს */
  async validConsent(provider?: Provider) {
    const consents = await this.getConsents();
    const consent = consents.find((c) => c.status === 'valid' && (!provider || c.providerId === PROVIDER_ID[provider]));
    assertCondition('GET /bank-account/consents', !!consent, `valid consent არ არის${provider ? ` (${provider})` : ''} — ჯერ ბანკი უნდა დაკავშირდეს (Connect bank)`,
      `მინიმუმ 1 consent status = valid${provider ? ` · providerId ${PROVIDER_ID[provider]}` : ''}`, consents.map((c) => ({ id: c.id, name: c.name, status: c.status })));
    return consent;
  }

  async getTransactions(filter: TransactionFilter) {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as Record<string, string | number>;
    const res = await this.request.get(`${this.API}/transactions`, { headers: await this.headers(), params });
    const body = await res.json().catch(() => ({}));
    assertCondition('GET /bank-account/transactions', res.ok(), `status ${res.status()} — ${body.message || ''}`, '200', body);
    return body.value;
  }
}
