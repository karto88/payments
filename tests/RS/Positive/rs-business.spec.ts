import { test } from '@playwright/test';
import { RsBusinessHelper } from '../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS — Business (გადასახადის გადამხდელი) — ადმინ პანელი → Distributor Hub (KD-2237 / KD-2239)
// 1. შექმნა: RESIDENT (ს/კ 9 ციფრი, პ/ნ 11 ციფრი, ალტ. ნომრით), FOREIGN (მისამართებით, ident-ის გარეშე, state reg)
// 2. ფილტრები: identificationNumber (სრული / დასაწყისი / ალტ. ნომერი), name, residency
// 3. რედაქტირება: სახელი/თარიღები, ident, FOREIGN მისამართები, RESIDENT → FOREIGN
// 4. პაგინაცია
// ყოველი ტესტი ქმნის ახალ ბიზნესს (გამოგონილი ნომრით) — RS-ში არაფერი იგზავნება

// ─── 1. შექმნა ───

test('RS Business — RESIDENT პ-ნ 9 ციფრი', async ({ request }) => {
  await new RsBusinessHelper(request).createBusiness({ residency: 'RESIDENT', ident: 'TAX_ID' });
});

test('RS Business — RESIDENT პ-ნ 11 ციფრი', async ({ request }) => {
  await new RsBusinessHelper(request).createBusiness({ residency: 'RESIDENT', ident: 'PERSONAL' });
});

test('RS Business — RESIDENT ალტერნატიული პირადი ნომრით', async ({ request }) => {
  await new RsBusinessHelper(request).createBusiness({ residency: 'RESIDENT', withAltNumber: true });
});

test('RS Business — FOREIGN მისამართებით ident', async ({ request }) => {
  await new RsBusinessHelper(request).createBusiness({ residency: 'FOREIGN', ident: 'TAX_ID' });
});

test('RS Business — FOREIGN ident-ის გარეშე', async ({ request }) => {
  await new RsBusinessHelper(request).createBusiness({ residency: 'FOREIGN', ident: 'NONE' });
});

test('RS Business — FOREIGN state registration ველებით', async ({ request }) => {
  await new RsBusinessHelper(request).createBusiness({ residency: 'FOREIGN', withStateReg: true });
});

// ─── 2. ფილტრები ───

test('RS Business — ფილტრი: identificationNumber 1 ჩანაწერი', async ({ request }) => {
  await new RsBusinessHelper(request).checkFilter('identificationNumber');
});

test('RS Business — ფილტრი: identificationNumber ნომრის დასაწყისი', async ({ request }) => {
  await new RsBusinessHelper(request).checkFilter('identPrefix');
});

test('RS Business — ფილტრი: ალტერნატიული პირადი ნომრით', async ({ request }) => {
  await new RsBusinessHelper(request).checkFilter('personalNumberAlt');
});

test('RS Business — ფილტრი: name სახელის ნაწილი, სხვა რეგისტრით', async ({ request }) => {
  await new RsBusinessHelper(request).checkFilter('name');
});

test('RS Business — ფილტრი: residency -  RESIDENT', async ({ request }) => {
  await new RsBusinessHelper(request).checkFilter('residency', 'RESIDENT');
});

test('RS Business — ფილტრი: residency - FOREIGN', async ({ request }) => {
  await new RsBusinessHelper(request).checkFilter('residency', 'FOREIGN');
});

// ─── 3. რედაქტირება (PUT სრული body + version) ───

test('RS Business — რედაქტირება: სახელი, თარიღები,  ალტ. ნომერი', async ({ request }) => {
  await new RsBusinessHelper(request).editBusiness('details');
});

test('RS Business — რედაქტირება: identificationNumber ახალ ნომერზე', async ({ request }) => {
  await new RsBusinessHelper(request).editBusiness('ident');
});

test('RS Business — რედაქტირება: FOREIGN მისამართები და state registration', async ({ request }) => {
  await new RsBusinessHelper(request).editBusiness('foreignAddresses');
});

test('RS Business — რედაქტირება: RESIDENT → FOREIGN (RS-ში გაგზავნამდე)', async ({ request }) => {
  await new RsBusinessHelper(request).editBusiness('residencyToForeign');
});

// ─── 4. პაგინაცია ───

test('RS Business — პაგინაცია pageSize 5 - გვერდი 1  2, newest first', async ({ request }) => {
  await new RsBusinessHelper(request).checkPagination(5);
});
