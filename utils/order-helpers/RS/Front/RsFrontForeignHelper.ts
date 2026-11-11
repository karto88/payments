import { randomUUID } from 'crypto';
import { RsFrontTabsHelper } from './RsFrontTabsHelper';
import { Ctx } from './RsFrontHelper';
import { TRANSFER_TO } from '../RsLienHelper';
import { RsHubApi, date, digits, randomCompanyName } from '../RsHubApi';
import { assertCondition } from '../../../assertions';

const UI = 'UI (dashboard.dev.keepz.me)';
const OP_WALLET = `${UI} Dist. Integrators — wallet-ის შექმნა`;
const OP_BIZ = `${UI} Dist. Businesses — Foreign ბიზნესი`;
const OP_REG = `${UI} RS registration (Foreign)`;
const OP_MODAL = `${UI} Liens & collections — ფანჯარა`;
const OP_SIM = 'POST $SIM/orders/lien | collection (RS → personIdAlt)';
const OP_TRANSFER = 'POST distributor /api/distributor/ (wallet-ის გადარიცხვა)';

/** Foreign-ის მისამართები (Create business-ზე სავალდებულოა) */
const ADDRESS = {
  legalAddressCountry: 'Germany', legalAddressCity: 'Berlin QA', legalAddressLine: 'Teststrasse 1',
  actualAddressCountry: 'Germany', actualAddressCity: 'Berlin QA', actualAddressLine: 'Teststrasse 1',
};
const ADDRESS_TEXT = 'Germany, Berlin QA, Teststrasse 1';

const round = (n: number) => Math.round(n * 100) / 100;

interface ForeignCtx extends Ctx { alt: string }

/**
 * RS ფრონტი — Foreign (არარეზიდენტი) გადამხდელი, e2e:
 *   📋 Foreign-ს ქართული ს/ნ არ აქვს → RS მას იცნობს **ალტერნატიული პირადი ნომრით** (personIdAlt); ყადაღა / ინკასო მოდის personId ცარიელით + personIdAlt
 *   📋 UI: wallet → Create business (Foreign + მისამართები) → Link → რეგისტრაცია (Not submitted) → Edit data: Alternative personal number →
 *      Submit to RS → RS ადასტურებს → Approved ("Approved by: Client number from RS"), wallet ებმის
 *   📋 RS → ყადაღა + ინკასო alt ნომრით → ორივე იყინება → გადარიცხვა იბლოკება → ინკასო: Request amount → Record manual payment → Executed →
 *      RS ხსნის ყადაღას → ფული თავისუფალია, გადარიცხვა გადის
 *   ⚠️ hub wallet STANDARD = რეალური ფული → თანხები ≤ 1 ₾
 */
export class RsFrontForeignHelper extends RsFrontTabsHelper {
  async foreignEndToEnd(c: { balance: number; lien: number; collection: number; transferAfter: number }) {
    this.guard(c.balance, c.lien, c.collection, c.transferAfter);
    const held = round(c.lien + c.collection);
    assertCondition('ტესტის კონფიგი', held <= c.balance, `ყადაღა + ინკასო ${held} > ბალანსი ${c.balance}`, 'ორივე სრულად იყინება (Fully restricted)', c);

    const ctx = await this.prepareForeign(c.balance);
    const t = Date.now();
    const lien = `QA-L-FRN-${t}`;
    const col = `QA-C-FRN-${t}`;
    try {
      // 1. RS → ყადაღა და ინკასო alt ნომრით (personId ცარიელი)
      this.expectSent(await this.sim.lien('', c.lien, lien, ctx.alt), lien);
      this.expectSent(await this.sim.collection('', c.collection, col, 1, '101001000', ctx.alt), col);
      for (const [n, amount, type] of [[lien, c.lien, 'Lien'], [col, c.collection, 'Collection']] as const) {
        await this.expectOverview(ctx, n, { status: 'Fully restricted', requested: amount, restricted: amount, remaining: amount, executed: 0 });
        const id = await this.ui.modalField('Identification number');
        assertCondition(OP_MODAL, id === ctx.alt, `${type} — Identification number ${id}`, `${type} — Identification number = alt ${ctx.alt}`, n);
        await this.ui.closeModal();
      }
      await this.expectWallet(ctx, c.balance, held, `ყადაღა ${c.lien} + ინკასო ${c.collection} გაიყინა`);
      console.log(`✅ Lien ${c.lien} + collection ${c.collection} by personIdAlt ${ctx.alt} — held ${held}`);

      // 2. გაყინულზე მეტის გადარიცხვა → უარი
      const free = round(c.balance - held);
      const over = round(free + 0.01);
      const res = await this.transfer(ctx, over);
      assertCondition(OP_TRANSFER, res.status === 400 && res.body?.statusCode === 5038, `HTTP ${res.status}, code ${res.body?.statusCode}`,
        `400 / 5038 — ${over} > თავისუფალი ${free}`, res.body);
      console.log(`✅ Transfer ${over} rejected (5038) — free ${free}`);

      // 3. ინკასო: UI Request amount → Record manual payment → Executed
      await this.requestAndPay(ctx, col, await this.restrictionId(col), c.collection, c.collection);
      await this.expectApiStatus(col, 'EXECUTED', 0);
      await this.expectOverview(ctx, col, { status: 'Executed', requested: c.collection, restricted: 0, remaining: 0, executed: c.collection });
      await this.ui.closeModal();
      await this.expectWallet(ctx, round(c.balance - c.collection), c.lien, `ინკასო ჩამოიჭრა ${c.collection}, ყადაღა ${c.lien} ისევ გაყინულია`);
      console.log(`✅ Collection ${c.collection} paid from UI — Executed`);

      // 4. RS ხსნის ყადაღას → ფული თავისუფალია → გადარიცხვა გადის
      await this.sim.obtainLien(lien);
      await this.expectApiStatus(lien, 'WITHDRAWN', 0);
      await this.expectWallet(ctx, round(c.balance - c.collection), 0, 'RS-მა ყადაღა მოხსნა — გაყინული 0');
      const ok = await this.transfer(ctx, c.transferAfter);
      assertCondition(OP_TRANSFER, ok.status >= 200 && ok.status < 300, `HTTP ${ok.status}, code ${ok.body?.statusCode}`, `${c.transferAfter} გადაირიცხა`, ok.body);
      await this.expectWallet(ctx, round(c.balance - c.collection - c.transferAfter), 0, `გადაირიცხა ${c.transferAfter}`);
      console.log(`✅ Lien withdrawn by RS — transfer ${c.transferAfter} passed`);
    } finally {
      await this.cleanup(col);
      const l = (await this.api.getRestrictions({ rsNumber: lien })).value?.content?.[0];
      if (l && !['WITHDRAWN', 'RETURNED'].includes(l.status)) await this.sim.obtainLien(lien);
    }
  }

  // ─── შიდა ───

  /**
   * UI: wallet → Create business (Foreign, მისამართები) → ბიზნესის გვერდი (Foreign, ident, მისამართები, Client number) → Link →
   *   რეგისტრაცია Not submitted → Edit data: Alternative personal number → Submit to RS (DATA TO SEND) → RS ადასტურებს → Approved, Wallets 1
   */
  private async prepareForeign(balance: number): Promise<ForeignCtx> {
    const name = `QA UI Wallet ${digits(6)}`;
    await this.ui.login();
    const ids = await this.ui.createWalletClient(name);
    assertCondition(OP_WALLET, await this.ui.toast('Integrator was created successfully'), 'toast არ გამოჩნდა', 'toast "Integrator was created successfully!"', name);
    RsHubApi.expectOk('PUT /api/distributor-hub-client/{id} (ბალანსი)', await this.api.updateBalance(ids.clientId, { amount: balance, currency: 'GEL', description: 'QA RS foreign' }));

    const ident = `QA-FRN-${digits(8)}`;
    const owner = randomCompanyName();
    const alt = `9${digits(10)}`;
    const businessId = await this.ui.createBusiness({ residency: 'FOREIGN', ownerFullName: owner, identNumber: ident, operDate: date(30), ...ADDRESS });
    assertCondition(OP_BIZ, await this.ui.toast('Business created'), 'toast არ გამოჩნდა', 'toast "Business created"', businessId);
    const api = RsHubApi.expectOk('GET /api/distributor-hub-business/{id}', await this.api.getBusiness(businessId));
    assertCondition(OP_BIZ, api.residency === 'FOREIGN' && api.identificationNumber === ident && api.legalAddressCity === ADDRESS.legalAddressCity,
      `residency ${api.residency}, ident ${api.identificationNumber}, city ${api.legalAddressCity}`, `FOREIGN, ${ident}, მისამართები შენახულია`, api);

    await this.ui.linkClient(name);
    assertCondition(OP_BIZ, await this.ui.toast('Clients linked'), 'toast არ გამოჩნდა', 'toast "Clients linked"', name);
    let biz = '';
    const need = ['Residency status | Foreign', `Owner identification number | ${ident}`, `Legal address | ${ADDRESS_TEXT}`, `Actual address | ${ADDRESS_TEXT}`, name];
    await this.poll(async () => {
      biz = await this.ui.businessText();
      if (need.every((x) => biz.includes(x)) && /RS registration \|.*?Not submitted/.test(biz) && /Client number \| [A-Z0-9]{10} /.test(biz)) return true;
      await this.ui.openBusiness(businessId);
      return undefined;
    }, 20_000);
    const miss = need.filter((x) => !biz.includes(x));
    assertCondition(OP_BIZ, miss.length === 0 && /RS registration \|.*?Not submitted/.test(biz) && /Client number \| [A-Z0-9]{10} /.test(biz),
      `აკლია: ${miss.join(' · ') || '-'}`, `${need.join(' · ')} · Client number (10 სიმბოლო) · RS registration Not submitted`, biz.slice(0, 1200));
    console.log(`✅ Foreign business ${owner} (${ident}) created from UI, wallet linked`);

    const regId = await this.ui.openRegistrationFromBusiness();
    const edit = await this.ui.editRegistration({ personalNumberAlt: alt });
    assertCondition(OP_REG, edit.disabled.length === 0 && await this.ui.toast('Registration updated'), `გამორთული: ${edit.disabled.join(', ')}`,
      'Not submitted — Alternative personal number იწერება, toast "Registration updated"', edit);
    await this.ui.openRegistration(regId);
    const data = await this.ui.pageText();
    const dneed = ['Residency status | Foreign', `Owner identification number | ${ident}`, `Alternative personal number | ${alt}`, 'Legal address country | Germany', 'Actual address line | Teststrasse 1'];
    const dmiss = dneed.filter((x) => !data.includes(x));
    assertCondition(OP_REG, dmiss.length === 0, `Data-ში აკლია: ${dmiss.join(' · ')}`, dneed.join(' · '), data.slice(0, 1500));

    const sent = await this.ui.submitToRs();
    const sneed = [`"ownerIdentNumber": "${ident}"`, `"ownerFullName": "${owner}"`, `"address": "${ADDRESS_TEXT}"`, `"actualAddress": "${ADDRESS_TEXT}"`];
    const smiss = sneed.filter((x) => !sent.includes(x));
    assertCondition(OP_REG, smiss.length === 0, `DATA TO SEND-ში აკლია: ${smiss.join(' · ')}`, sneed.join(' · '), sent);
    assertCondition(OP_REG, await this.ui.toast('Submitted to RS'), 'toast არ გამოჩნდა', 'toast "Submitted to RS"', null);

    await this.sim.approveTaxpayer(ident);
    await this.expectRegStatus(regId, 'Approved', 60_000);
    const enrolled = await this.poll(async () => {
      await this.ui.openRegistration(regId);
      return (await this.ui.tabCount('Wallets')) === 1 ? true : undefined;
    }, 3 * 60_000, 10_000);
    const head = await this.ui.pageText();
    assertCondition(OP_REG, !!enrolled && head.includes('Approved by | Client number from RS') && head.includes(`Owner identification number | ${ident} | Sent to RS`),
      `Wallets ${enrolled ? 1 : 0}; ${head.slice(0, 600)}`, 'Approved · Approved by: Client number from RS · Wallets 1 · ველები "Sent to RS"', head.slice(0, 1500));
    console.log(`✅ Foreign registration Approved (alt ${alt}), wallet enrolled`);
    return { ident, owner, businessId, regId, alt, wallet: { clientId: ids.clientId, clientSecret: ids.clientSecret, name } };
  }

  private expectSent(res: any, number: string) {
    const item = res?.items?.[0];
    assertCondition(OP_SIM, res?.accepted === true && item?.code === null, `${number}: code ${item?.code} ${item?.description || ''}`, `${number} მიღებულია (code null)`, res?.items);
  }

  private async transfer(ctx: Ctx, amount: number) {
    return this.dist.transfer(await this.dist.token(ctx.wallet.clientId, ctx.wallet.clientSecret), { amount, uniqueId: randomUUID(), ...TRANSFER_TO });
  }

  private async restrictionId(number: string): Promise<string> {
    return RsHubApi.expectOk('GET /api/v1/rs/restrictions', await this.api.getRestrictions({ rsNumber: number })).content[0].id;
  }
}
