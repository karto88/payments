import { APIRequestContext, chromium } from '@playwright/test';
import { AdminAuthPage } from '../../pages/AdminAuthPage';
import { AuthPage } from '../../pages/AuthPage';
import { AuthDevicePage } from '../../pages/AuthDevicePage';
import { PaymentPage } from '../../pages/PaymentPage';
import { GmailHelper } from '../GmailHelper';
import { fillOTPAndVerifyTBC, closePaymentSuccess } from '../PaymentFlowHelper';
import { TransactionChecker } from '../transactionChecker';
import { CARDS } from '../../config/cards.config';
import { API_CONFIG } from '../../config/api.config';
import { INTEGRATORS } from '../../config/integrators.config';
import { assertCondition, assertField } from '../assertions';
import { readXlsxRows } from '../XlsxReader';

const OP_SUMMARY = 'POST /refund-reports/summary';
const OP_DETAILS = 'POST /refund-reports/details';
const OP_REFUND = 'Refund report — payment + refund';
const OP_BALANCE = 'GET /wallet/balances';
const OP_CASH_OUT = 'POST /wallet/cash-out';
const OP_ADD_MONEY = 'POST /wallet/add-money';
const OP_EXCEL = 'POST /refund-reports/preview (Excel)';
const OP_SEND = 'POST /refund-reports/send (email)';

const BASE_URL = 'https://newadmin.dev.keepz.me/api/v1/refund-reports';

// merchant 599000555 (stromae refund report) payload template — merchant/update-ისთვის (PUT + blob), საწყისი distributionFlow: STANDARD
const MERCHANT_599000555: any = {"installmentPermission":false,"isInitialDefault":null,"isAcquiringDefault":null,"isDistributorDefault":null,"initialCurrencies":null,"distributorCurrency":null,"acquiringCurrency":null,"softPosMerchantDetailsId":null,"dashboardCurrency":"GEL","comment":null,"SDA":false,"distributionFlow":"STANDARD","delayDistributeTime":null,"commissionType":"SENDER","personalNumber":"34252525522","fieldOfActivity1":"","registrationDate":"","email":"keepz07011@mailinator.com","geoMask":true,"iban":"GE29TB7197445064300124","name":"stromae refund report","databaseId":"6f99d426-6042-4b27-addb-33e6fc188c3e","status":"ACTIVE","isVerified":false,"phoneNumber":"599000555","countryCode":"995","merchantType":"MERCHANT","printing":false,"transactionAction":true,"branchRefundPermission":false,"documentNames":[],"completionDate":"2026-10-12T14:58:47","createdAt":"2026-10-12T14:58:47","masterBranchId":"fa14f6c6-a3a4-4563-8eb0-2e4859fa70b9","isMock":false,"merchantBranding":{"headerColor":"#170738","buttonColor":"#6C63FF","buttonTextColor":"#FFFFFF","titleColor":"#FFFFFF"},"paymentForbiddenInApp":false,"verificationInfo":{"tppay":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"nuvei":{"enabled":false,"status":null,"errorMessage":null,"lastActionDate":null},"keepz":{"signingRequired":false,"merchantSigned":null,"signatureLink":null}},"isActive":true,"naprVerified":false,"naprVerificationDate":null,"removeProfileImage":false,"phoneNumberDetails":{"phoneNumber":"599000555","countryCode":"995"},"merchantId":"6f99d426-6042-4b27-addb-33e6fc188c3e","saleId":"17","marketplaceId":null,"descriptionFlowId":null,"accountManagerId":"720","merchantGroupId":"278","documentsToRemove":null,"monthlyIncome":null,"officialName":"kartozia","officialLastName":null,"salesBranchId":null,"scheduleFrequency":null,"sectorId":null,"industryId":null,"details":{"actualAddress":null,"sdaVerified":false,"pep":null,"registrationCountry":null,"objectAddress":null,"ownerFirstName":null,"ownerLastName":null,"contactFirstName":null,"contactLastName":null,"contactPhoneNumber":null,"subMerchantUrl":null,"postalCode":null,"sdaDetails":{"userGender":null,"dateOfExpiry":"","dateOfIssue":"","birthDate":"","documentStatus":null,"legalAddress":""}}};

export type RefundSource = 'IN_BALANCE' | 'OVER_BALANCE' | 'UNSPECIFIED';

/** report-ის ფილტრის პერიოდი: DAY — დღეს | MONTH — მიმდინარე თვე (1 რიცხვიდან დღემდე) */
export type ReportPeriod = 'DAY' | 'MONTH';
export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

/** ჩვენი refund (payAndRefund-ის შედეგი) */
export interface OurRefund {
  transactionId: number;        // = report-ის originalTransactionId
  currency: string;
  expectedRefundAmount: number; // full → acquiringAmount (საკომისიოთი) | partial → refundAmount
}

/** ვინ აკეთებს refund-ს */
export type RefundVia = 'INTEGRATOR' | 'MERCHANT' | 'ADMIN';

/** refund report-ის ტესტის საერთო პარამეტრები */
export interface RefundReportCheckConfig {
  merchantId: string;
  receiverId: string;
  integratorId: string;
  phone: string; // merchant-ის device login — ბალანსი, cash-out, merchant refund
  refundVia: RefundVia;
}

/** ერთი გადახდა + refund: refundAmount არ არის → full, არის → partial */
export interface RefundStep {
  amount: number;
  currency: 'GEL' | 'USD' | 'EUR';
  refundAmount?: number;
  payWith?: 'CARD' | 'OB_TBC'; // default CARD (TBC ბარათი) | OB_TBC — TBC Open Banking (refund დიდხანს სრულდება)
}

/** ტესტამდე წაკითხული მონაცემები: summary + details-ის source-ების რაოდენობა (+ Excel, თუ ვამოწმებთ) */
interface ReportSnapshot {
  summary: any;
  sourceCounts: Record<'IN_BALANCE' | 'OVER_BALANCE', number>;
  excel?: ExcelReport;
}

/** Excel (preview) — refund-ების სტრიქონები + ქვედა ჯამები (label → რიცხვი) */
interface ExcelReport {
  rows: Array<{ txId: number; refundAmount: number; refundCurrency: string; refundAmountGel: number; status: string; source: string }>;
  totals: Record<string, number>; // მაგ. 'Over Balance refunds count:' → 23, 'Total in GEL:' → 2.5
}

/**
 * Refund Reports Module (KD-2164) — ადმინკის refund report-ი. ორ endpoint-ს ვამოწმებთ:
 *   1. Refund Reports (summary)        — Refund Count, Total Amount (GEL), Currency Breakdown: იყო → გახდა
 *   2. Refund Report Details (details) — ჩვენი refund-ები სწორ source-შია + In Balance / Over Balance რაოდენობა: იყო → გახდა
 * Refund source:
 *   IN_BALANCE   — refund merchant-ის ბალანსიდან მოიჭრა
 *   OVER_BALANCE — ბალანსზე არ ჰქონდა / არ ეყო → Keepz-ის ხარჯზე
 */
export class RefundReportsHelper {
  private request: APIRequestContext;
  private adminToken = '';

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * report-ის პერიოდი (from / to, YYYY-MM-DD, ლოკალური):
   *   DAY   — დღეს (from = to = დღეს)
   *   MONTH — მიმდინარე თვე (from = თვის 1 რიცხვი, to = დღეს)
   */
  static period(period: ReportPeriod = 'DAY'): DateRange {
    const now = new Date();
    const to = now.toLocaleDateString('sv-SE');
    const from = period === 'MONTH' ? new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('sv-SE') : to;
    return { from, to };
  }

  private async token(): Promise<string> {
    if (!this.adminToken) this.adminToken = await new AdminAuthPage(this.request).authenticate();
    return this.adminToken;
  }

  // ============================================================
  //  ტესტები (spec-იდან ერთი გამოძახებით)
  // ============================================================

  /**
   * Over Balance — ბალანსს ვანულებთ (cash-out), STANDARD flow (გადახდა IBAN-ზე მიდის, ბალანსზე არ ჯდება) →
   * თითო გადახდის refund → report-ის შედარება (ბალანსი 0 → ყველა source OVER_BALANCE).
   * checkExcel: true → Excel-იც (preview) გადმოიწერება ტესტამდე და ბოლოს, და მოწმდება.
   */
  async checkOverBalanceRefunds(config: RefundReportCheckConfig & { iban: string; refunds: RefundStep[]; period?: ReportPeriod; checkExcel?: boolean }) {
    await this.updateMerchantFlow('STANDARD');
    await this.expectMerchantFlow(config.merchantId, 'STANDARD');
    await this.cashOutAllBalance(config.phone, config.merchantId, config.iban);

    const range = RefundReportsHelper.period(config.period);
    const before = await this.snapshot(config.merchantId, range, config.checkExcel);

    const refunds: OurRefund[] = [];
    for (const step of config.refunds) refunds.push(await this.payAndRefund({ ...this.order(config), ...step }));

    await this.compareReport(config.merchantId, range, before, refunds, refunds.map(() => 'OVER_BALANCE' as RefundSource));
  }

  /**
   * In Balance — BALANCE flow: ჯერ ბალანსის შევსება (გადახდები refund-ის გარეშე — თითო ვალუტაზე, რადგან ბალანსი
   * ვალუტებით ცალკეა და refund-ის საკომისიოსაც merchant იხდის), შემდეგ თითო გადახდის refund ბალანსიდან →
   * report-ის შედარება (ყველა source IN_BALANCE).
   */
  async checkInBalanceRefunds(config: RefundReportCheckConfig & {
    balanceTopUpPayments: Array<{ amount: number; currency: 'GEL' | 'USD' | 'EUR' }>; // refund-ის გარეშე — ბალანსის შესავსებად
    refunds: RefundStep[];                                                            // შემდეგი გადახდები — თითოეულს ვარეფანდებთ
  }) {
    await this.updateMerchantFlow('BALANCE');
    await this.expectMerchantFlow(config.merchantId, 'BALANCE');

    const range = RefundReportsHelper.period('DAY');
    const before = await this.snapshot(config.merchantId, range);

    for (const topUp of config.balanceTopUpPayments) await this.payOnly({ ...this.order(config), ...topUp });
    const refunds: OurRefund[] = [];
    for (const step of config.refunds) refunds.push(await this.payAndRefund({ ...this.order(config), ...step }));

    await this.compareReport(config.merchantId, range, before, refunds, refunds.map(() => 'IN_BALANCE' as RefundSource));
  }

  private order(config: RefundReportCheckConfig) {
    return { receiverId: config.receiverId, receiverType: 'BRANCH', integratorId: config.integratorId, phone: config.phone, refundVia: config.refundVia };
  }

  // ============================================================
  //  შედარება
  // ============================================================

  /** ტესტამდე: summary + details-ში In Balance / Over Balance რაოდენობა (+ Excel, თუ withExcel) */
  private async snapshot(merchantId: string, range: DateRange, withExcel = false): Promise<ReportSnapshot> {
    return {
      summary: await this.getSummary(merchantId, range),
      sourceCounts: RefundReportsHelper.countBySource(await this.getDetails(merchantId, range)),
      ...(withExcel ? { excel: await this.getExcel(merchantId, range) } : {}),
    };
  }

  /** 1. Refund Reports (summary) → 2. Refund Report Details (source-ები) → 3. Excel (თუ ტესტამდე გადმოვწერეთ) */
  private async compareReport(merchantId: string, range: DateRange, before: ReportSnapshot, refunds: OurRefund[], expectedSources: RefundSource[]) {
    // ჩვენი refund-ები details-ში (report-ში refund დისტრიბუციის შემდეგ ჩნდება — ვაცდით)
    const ours = await this.waitForRefundsInDetails(merchantId, range, refunds.map((r) => r.transactionId));
    assertCondition(OP_DETAILS, ours.length === refunds.length,
      `details-ში ჩვენი refund-ებიდან მოიძებნა ${ours.length}/${refunds.length}`,
      `ყველა refund details-ში: tx ${refunds.map((r) => r.transactionId).join(', ')}`, ours);

    await this.expectSummary(merchantId, range, before.summary, ours);
    await this.expectDetailsSources(merchantId, range, before.sourceCounts, refunds, ours, expectedSources);
    if (before.excel) await this.expectExcel(merchantId, range, before.excel, refunds, ours, expectedSources);
  }

  /**
   * 3. Excel (preview) — იყო → გახდა:
   *   ჩვენი თითო refund-ის სტრიქონი (თანხა, ვალუტა, source, SUCCESS) + ქვედა ჯამები = იყო + ჩვენი
   *   (Over / In Balance count და თანხა ვალუტებით, Total refunds, Total ვალუტებით, Grand total GEL)
   *   + Excel-ის ჯამი = summary endpoint (Refund Count, Total Amount GEL, Currency Breakdown).
   */
  private async expectExcel(merchantId: string, range: DateRange, before: ExcelReport, refunds: OurRefund[], ours: any[], expectedSources: RefundSource[]) {
    const round = (n: number) => Math.round(n * 100) / 100;
    const after = await this.getExcel(merchantId, range);
    const sourceLabel = (s: RefundSource) => (s === 'IN_BALANCE' ? 'In Balance' : 'Over Balance');
    const problems: string[] = [];
    const mark = (ok: boolean, problem: string) => { if (!ok) problems.push(problem); return ok ? '✅' : '❌'; };

    console.log(`\n📊 Excel (preview) — ${RefundReportsHelper.rangeLabel(range)}`);

    // ჩვენი refund-ების სტრიქონები
    const added: Record<string, number> = {}; // Excel-ის label → რამდენი უნდა დაემატოს
    const add = (label: string, value: number) => { added[label] = round((added[label] || 0) + value); };
    refunds.forEach((r, i) => {
      const detail = ours.find((x) => x.originalTransactionId === r.transactionId);
      const row = after.rows.find((x) => x.txId === r.transactionId);
      const source = sourceLabel(expectedSources[i]);
      const ok = !!row && row.source === source && row.status === 'SUCCESS' &&
        row.refundAmount === detail?.refundAmount && row.refundCurrency === detail?.refundCurrency;
      console.log(`   tx ${r.transactionId}: ${row ? `${row.refundAmount} ${row.refundCurrency} · ${row.source} · ${row.status}` : 'Excel-ში არ ჩანს'} (უნდა ${detail?.refundAmount} ${detail?.refundCurrency} · ${source} · SUCCESS) ${mark(ok, `tx ${r.transactionId} Excel-ის სტრიქონი არასწორია`)}`);

      const amount = detail?.refundAmount ?? 0;
      const currency = detail?.refundCurrency ?? r.currency;
      add(`${source} refunds count:`, 1);
      add(`${source} refunds in ${currency}:`, amount);
      add('Total refunds:', 1);
      add(`Total in ${currency}:`, amount);
      add('Grand total (GEL equivalent):', detail?.refundAmountGel ?? 0);
    });

    // ქვედა ჯამები — იყო + ჩვენი = გახდა
    const labels = Array.from(new Set([...Object.keys(before.totals), ...Object.keys(after.totals), ...Object.keys(added)]));
    for (const label of labels) {
      const was = before.totals[label] || 0;
      const now = after.totals[label] || 0;
      const expected = round(was + (added[label] || 0));
      const tolerance = label.startsWith('Grand total') ? 0.011 : 0.001; // GEL-ში კონვერტაციის დამრგვალება
      const ok = Math.abs(now - expected) < tolerance;
      console.log(`   ${label.padEnd(32)} იყო ${was} → გახდა ${now} — დაემატა ${round(now - was)} (უნდა ${added[label] || 0}) ${mark(ok, `${label} იყო ${was} → გახდა ${now}, უნდა ${expected}`)}`);
    }

    // Excel = summary endpoint
    const summary = await this.getSummary(merchantId, range);
    const countOk = after.totals['Total refunds:'] === (summary?.refundCount ?? 0);
    const gelOk = Math.abs((after.totals['Grand total (GEL equivalent):'] || 0) - (summary?.totalRefundAmountGel ?? 0)) < 0.011;
    const breakdown: Record<string, number> = summary?.currencyBreakdown ?? {};
    const breakdownOk = Object.keys(breakdown).every((cur) => Math.abs((after.totals[`Total in ${cur}:`] || 0) - breakdown[cur]) < 0.001);
    console.log(`   Excel = summary: Total refunds ${after.totals['Total refunds:']} = ${summary?.refundCount} ${mark(countOk, 'Excel Total refunds ≠ summary Refund Count')} · Grand total ${after.totals['Grand total (GEL equivalent):']} = ${summary?.totalRefundAmountGel} ${mark(gelOk, 'Excel Grand total ≠ summary Total Amount (GEL)')} · ვალუტები ${mark(breakdownOk, 'Excel Total ვალუტებით ≠ summary Currency Breakdown')}`);

    assertCondition(OP_EXCEL, !problems.length, problems.join('; '),
      'Excel: ჩვენი refund-ების სტრიქონები სწორია, ჯამები = იყო + ჩვენი, Excel = summary', { before: before.totals, after: after.totals, added, summary });
  }

  /**
   * 1. Refund Reports (summary) — იყო → გახდა:
   *   Refund Count +N · Total Amount (GEL) + ჩვენი refund-ები · Currency Breakdown თითო ვალუტაზე + ჩვენი refund-ები
   */
  private async expectSummary(merchantId: string, range: DateRange, before: any, ours: any[]) {
    const round = (n: number) => Math.round(n * 100) / 100;
    const after = await this.getSummary(merchantId, range);

    // რა დაემატა — ჩვენი refund-ების თანხა (details-იდან)
    const addedByCurrency: Record<string, number> = {};
    let addedGel = 0;
    for (const r of ours) {
      addedByCurrency[r.refundCurrency] = round((addedByCurrency[r.refundCurrency] || 0) + r.refundAmount);
      addedGel = round(addedGel + r.refundAmountGel);
    }

    const countBefore = before?.refundCount ?? 0;
    const countAfter = after?.refundCount ?? 0;
    const countOk = countAfter === countBefore + ours.length;

    const gelBefore = before?.totalRefundAmountGel ?? 0;
    const gelAfter = after?.totalRefundAmountGel ?? 0;
    const gelOk = Math.abs(gelAfter - round(gelBefore + addedGel)) < 0.011; // კონვერტაციის დამრგვალება

    const breakdownBefore: Record<string, number> = before?.currencyBreakdown ?? {};
    const breakdownAfter: Record<string, number> = after?.currencyBreakdown ?? {};
    const currencies = Array.from(new Set([...Object.keys(breakdownBefore), ...Object.keys(breakdownAfter), ...Object.keys(addedByCurrency)]));

    console.log(`\n📊 Refund Reports — ${RefundReportsHelper.rangeLabel(range)}`);
    console.log(`   Refund Count:       იყო ${countBefore} → გახდა ${countAfter} — გაკეთდა ${countAfter - countBefore} refund (უნდა ${ours.length}) ${countOk ? '✅' : '❌'}`);
    console.log(`   Total Amount (GEL): იყო ${gelBefore} → გახდა ${gelAfter} — დაემატა ${round(gelAfter - gelBefore)} (უნდა ${addedGel}) ${gelOk ? '✅' : '❌'}`);
    let breakdownOk = true;
    for (const cur of currencies) {
      const was = breakdownBefore[cur] || 0;
      const now = breakdownAfter[cur] || 0;
      const ok = Math.abs(now - round(was + (addedByCurrency[cur] || 0))) < 0.001;
      breakdownOk = breakdownOk && ok;
      console.log(`   Currency Breakdown: ${cur} იყო ${was} → გახდა ${now} — დაემატა ${round(now - was)} (უნდა ${addedByCurrency[cur] || 0}) ${ok ? '✅' : '❌'}`);
    }

    const data = { before, after, ourRefunds: ours };
    assertCondition(OP_SUMMARY, countOk, `Refund Count: იყო ${countBefore} → გახდა ${countAfter}, უნდა ყოფილიყო ${countBefore + ours.length}`,
      `Refund Count +${ours.length}`, data);
    assertCondition(OP_SUMMARY, gelOk, `Total Amount (GEL): იყო ${gelBefore} → გახდა ${gelAfter}, უნდა დამატებოდა ${addedGel}`,
      `Total Amount (GEL) +${addedGel}`, data);
    assertCondition(OP_SUMMARY, breakdownOk, 'Currency Breakdown არ ემთხვევა: იყო + ჩვენი refund-ები',
      `Currency Breakdown + ${JSON.stringify(addedByCurrency)}`, data);
  }

  /**
   * 2. Refund Report Details — თანხების გარეშე, მხოლოდ source-ები:
   *   ჩვენი თითო refund სწორ source-შია + In Balance / Over Balance რაოდენობა: იყო → გახდა (დაემატა ზუსტად ჩვენი)
   */
  private async expectDetailsSources(merchantId: string, range: DateRange, before: Record<'IN_BALANCE' | 'OVER_BALANCE', number>,
    refunds: OurRefund[], ours: any[], expectedSources: RefundSource[]) {
    const after = RefundReportsHelper.countBySource(await this.getDetails(merchantId, range));

    console.log(`\n📊 Refund Report Details — ${RefundReportsHelper.rangeLabel(range)}`);
    const wrong: string[] = [];
    refunds.forEach((r, i) => {
      const row = ours.find((x) => x.originalTransactionId === r.transactionId);
      const ok = row?.refundSource === expectedSources[i];
      if (!ok) wrong.push(`tx ${r.transactionId} → ${row?.refundSource ?? 'არ ჩანს'} (უნდა ${expectedSources[i]})`);
      console.log(`   tx ${r.transactionId} → ${row?.refundSource ?? '-'} (უნდა ${expectedSources[i]}) ${ok ? '✅' : '❌'}`);
    });

    let countsOk = true;
    for (const [source, label] of [['IN_BALANCE', 'In Balance'], ['OVER_BALANCE', 'Over Balance']] as const) {
      const added = expectedSources.filter((s) => s === source).length;
      const ok = after[source] === before[source] + added;
      countsOk = countsOk && ok;
      console.log(`   ${label.padEnd(12)}: იყო ${before[source]} → გახდა ${after[source]} — დაემატა ${after[source] - before[source]} (უნდა ${added}) ${ok ? '✅' : '❌'}`);
    }

    assertCondition(OP_DETAILS, !wrong.length, `refund source არასწორია: ${wrong.join('; ')}`,
      'ბალანსი ≥ refund → IN_BALANCE, ნაკლები → OVER_BALANCE', { expectedSources, ours });
    assertCondition(OP_DETAILS, countsOk, 'In Balance / Over Balance რაოდენობა არ ემთხვევა: იყო + ჩვენი refund-ები',
      'თითო source-ს დაემატა ზუსტად ჩვენი refund-ები', { before, after, expectedSources });
  }

  /** details → In Balance / Over Balance რაოდენობა */
  private static countBySource(rows: any[]): Record<'IN_BALANCE' | 'OVER_BALANCE', number> {
    return {
      IN_BALANCE: rows.filter((r) => r.refundSource === 'IN_BALANCE').length,
      OVER_BALANCE: rows.filter((r) => r.refundSource === 'OVER_BALANCE').length,
    };
  }

  /** პერიოდი ლოგისთვის: „2026-10-13" ან „2026-10-01 → 2026-10-13" */
  private static rangeLabel(range: DateRange): string {
    return range.from === range.to ? range.from : `${range.from} → ${range.to}`;
  }

  // ============================================================
  //  report endpoint-ები
  // ============================================================

  /** summary — ერთი merchant-ის სტრიქონი პერიოდზე (ან undefined თუ refund არ აქვს) */
  async getSummary(merchantId: string, range: DateRange): Promise<any> {
    const response = await this.request.post(`${BASE_URL}/summary?page=0&size=10`, {
      headers: { 'Authorization': `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      data: { from: range.from, to: range.to, merchantIds: [merchantId] },
    });
    const body = await response.json().catch(() => ({}));
    assertCondition(OP_SUMMARY, response.ok(), `HTTP ${response.status()}`, 'HTTP 200', body);
    return (body.value?.content || []).find((m: any) => m.merchantId === merchantId);
  }

  /** details — merchant-ის ყველა refund პერიოდზე (გვერდებად, size 50) */
  async getDetails(merchantId: string, range: DateRange): Promise<any[]> {
    const rows: any[] = [];
    for (let page = 0; page < 20; page++) {
      const response = await this.request.post(`${BASE_URL}/details?page=${page}&size=50`, {
        headers: { 'Authorization': `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
        data: { from: range.from, to: range.to, merchantId },
      });
      const body = await response.json().catch(() => ({}));
      assertCondition(OP_DETAILS, response.ok(), `HTTP ${response.status()}`, 'HTTP 200', body);
      rows.push(...(body.value?.content || []));
      if (body.value?.last !== false) break;
    }
    return rows;
  }

  /**
   * Send report — report-ს ვაგზავნით მეილზე (POST /refund-reports/send), ვამოწმებთ რომ მეილი მოვიდა
   * და დანართის Excel ზუსტად ემთხვევა preview-ს Excel-ს (სტრიქონები + ჯამები) და summary endpoint-ს.
   */
  async checkSendReport(config: { merchantId: string; recipient: string; period?: ReportPeriod }) {
    const range = RefundReportsHelper.period(config.period);
    const sentFrom = new Date(Date.now() - 5000); // მეილის თარიღი წამის სიზუსტისაა — მცირე მარაგი

    // 1. გაგზავნა
    const response = await this.request.post(`${BASE_URL}/send`, {
      headers: { 'Authorization': `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      data: { merchantId: config.merchantId, from: range.from, to: range.to, additionalRecipients: [config.recipient] },
    });
    const sent = (await response.json().catch(() => ({}))).value;
    assertCondition(OP_SEND, response.ok() && !!sent?.id, `report-ის გაგზავნა ვერ მოხერხდა (HTTP ${response.status()})`, 'HTTP 200/201 + id', sent);
    assertCondition(OP_SEND, String(sent.recipients || '').includes(config.recipient),
      `მიმღებებში არ არის ${config.recipient}`, `recipients შეიცავს ${config.recipient}`, sent);
    console.log(`✅ Report sent (id ${sent.id}) → ${sent.recipients}`);

    // 2. მეილი — სათაური „Refund Report — <merchant>", დანართი xlsx
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    const email = await gmail.getLatestAttachment(`Refund Report — ${sent.merchantName}`, sentFrom, 90);
    console.log(`✅ Email received: "${email.subject}" from ${email.from} · ${email.filename}`);
    const emailed = RefundReportsHelper.parseExcel(email.content);

    // 3. შედარება — მიმდინარე (მეილის Excel) vs მოსალოდნელი (ადმინკა: preview Excel + summary).
    //    პირველივე შეუსაბამობაზე ტესტი მაშინვე ვარდება, მიზეზით.
    const preview = await this.getExcel(config.merchantId, range);
    const summary = await this.getSummary(config.merchantId, range);
    const check = (ok: boolean, line: string, problem: string, expected: string, actual: any) => {
      console.log(`   ${line} ${ok ? '✅' : '❌'}`);
      assertCondition(OP_SEND, ok, problem, expected, actual);
    };

    console.log(`\n📊 Send report — ${RefundReportsHelper.rangeLabel(range)} · მიმდინარე (მეილი) vs მოსალოდნელი (ადმინკა)`);

    // სტრიქონები — რაოდენობა, შემდეგ თითო refund თითო ველით
    check(emailed.rows.length === preview.rows.length,
      `სტრიქონები: მიმდინარე ${emailed.rows.length} · მოსალოდნელი ${preview.rows.length}`,
      `მეილის Excel-ში ${emailed.rows.length} refund-ია, ადმინკაში ${preview.rows.length}`,
      `${preview.rows.length} refund-ის სტრიქონი`, { emailed: emailed.rows.map((r) => r.txId), preview: preview.rows.map((r) => r.txId) });
    preview.rows.forEach((expected, i) => {
      const actual = emailed.rows[i];
      const field = (Object.keys(expected) as Array<keyof typeof expected>).find((k) => actual?.[k] !== expected[k]);
      if (field) {
        check(false, `სტრიქონი ${i + 1} (tx ${expected.txId}): ${field} — მიმდინარე ${actual?.[field]} · მოსალოდნელი ${expected[field]}`,
          `მეილის Excel-ში tx ${expected.txId}-ის „${field}" არასწორია: ${actual?.[field]}, უნდა იყოს ${expected[field]}`,
          JSON.stringify(expected), actual);
      }
    });
    console.log(`   ყველა ${preview.rows.length} სტრიქონი ველ-ველ ემთხვევა ✅`);

    // ქვედა ჯამები
    for (const label of Array.from(new Set([...Object.keys(preview.totals), ...Object.keys(emailed.totals)]))) {
      check(emailed.totals[label] === preview.totals[label],
        `${label.padEnd(32)} მიმდინარე ${emailed.totals[label]} · მოსალოდნელი ${preview.totals[label]}`,
        `მეილის Excel-ში „${label}" ${emailed.totals[label]}, ადმინკაში ${preview.totals[label]}`,
        `${label} ${preview.totals[label]}`, { emailed: emailed.totals, preview: preview.totals });
    }

    // summary endpoint
    check(emailed.totals['Total refunds:'] === summary?.refundCount && sent.refundCount === summary?.refundCount,
      `Refund Count:  მიმდინარე ${emailed.totals['Total refunds:']} (send response ${sent.refundCount}) · მოსალოდნელი ${summary?.refundCount} (summary)`,
      `refund-ების რაოდენობა: მეილში ${emailed.totals['Total refunds:']}, send response-ში ${sent.refundCount}, summary-ში ${summary?.refundCount}`,
      `Refund Count ${summary?.refundCount}`, { sent, summary });
    check(Math.abs((emailed.totals['Grand total (GEL equivalent):'] || 0) - (summary?.totalRefundAmountGel ?? 0)) < 0.011,
      `Total (GEL):   მიმდინარე ${emailed.totals['Grand total (GEL equivalent):']} · მოსალოდნელი ${summary?.totalRefundAmountGel} (summary)`,
      `Grand total: მეილში ${emailed.totals['Grand total (GEL equivalent):']}, summary-ში ${summary?.totalRefundAmountGel}`,
      `Total Amount (GEL) ${summary?.totalRefundAmountGel}`, { emailed: emailed.totals, summary });
    console.log('   ✅ მეილზე მოსული Excel = ადმინკის მონაცემები');
  }

  /** Excel (POST /refund-reports/preview → xlsx) — refund-ების სტრიქონები + ქვედა ჯამები */
  async getExcel(merchantId: string, range: DateRange): Promise<ExcelReport> {
    const response = await this.request.post(`${BASE_URL}/preview`, {
      headers: { 'Authorization': `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      data: { from: range.from, to: range.to, merchantId },
    });
    assertCondition(OP_EXCEL, response.ok(), `HTTP ${response.status()}`, 'HTTP 200 + xlsx', await response.text().catch(() => '').then((t) => t.slice(0, 300)));
    return RefundReportsHelper.parseExcel(await response.body());
  }

  /** xlsx (preview ან მეილის დანართი) → refund-ების სტრიქონები + ქვედა ჯამები */
  private static parseExcel(xlsx: Buffer): ExcelReport {
    const sheet = readXlsxRows(xlsx);

    // სტრიქონები — header-ის ("Refund Date") შემდეგ, პირველ ცარიელ სტრიქონამდე
    const header = sheet.findIndex((r) => r[0] === 'Refund Date');
    const col = (name: string) => sheet[header].indexOf(name);
    const rows: ExcelReport['rows'] = [];
    for (let i = header + 1; i < sheet.length && sheet[i]?.[0]; i++) {
      const r = sheet[i];
      rows.push({
        txId: Number(r[col('Original Tx ID')]),
        refundAmount: Number(r[col('Refund Amount')]),
        refundCurrency: r[col('Refund Currency')],
        refundAmountGel: Number(r[col('Refund Amount (GEL)')]),
        status: r[col('Refund Status')],
        source: r[col('Refund Source')],
      });
    }

    // ქვედა ჯამები — „Label:" | რიცხვი
    const totals: Record<string, number> = {};
    for (const r of sheet) {
      if (r?.[0]?.endsWith(':') && r[1] !== undefined && r[1] !== '' && !isNaN(Number(r[1]))) totals[r[0]] = Number(r[1]);
    }
    return { rows, totals };
  }

  /** details — ველოდებით სანამ ჩვენი ყველა refund გამოჩნდება (~10 წთ), გამოუჩენლებს ხელს ვაწერთ (update-status) */
  private async waitForRefundsInDetails(merchantId: string, range: DateRange, ourTransactionIds: number[]): Promise<any[]> {
    const checker = new TransactionChecker(this.request);
    let ours: any[] = [];
    for (let i = 0; i < 60; i++) {
      const rows = await this.getDetails(merchantId, range);
      ours = rows.filter((r) => ourTransactionIds.includes(r.originalTransactionId));
      if (ours.length >= ourTransactionIds.length) break;
      const missing = ourTransactionIds.filter((id) => !ours.some((r) => r.originalTransactionId === id));
      if (i === 0) console.log(`⏳ report-ში ჯერ არ ჩანს: tx ${missing.join(', ')} — ველოდებით დისტრიბუციას (~10 წთ-მდე)`);
      for (const id of missing) { try { await checker.signById(id); } catch { /* ignore */ } }
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    return ours;
  }

  // ============================================================
  //  გადახდა + refund
  // ============================================================

  /**
   * ბარათით გადახდა → refund (full ან partial; INTEGRATOR / MERCHANT / ADMIN) → დასრულების მოლოდინი.
   *   refundAmount არ არის → full refund | არის → partial refund ამ თანხით
   *   INTEGRATOR — encrypt → POST /order/refund → decrypt (როგორც RefundIntegrator.refund; full → amount არ იგზავნება)
   *   MERCHANT   — POST /generic-transaction/refund { amount, genericTransactionId }, device token (როგორც RefundDevice; full → amount = გადახდის თანხა)
   *   ADMIN      — PUT /transaction/refund { amount, genericTransactionId } (როგორც RefundAdmin; full → amount: null)
   */
  async payAndRefund(config: {
    amount: number;
    currency: 'GEL' | 'USD' | 'EUR';
    refundAmount?: number;
    receiverId: string;
    receiverType?: string;
    integratorId: string;
    phone: string;
    refundVia: RefundVia;
    payWith?: 'CARD' | 'OB_TBC';
  }): Promise<OurRefund> {
    const paymentPage = new PaymentPage(this.request, null as any);
    const isFull = config.refundAmount === undefined;

    // 1-2. გადახდა (ბარათი ან TBC Open Banking) → SUCCESS
    const { accessToken, integratorOrderId, transactionId, acquiringAmount } = await this.payAndWaitSuccess(config);
    let status = 'SUCCESS';

    // 3. refund — full ან partial
    if (config.refundVia === 'ADMIN' || config.refundVia === 'MERCHANT') {
      await this.refundByTransactionId(config.refundVia, transactionId, config.phone, isFull ? config.amount : config.refundAmount!, isFull);
    } else {
      // INTEGRATOR — full → amount არ იგზავნება | partial → amount
      const refundData: any = { integratorId: config.integratorId, integratorOrderId, refundInitiator: 'INTEGRATOR' };
      if (!isFull) refundData.amount = config.refundAmount;
      const encrypted = await paymentPage.encryptOrderData(accessToken, refundData);
      const response = await this.request.post(`${API_CONFIG.ECOMMERCE.BASE_URL}${API_CONFIG.ECOMMERCE.ENDPOINTS.REFUND}`, {
        headers: { 'Content-Type': 'application/json' },
        data: { identifier: config.integratorId, encryptedData: encrypted.encryptedData, aes: true, encryptedKeys: encrypted.encryptedKeys },
      });
      const respJson = await response.json().catch(() => ({}));
      assertCondition(OP_REFUND, response.ok(), `refund ვერ მოთხოვნდა (HTTP ${response.status()})`, 'HTTP 200', respJson);
      const dec = await this.request.post('https://gateway.dev.keepz.me/payment-service/api/v1/test/decryptAES', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        data: { encryptedData: respJson.encryptedData, encryptedAESProperties: respJson.encryptedKeys, privateKey: INTEGRATORS.DEFAULT.PRIVATE_KEY },
      });
      const val = (await dec.json()).value;
      const refundResult = typeof val === 'string' ? JSON.parse(val) : val;
      assertField(OP_REFUND, refundResult, 'status', 'REFUND_REQUESTED');
    }

    // 4. refund-ის დასრულების მოლოდინი — full → REFUNDED_BY_* | partial → PARTIALLY_REFUNDED
    //    ბარათი ~1 წთ | Open Banking-ზე refund ჯერ Initiated-ია (REFUND_REQUESTED) და Success-ს წუთებში აღწევს → ~4 წთ
    const isOpenBanking = config.payWith === 'OB_TBC';
    if (isOpenBanking) console.log('⏳ OB refund Initiated — ველოდებით Success-ს (~4 წთ-მდე)');
    for (let i = 0; i < (isOpenBanking ? 80 : 20) && !status.includes('REFUNDED'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      status = (await paymentPage.getOrderStatus(accessToken, config.integratorId, integratorOrderId))?.status ?? '';
    }
    assertCondition(OP_REFUND, status.includes('REFUNDED'),
      `refund არ დასრულდა (status: ${status})`, 'status = REFUNDED_* / PARTIALLY_REFUNDED', { integratorOrderId, status, transactionId });

    const expectedRefundAmount = isFull ? acquiringAmount : config.refundAmount!;
    console.log(`✅ ${isFull ? 'Full' : 'Partial'} refund via ${config.refundVia} — ${expectedRefundAmount} ${config.currency} (tx ${transactionId}, ${status})`);

    return { transactionId, currency: config.currency, expectedRefundAmount };
  }

  /**
   * refund ტრანზაქციის ID-ით (ორდერის გარეშე — add money-ზეც მუშაობს):
   *   ADMIN    — PUT /transaction/refund { amount, genericTransactionId } (full → amount: null)
   *   MERCHANT — POST /generic-transaction/refund { amount, genericTransactionId }, device token (full → amount = გადახდის თანხა)
   */
  private async refundByTransactionId(refundVia: 'ADMIN' | 'MERCHANT', transactionId: number, phone: string, amount: number, isFull: boolean) {
    if (refundVia === 'ADMIN') {
      // ⚠️ refund არის PUT (POST → 500)
      const response = await this.request.put('https://newadmin.dev.keepz.me/api/transaction/refund', {
        headers: { 'Authorization': `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
        data: { amount: isFull ? null : amount, genericTransactionId: transactionId },
      });
      assertCondition(OP_REFUND, response.ok(), `admin refund ვერ შესრულდა (HTTP ${response.status()})`, 'HTTP 200',
        await response.text().catch(() => ''));
    } else {
      const deviceToken = await new AuthDevicePage(this.request).authenticate(phone);
      const response = await this.request.post('https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/refund', {
        headers: { 'Authorization': `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
        data: { amount, genericTransactionId: transactionId },
      });
      assertCondition(OP_REFUND, response.ok(), `merchant refund ვერ შესრულდა (HTTP ${response.status()})`, 'HTTP 200',
        await response.text().catch(() => ''));
    }
  }

  // ============================================================
  //  add money (top-up) + refund
  // ============================================================

  /**
   * Add money — merchant ბალანსს ავსებს add money-თ (ბარათით), შემდეგ თითოეულ top-up-ს ვარეფანდებთ (ADMIN ან MERCHANT)
   * → report-ის შედარება. ჯერ ყველა top-up, მერე ყველა refund — full refund საკომისიოთი იჭრება (0.1 → 0.11),
   * ამიტომ ბალანსი წინასწარ უნდა დაგროვდეს → ყველა source IN_BALANCE.
   */
  async checkAddMoneyRefunds(config: RefundReportCheckConfig & { refundVia: 'ADMIN' | 'MERCHANT'; refunds: RefundStep[] }) {
    await this.updateMerchantFlow('STANDARD');
    await this.expectMerchantFlow(config.merchantId, 'STANDARD');

    const range = RefundReportsHelper.period('DAY');
    const before = await this.snapshot(config.merchantId, range);

    // 1. ყველა top-up
    const topUps: number[] = [];
    for (const step of config.refunds) topUps.push(await this.addMoneyTopUp(config.phone, step.amount, step.currency));

    // 2. ყველა refund
    const refunds: OurRefund[] = [];
    for (let i = 0; i < config.refunds.length; i++) {
      const step = config.refunds[i];
      const isFull = step.refundAmount === undefined;
      await this.refundByTransactionId(config.refundVia, topUps[i], config.phone, isFull ? step.amount : step.refundAmount!, isFull);
      await this.waitForTopUpRefunded(config.phone, topUps[i]);
      console.log(`✅ ${isFull ? 'Full' : 'Partial'} refund via ${config.refundVia} — add money ${step.amount} ${step.currency} (tx ${topUps[i]})`);
      refunds.push({ transactionId: topUps[i], currency: step.currency, expectedRefundAmount: isFull ? step.amount : step.refundAmount! });
    }

    await this.compareReport(config.merchantId, range, before, refunds, refunds.map(() => 'IN_BALANCE' as RefundSource));
  }

  /** add money → ბარათით გადახდა (TBC) → ჩვენი TOP_UP ტრანზაქცია (COLLECTED) — აბრუნებს transactionId-ს */
  private async addMoneyTopUp(phone: string, amount: number, currency: 'GEL' | 'USD' | 'EUR'): Promise<number> {
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();
    const token = await new AuthDevicePage(this.request).authenticate(phone);
    const idsBefore = new Set((await this.getMerchantTransactions(token)).map((t) => t.id));

    // add money → payment link
    const response = await this.request.post('https://walletportal.dev.keepz.me/api/v1/wallet/add-money', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { amount, currencyCode: currency },
    });
    const body = await response.json().catch(() => ({}));
    assertCondition(OP_ADD_MONEY, response.ok() && typeof body.value === 'string', `payment link არ დაბრუნდა (HTTP ${response.status()})`,
      'HTTP 200 და value = payment link', body);
    console.log(`✅ Add money — ${amount} ${currency}`);

    await this.payLinkWithCard(body.value, gmail);

    // ჩვენი TOP_UP — ახალი ტრანზაქცია (initialAmount + currency), COLLECTED-ის მოლოდინი
    let tx: any;
    for (let i = 0; i < 20 && tx?.status !== 'COLLECTED'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      tx = (await this.getMerchantTransactions(token)).find((t) =>
        !idsBefore.has(t.id) && t.operationType === 'TOP_UP' && t.initialAmount === amount && t.currencyCode === currency);
    }
    assertCondition(OP_ADD_MONEY, tx?.status === 'COLLECTED', `add money ${amount} ${currency}: TOP_UP ტრანზაქცია COLLECTED-ზე ვერ გადავიდა (status: ${tx?.status ?? 'ვერ მოიძებნა'})`,
      'TOP_UP · COLLECTED', tx);
    console.log(`✅ Top-up COLLECTED (tx ${tx.id})`);
    return tx.id;
  }

  /** გადახდის გვერდის გახსნა → საბანკო ბარათი (TBC) → OTP → success (add money / merchant-ის payment link) */
  private async payLinkWithCard(url: string, gmail: GmailHelper, expectedAmount?: number) {
    const context = await chromium.launchPersistentContext('./playwright-card-data', { headless: false, channel: 'chrome' });
    const page = await context.newPage();
    await page.goto(url);
    const cardButton = page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ });
    await cardButton.waitFor({ state: 'visible' });

    // ფიქსირებული თანხის ლინკი — გვერდზე ზუსტად მოსალოდნელი თანხა უნდა ეწეროს („თანხა 0.2 ₾" / „Amount 0.2 ₾")
    if (expectedAmount !== undefined) {
      const shown = /(?:თანხა|Amount)\s*([\d.]+)\s*₾/.exec(await page.locator('body').innerText())?.[1];
      console.log(`✅ Payment page amount: ${shown} (უნდა ${expectedAmount})`);
      if (Number(shown) !== expectedAmount) {
        await context.close().catch(() => {});
        assertCondition(OP_REFUND, false, `გადახდის გვერდზე თანხა ${shown}, უნდა იყოს ${expectedAmount}`, `თანხა ${expectedAmount}`, { url, shown });
      }
    }

    await cardButton.click();
    await page.waitForTimeout(2000);
    await page.locator('#cardNumber').fill(CARDS.TBC.number);
    await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
    await page.locator('#cvc2').fill(CARDS.TBC.cvv);
    await page.locator('#payment-submit').click();
    await page.waitForLoadState('networkidle');
    const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
    console.log(`✅ OTP: ${otp}`);
    await fillOTPAndVerifyTBC(page, otp);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    try {
      await closePaymentSuccess(page, context);
    } catch {
      await context.close().catch(() => {});
    }
  }

  // ============================================================
  //  merchant-ის payment link + refund
  // ============================================================

  /**
   * Payment link — merchant-ის შექმნილი გადახდის ლინკი (ფიქსირებული თანხით): ბალანსის განულება + STANDARD flow (Over Balance) →
   * თითო refund-ზე: ლინკით ბარათით გადახდა → ჩვენი ტრანზაქცია merchant-ის სიიდან → refund (full / partial; ADMIN ან MERCHANT)
   * → report-ის შედარება (ყველა OVER_BALANCE).
   */
  async checkPaymentLinkRefunds(config: RefundReportCheckConfig & {
    refundVia: 'ADMIN' | 'MERCHANT';
    iban: string;
    paymentLink: string;                               // merchant-ის ლინკი (თანხა ლინკზეა მიბმული)
    amount: number;                                    // ლინკის თანხა — გვერდზე ზუსტად ეს უნდა ეწეროს
    currency: 'GEL' | 'USD' | 'EUR';
    refunds: Array<{ refundAmount?: number }>;         // თითო = ერთი გადახდა ლინკით: refundAmount არ არის → full | არის → partial
  }) {
    await this.updateMerchantFlow('STANDARD');
    await this.expectMerchantFlow(config.merchantId, 'STANDARD');
    await this.cashOutAllBalance(config.phone, config.merchantId, config.iban);

    const range = RefundReportsHelper.period('DAY');
    const before = await this.snapshot(config.merchantId, range);

    const refunds: OurRefund[] = [];
    for (const step of config.refunds) {
      const txId = await this.payPaymentLink(config);
      const isFull = step.refundAmount === undefined;
      await this.refundByTransactionId(config.refundVia, txId, config.phone, isFull ? config.amount : step.refundAmount!, isFull);
      await this.waitForTopUpRefunded(config.phone, txId);
      console.log(`✅ ${isFull ? 'Full' : 'Partial'} refund via ${config.refundVia} — payment link ${isFull ? config.amount : step.refundAmount} ${config.currency} (tx ${txId})`);
      refunds.push({ transactionId: txId, currency: config.currency, expectedRefundAmount: isFull ? config.amount : step.refundAmount! });
    }

    await this.compareReport(config.merchantId, range, before, refunds, refunds.map(() => 'OVER_BALANCE' as RefundSource));
  }

  /** merchant-ის ლინკით ბარათით გადახდა → ჩვენი ახალი ტრანზაქცია (initialAmount + currency) · SUCCESS — აბრუნებს transactionId-ს */
  private async payPaymentLink(config: { phone: string; paymentLink: string; amount: number; currency: string }): Promise<number> {
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();
    const token = await new AuthDevicePage(this.request).authenticate(config.phone);
    const idsBefore = new Set((await this.getMerchantTransactions(token)).map((t) => t.id));
    console.log(`✅ Payment link — ${config.amount} ${config.currency}`);
    await this.payLinkWithCard(config.paymentLink, gmail, config.amount);

    // SUCCESS-ის მოლოდინი (ხელმოწერა update-status-ით აჩქარებს)
    const checker = new TransactionChecker(this.request);
    let tx: any;
    for (let i = 0; i < 30 && tx?.status !== 'SUCCESS'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      tx = (await this.getMerchantTransactions(token)).find((t) =>
        !idsBefore.has(t.id) && t.initialAmount === config.amount && t.currencyCode === config.currency);
      if (tx && tx.status !== 'SUCCESS') { try { await checker.signById(tx.id); } catch { /* ignore */ } }
    }
    assertCondition(OP_REFUND, tx?.status === 'SUCCESS',
      `payment link ${config.amount} ${config.currency}: ტრანზაქცია SUCCESS-ზე ვერ გადავიდა (status: ${tx?.status ?? 'ვერ მოიძებნა'})`,
      `ახალი ტრანზაქცია ${config.amount} ${config.currency} · SUCCESS`, tx);
    console.log(`✅ Payment SUCCESS (tx ${tx.id})`);
    return tx.id;
  }

  /** refund-ის დასრულების მოლოდინი (merchant-ის ტრანზაქცია REFUNDED / PARTIALLY_REFUNDED) — add money / payment link */
  private async waitForTopUpRefunded(phone: string, transactionId: number) {
    const token = await new AuthDevicePage(this.request).authenticate(phone);
    let status = '';
    for (let i = 0; i < 20 && !status.includes('REFUNDED'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      status = (await this.getMerchantTransactions(token)).find((t) => t.id === transactionId)?.status ?? '';
    }
    assertCondition(OP_REFUND, status.includes('REFUNDED'), `top-up-ის refund არ დასრულდა (tx ${transactionId}, status: ${status})`,
      'status = REFUNDED / PARTIALLY_REFUNDED', { transactionId, status });
  }

  /** merchant-ის ბოლო ტრანზაქციები (device token) */
  private async getMerchantTransactions(token: string): Promise<any[]> {
    const response = await this.request.post('https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=0&limit=10', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { sentOrReceived: 'ALL', senderInfo: '', recipientInfo: '' },
    });
    return (await response.json().catch(() => ({}))).value?.transactionsPage?.content || [];
  }

  /** ბარათით გადახდა refund-ის გარეშე (მაგ. BALANCE flow-ზე ბალანსის შესავსებად) — აბრუნებს transactionId-ს */
  async payOnly(config: { amount: number; currency: 'GEL' | 'USD' | 'EUR'; receiverId: string; receiverType?: string; integratorId: string }): Promise<number> {
    const { transactionId } = await this.payAndWaitSuccess(config);
    return transactionId;
  }

  /** ორდერი + გადახდა (TBC ბარათი ან TBC Open Banking) → SUCCESS-ის მოლოდინი */
  private async payAndWaitSuccess(config: { amount: number; currency: 'GEL' | 'USD' | 'EUR'; receiverId: string; receiverType?: string; integratorId: string; payWith?: 'CARD' | 'OB_TBC' }) {
    const paymentPage = new PaymentPage(this.request, null as any);
    const gmail = new GmailHelper(process.env.GMAIL_USER!, process.env.GMAIL_APP_PASSWORD!);
    await gmail.deleteOldOTPEmails();
    const accessToken = await new AuthPage(this.request).authenticate();
    const isOpenBanking = config.payWith === 'OB_TBC';

    // 1. ორდერი (OB → openBankingLinkProvider: TBC, ლინკი პირდაპირ TBC-ის გვერდზე მიდის)
    const { paymentUrl, integratorOrderId } = await paymentPage.createPaymentOrder(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      currency: config.currency,
      ...(isOpenBanking ? { openBankingLinkProvider: 'TBC' } : {}),
    });
    console.log(`✅ Order Created — ${config.amount} ${config.currency}${isOpenBanking ? ' (TBC Open Banking)' : ''}`);

    if (isOpenBanking) {
      const browser = await chromium.launch({ headless: false, channel: 'chrome' });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(paymentUrl);
      await this.payWithTbcOpenBanking(page, gmail);
      try {
        await closePaymentSuccess(page, context);
      } catch {
        await context.close().catch(() => {});
      }
      await browser.close().catch(() => {});
    } else {
      const context = await chromium.launchPersistentContext('./playwright-card-data', { headless: false, channel: 'chrome' });
      const page = await context.newPage();
      await page.goto(paymentUrl);
      await page.locator('button', { hasText: /საბანკო ბარათი|Bank card/ }).click();
      await page.waitForTimeout(2000);
      await page.locator('#cardNumber').fill(CARDS.TBC.number);
      await page.locator('#cardExpirationDateCustom').fill(CARDS.TBC.expiry);
      await page.locator('#cvc2').fill(CARDS.TBC.cvv);
      await page.locator('#payment-submit').click();
      await page.waitForLoadState('networkidle');
      const otp = await gmail.getLatestOTP(30, undefined, 'TBC');
      console.log(`✅ OTP: ${otp}`);
      await fillOTPAndVerifyTBC(page, otp);
      // success გვერდი ზოგჯერ ფონზე request-ებს აგზავნის და networkidle არ დგება — არ ვაგდებთ,
      // გადახდის შედეგს ქვემოთ getOrderStatus (SUCCESS) ამოწმებს
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      try {
        await closePaymentSuccess(page, context);
      } catch {
        await context.close().catch(() => {});
      }
    }

    // 2. SUCCESS-ის მოლოდინი (ხელმოწერა update-status-ით აჩქარებს, როგორც RefundPreAuthHelper)
    const checker = new TransactionChecker(this.request);
    let status = '';
    let transactionId = 0;
    let acquiringAmount = config.amount;
    for (let i = 0; i < 30 && status !== 'SUCCESS'; i++) {
      const s = await paymentPage.getOrderStatus(accessToken, config.integratorId, integratorOrderId);
      status = s?.status ?? '';
      transactionId = s?.transactionId ?? transactionId;
      acquiringAmount = s?.acquiringAmount ?? acquiringAmount;
      if (status !== 'SUCCESS') {
        if (transactionId) { try { await checker.signById(transactionId); } catch { /* ignore */ } }
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
    assertCondition(OP_REFUND, status === 'SUCCESS',
      `ორდერი SUCCESS-ზე ვერ გადავიდა (status: ${status})`, 'status = SUCCESS', { integratorOrderId, status, transactionId });
    console.log(`✅ Payment SUCCESS (tx ${transactionId})`);
    return { accessToken, integratorOrderId, transactionId, acquiringAmount };
  }

  /** TBC Open Banking — login → OTP → ანგარიში → checkbox → დადასტურება (როგორც OpenBankingHelper.automateTBC) */
  private async payWithTbcOpenBanking(page: any, gmail: GmailHelper) {
    await page.waitForSelector('#UserName', { timeout: 10000 });

    await page.click('#UserName');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.TBC_USERNAME!, { delay: 80 });

    await page.click('#Password');
    await page.waitForTimeout(300);
    await page.keyboard.type(process.env.TBC_PASSWORD!, { delay: 80 });
    await page.waitForTimeout(500);

    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    const otp = await gmail.getLatestOTP(60);
    console.log(`✅ OTP: ${otp}`);

    await page.waitForSelector('input[name="OtpCode"]', { timeout: 10000 });
    await page.click('input[name="OtpCode"]');
    await page.waitForTimeout(300);
    await page.keyboard.type(otp, { delay: 80 });
    await page.waitForTimeout(500);

    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    // ანგარიშის არჩევა
    await page.waitForTimeout(2000);
    await page.click('button.dropdown-header');
    await page.waitForTimeout(500);
    await page.locator('button.dropdown-item').first().click();
    await page.waitForTimeout(1000);

    // checkbox + დადასტურება
    await page.locator('label.form-check-label.child').click();
    await page.waitForTimeout(500);
    await page.locator('button#acceptPaymentButton').click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    console.log('✅ TBC Open Banking payment confirmed');
  }

  // ============================================================
  //  merchant
  // ============================================================

  /** merchant-ის distributionFlow (admin GET) — ტესტის წინაპირობა */
  async expectMerchantFlow(merchantId: string, flow: string) {
    const response = await this.request.get(`https://newadmin.dev.keepz.me/api/v1/merchant/${merchantId}`, {
      headers: { 'Authorization': `Bearer ${await this.token()}` },
    });
    const merchant = (await response.json().catch(() => ({}))).value;
    console.log(`✅ Merchant: ${merchant?.name} · distributionFlow=${merchant?.distributionFlow}`);
    assertField('GET /merchant (precondition)', merchant || {}, 'distributionFlow', flow);
  }

  /** merchant-ის ბალანსი ვალუტებით (GET /wallet/balances, device token) */
  private async getWalletBalances(token: string): Promise<Record<string, number>> {
    const response = await this.request.get('https://walletportal.dev.keepz.me/api/v1/wallet/balances', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    assertCondition(OP_BALANCE, response.ok(), `HTTP ${response.status()}`, 'HTTP 200', body);
    const balance: Record<string, number> = {};
    for (const b of body.value || []) balance[b.currency] = b.amount;
    return balance;
  }

  /**
   * ბალანსის განულება — თითო ვალუტაზე რაც ბალანსზეა, მთლიანად გაგვაქვს IBAN-ზე (POST /wallet/cash-out),
   * რომ Over Balance ქეისი მოხდეს (წინა In Balance ტესტი ბალანსზე თანხას ტოვებს).
   */
  async cashOutAllBalance(phone: string, merchantId: string, iban: string) {
    const token = await new AuthDevicePage(this.request).authenticate(phone);
    const before = await this.getWalletBalances(token);
    console.log(`✅ Balance before cash-out: ${JSON.stringify(before)}`);

    for (const [currencyCode, amount] of Object.entries(before)) {
      if (amount <= 0) continue;
      const response = await this.request.post(`https://walletportal.dev.keepz.me/api/v1/wallet/cash-out?merchantId=${merchantId}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { amount: amount.toFixed(2), currencyCode, iban },
      });
      const body = await response.json().catch(() => ({}));
      assertCondition(OP_CASH_OUT, response.ok(), `cash-out ვერ შესრულდა: ${amount} ${currencyCode} (HTTP ${response.status()})`,
        'HTTP 200', body);
      console.log(`✅ Cash-out: ${amount} ${currencyCode} → ${iban}`);
    }

    // ბალანსი 0 უნდა გახდეს (cash-out შეიძლება async-ად აისახოს)
    let after = before;
    for (let i = 0; i < 10 && Object.values(after).some((a) => a > 0); i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      after = await this.getWalletBalances(token);
    }
    console.log(`✅ Balance after cash-out: ${JSON.stringify(after)}`);
    assertCondition(OP_CASH_OUT, Object.values(after).every((a) => a === 0),
      `cash-out-ის შემდეგ ბალანსი 0 არ არის: ${JSON.stringify(after)}`, 'ყველა ვალუტაზე ბალანსი 0', after);
  }

  /**
   * merchant 599000555-ის distributionFlow (PUT /merchant/update + multipart blob, როგორც AddMoneyHelper.updateMerchant).
   * public — spec-ის afterAll-იც იძახებს STANDARD-ზე restore-ისთვის.
   */
  async updateMerchantFlow(distributionFlow: 'STANDARD' | 'BALANCE') {
    const payload = { ...MERCHANT_599000555, distributionFlow };
    const response = await this.request.put('https://newadmin.dev.keepz.me/api/v1/merchant/update', {
      headers: { 'Authorization': `Bearer ${await this.token()}` },
      multipart: {
        merchantData: { name: 'blob', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) },
      },
    });
    if (!response.ok()) {
      throw new Error(`Merchant update failed: ${response.status()} - ${await response.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000)); // ცვლილება დაჯდეს
    console.log(`✅ Merchant updated: distributionFlow=${distributionFlow}`);
  }
}
