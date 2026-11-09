import { test } from '@playwright/test';
import { RsRegistrationHelper } from '../../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// RS რეგისტრაცია — ადმინ პანელი → RS Registrations (KD-2237 / KD-2239)
// 1. Register to RS: Resident (clientNo არ აქვს) / Foreign (clientNo 10 სიმბოლო) / WALLET კლიენტით (enrollment)
// 2. submit → PENDING_RS_APPROVAL → APPROVED (dev-ზე RS სიმულატორი ~30 წმ — რეალურ RS-ში არაფერი იგზავნება)
// 3. Approved-ის რედაქტირება: სახელი → data differs → Submit changes to RS; alt. ნომერი → data differs არ ჩნდება
// 4. Edit business → რეგისტრაციაშიც იწერება
// 5. wallet: იგივე ident → არსებულ რეგისტრაციას ებმება; Cancel → wallet თავისუფლდება
// 6. hub enrollment job: მიბმა → enrolled, unlink → CLOSED (~2 წთ) — 🐞 KD-2608

// ─── 1. Register to RS ───

test('RS Registration — Resident, wallet-ის გარეშე', async ({ request }) => {
  await new RsRegistrationHelper(request).register('RESIDENT', false);
});

test('RS Registration — Foreign (clientNo 10 სიმბოლო)', async ({ request }) => {
  await new RsRegistrationHelper(request).register('FOREIGN', false);
});

test('RS Registration — Resident, WALLET კლიენტით (enrollment ACTIVE)', async ({ request }) => {
  await new RsRegistrationHelper(request).register('RESIDENT', true);
});

// ─── 2. სტატუსები ───

test('RS Registration — submit → Pending → Approved (Honest taxpayer)', async ({ request }) => {
  await new RsRegistrationHelper(request).submitAndApprove();
});

// ─── 3. Approved-ის რედაქტირება ───

test('RS Registration — Approved: სახელის შეცვლა → data differs → Submit changes to RS', async ({ request }) => {
  await new RsRegistrationHelper(request).editApproved('rename');
});

test('RS Registration — Approved: ალტ. პირადი ნომრის შეცვლა (data differs არ ჩნდება)', async ({ request }) => {
  await new RsRegistrationHelper(request).editApproved('altNumber');
});

// ─── 4. Edit business ───

test('RS Registration — Edit business Approved ბიზნესზე → რეგისტრაციაშიც იცვლება', async ({ request }) => {
  await new RsRegistrationHelper(request).editBusinessWithRegistration();
});

// ─── 5. Wallet ───

test('RS Registration — უკვე მიბმული wallet, იგივე ident → არსებული რეგისტრაცია', async ({ request }) => {
  await new RsRegistrationHelper(request).sameWalletSameIdent();
});

test('RS Registration — Cancel ათავისუფლებს wallet-ს (სხვა ident-ით რეგისტრირდება)', async ({ request }) => {
  await new RsRegistrationHelper(request).cancelFreesWallet();
});

// ─── 6. hub enrollment job (~2 წთ) ───

test('RS Registration — ბიზნესზე მიბმული მეორე WALLET ავტომატურად enrolled (KD-2608)', async ({ request }) => {
  test.setTimeout(300_000);
  await new RsRegistrationHelper(request).autoEnrollLinkedWallet();
});

test('RS Registration — Unlink → enrollment CLOSED', async ({ request }) => {
  test.setTimeout(300_000);
  await new RsRegistrationHelper(request).unlinkEndsEnrollment();
});
