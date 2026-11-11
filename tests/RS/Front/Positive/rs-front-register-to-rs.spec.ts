import { test } from '@playwright/test';
import { RsFrontRegisterHelper } from '../../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS ფრონტი — რეგისტრაცია ფრონტის განახლების შემდეგ (10.11): Register to RS ფანჯარა, merchant-ის RS ტაბი, ბიზნესის RS პანელი
// 📋 ახალი merchant — ნომრების pool-იდან (995300000001…, OTP 111111) — შენი SMS არ სჭირდება; ფული არ მოძრაობს

test.describe('RS ფრონტი — Register to RS / merchant RS ტაბი / ბიზნესის RS პანელი', () => {
  test.describe.configure({ timeout: 300_000 });

  // ─── Register to RS ფანჯარა ───

  test('UI: Register to RS → Wallet type-ში მხოლოდ "No wallet" და "Payment merchant" → მინიშნება "Distributor hub wallets are registered through their business" → ბმული გადადის Dist. Businesses-ზე', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).walletTypeOptions();
  });

  test('UI: Register to RS → Payment merchant → ძებნა ident-ით → "სახელი · ident" → არჩევა (Owner / ident ივსება) → Save and review → "Registration created", Submit to RS ფანჯარა ჩვენი მონაცემებით → API: Not submitted, merchant-ის wallet Active', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).registerMerchant();
  });

  test('UI: ბიზნესს (hub wallet) უკვე აქვს რეგისტრაცია → merchant იგივე ident-ით → Register to RS → იგივე რეგისტრაცია იხსნება (ახალი არ იქმნება), 2 wallet: hub + merchant', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).merchantJoinsBusinessRegistration();
  });

  test('UI: Register to RS → No wallet + ახალი ident → "Registration created", რეგისტრაცია wallet-ის გარეშე (0 wallet)', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).noWalletNewIdent();
  });

  // ─── merchant-ის RS ტაბი ───

  test('UI: ახალი merchant → RS ტაბი: "Not registered with RS." → Register to RS → Payment merchant და merchant უკვე არჩეულია (გამორთული) → Save and review → RS ტაბი: Not submitted, Owner, Open registration → რეგისტრაციის გვერდი', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).registerFromMerchantTab();
  });

  // ─── ბიზნესის RS პანელი ───

  test('UI: ბიზნესი + wallet → RS პანელი: Refresh · Open registration · Submit to RS · Not submitted (Register to RS აღარ არის) → Submit to RS ბიზნესის გვერდიდან → "Submitted to RS", Pending RS approval → RS ადასტურებს → Refresh → Approved, თარიღებით', async ({ page, request }) => {
    await new RsFrontRegisterHelper(page, request).businessPanelSubmitAndRefresh();
  });
});
