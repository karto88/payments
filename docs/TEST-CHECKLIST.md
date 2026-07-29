# ✅ Positive ტესტების ჩეკლისტი

ყველა Positive ტესტი (`tests/Positive/`) ერთ ადგილას — რა არის დაფარული ერთი თვალის დახედვით.

> სულ **57 ტესტი** / **19 ფაილი**

---

## 🧾 ორდერის შექმნა

**`create-order.spec.ts`**
- Create Order Only — ორდერის შექმნა (მხოლოდ)

**`validuntil-retry-payment.spec.ts`**
- validUntil Order — ვადიანი ორდერი / გადახდის თავიდან ცდა

**`treasury-order.spec.ts`**
- Treasury Order — ხაზინის ორდერი

**`invoice.spec.ts`**
- Invoice Check — ინვოისის შემოწმება

**`split-order.spec.ts`** — Split Payment
- Split Order IBAN BRANCH
- Split Order BRANCH and BRANCH
- Split Order — child amount 0
- Split Order — Main receiver amount 0

---

## 💳 გადახდის მეთოდები

**`all-methods.spec.ts`**
- Card Payment TBC — ბარათით გადახდა (TBC)
- Card Payment BOG — ბარათით გადახდა (BOG)
- TIP Payment — თიფით გადახდა

**`open-banking.spec.ts`**
- BOG Open Banking
- TBC Open Banking

**`directLinkProvider.spec.ts`**
- BOG directLinkProvider — Distributor BOG / MCard
- TBC directLinkProvider — Distributor TBC / Visa

**`saved-card.spec.ts`**
- Saved Card — იუზერი როცა ბარათს ამახსოვრებს (card token წამოღება)

**`Card token-payment.spec.ts`** — დამახსოვრებული ბარათის token-ით გადახდა
- amount არის 0 (ბექში ბაგი — token არ ბრუნდება)
- amount არის 0.1

---

## 🔐 Pre-Authorization

**`pre-auth.spec.ts`**
- Pre Authorization — Partial complete (ნაწილობრივი capture)
- Pre Authorization — Full complete (სრული capture)

**`balance-check-pre-auth.spec.ts`** — ბალანსი pre-auth-ის დროს
- Pre-Auth balance — Partial complete
- Pre-Auth balance — Full complete

---

## 💰 ბალანსის შემოწმება

**`balance-check.spec.ts`**
- Receiver საკომისიო + PERCENTAGE
- Sender საკომისიო + PERCENTAGE
- Receiver საკომისიო + FIXED
- Sender საკომისიო + FIXED
- Multi-currency — USD
- Multi-currency — EUR

---

## ↩️ Refund

**`refund-order.spec.ts`** — მერჩანტი + ADMIN არხები
- მერჩანტი — Partial Refund + საკომისიო Sender
- მერჩანტი — Full Refund + საკომისიო Sender
- მერჩანტი — Partial Refund + საკომისიო Receiver
- მერჩანტი — Full Refund + საკომისიო Receiver
- ADMIN — Partial Refund + საკომისიო Sender
- ADMIN — Full Refund + საკომისიო Sender
- ADMIN — Partial Refund + საკომისიო Receiver
- ADMIN — Full Refund + საკომისიო Receiver

**`refund-integrator.spec.ts`** — INTEGRATOR არხი
- INTEGRATOR — Partial Refund + საკომისიო Sender
- INTEGRATOR — Full Refund + საკომისიო Sender
- INTEGRATOR — Partial Refund + საკომისიო Receiver
- INTEGRATOR — Full Refund + საკომისიო Receiver
- INTEGRATOR — Partial → Full refund (failed full-ის მერე ბალანსი უცვლელი უნდა იყოს)

**`refund-preauth.spec.ts`** — Pre-Auth capture-ის refund
- SENDER — FULL refund via INTEGRATOR
- SENDER — Partial refund via INTEGRATOR
- SENDER — FULL refund via მერჩანტი
- SENDER — Partial refund via მერჩანტი
- SENDER — FULL refund via ADMIN
- SENDER — Partial refund via ADMIN
- RECEIVER — FULL refund via INTEGRATOR
- RECEIVER — Partial refund via INTEGRATOR
- RECEIVER — FULL refund via მერჩანტი
- RECEIVER — Partial refund via მერჩანტი
- RECEIVER — FULL refund via ADMIN
- RECEIVER — Partial refund via ADMIN

---

## 🔁 Redirect & Callback

**`redirect - Success_Fail.spec.ts`**
- Success redirect URL — ორდერს მიყვება success redirect
- Fail redirect URL — ორდერს მიყვება fail redirect

**`callback-test.spec.ts`**
- Callback — წარმატებული გადახდის მერე callback იგზავნება

---

## 📊 სხვა

**`gpc.spec.ts`**
- GPS Status — GPC / სტატუსის შემოწმება