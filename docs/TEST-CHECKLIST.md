# ✅ Positive ტესტების ჩეკლისტი

ყველა Positive ტესტი (`tests/Positive/`) ერთ ადგილას — რას ვამოწმებთ ერთი თვალის დახედვით.

> სულ **57 ტესტი** / **19 ფაილი**

---

## 🧾 ორდერის შექმნა

**`create-order.spec.ts`**
- Create Order Only — ორდერის შექმნა (მხოლოდ)
  - ვამოწმებთ რომ ორდერი იქმნება (paymentUrl ბრუნდება)

**`validuntil-retry-payment.spec.ts`**
- validUntil Order — ვადიანი ორდერი / გადახდის თავიდან ცდა
  - ვამოწმებთ რომ ორდერი იქმნება (paymentUrl ბრუნდება)
  - ვამოწმებთ ტრანზაქციის სტატუსს (retry-ის მერე SUCCESS)

**`treasury-order.spec.ts`**
- Treasury Order — ხაზინის ორდერი
  - ვამოწმებთ რომ ორდერი იქმნება (paymentUrl ბრუნდება)
  - ვიხდით TBC ბარათით (flow სრულდება)

**`invoice.spec.ts`**
- Invoice Check — გადახდილი ორდერის ინვოისის შემოწმება
  - ვამოწმებთ რომ ინვოისი ვალიდური PDF-ია
  - ვამოწმებთ PDF-ში: Status = Successful, Transaction amount, Transaction ID

**`split-order.spec.ts`** — Split Payment
- Split Order IBAN BRANCH - amount 0.10 / 0.10
  - ვამოწმებთ ტრანზაქციის სტატუსს (parent + ყველა child SUCCESS)
  - ვამოწმებთ თითო child-ის თანხას (ემთხვევა request-ს)
- Split Order BRANCH and BRANCH  - amount 0.10 / 0.10
  - ვამოწმებთ ტრანზაქციის სტატუსს (parent + ყველა child SUCCESS)
  - ვამოწმებთ თითო child-ის თანხას
- Split Order — child amount 0
  - ვამოწმებთ ტრანზაქციის სტატუსს + child-ის თანხას (0-ის ჩათვლით)
- Split Order — Main receiver amount 0
  - ვამოწმებთ ტრანზაქციის სტატუსს + child-ის თანხას (main 0-ის ჩათვლით)

---

## 💳 გადახდის მეთოდები

**`all-methods.spec.ts`**
- Card Payment TBC — ბარათით გადახდა (TBC)
  - ვიხდით TBC ბარათით OTP-ით (flow სრულდება)
- Card Payment BOG — ბარათით გადახდა (BOG)
  - ვიხდით BOG ბარათით OTP-ით (flow სრულდება)
- TIP Payment — თიფით გადახდა
  - ვიხდით ძირითადს + TIP 20% (ორი OTP, flow სრულდება)

**`open-banking.spec.ts`**
- BOG Open Banking
  - ვამოწმებთ რომ ორდერი იქმნება (paymentUrl ბრუნდება)
  - ვიხდით BOG open banking-ით (login/confirm, flow სრულდება)
- TBC Open Banking
  - ვამოწმებთ რომ ორდერი იქმნება (paymentUrl ბრუნდება)
  - ვიხდით TBC open banking-ით (login/confirm, flow სრულდება)

**`directLinkProvider.spec.ts`**
- BOG directLinkProvider — Distributor BOG / MCard
  - ვიხდით BOG direct-link ბარათით OTP-ით (flow სრულდება)
- TBC directLinkProvider — Distributor TBC / Visa
  - ვიხდით TBC direct-link ბარათით OTP-ით (flow სრულდება)

**`saved-card.spec.ts`**
- Saved Card — იუზერი როცა ბარათს ამახსოვრებს (card token წამოღება)
  - ვიხდით და ვიმახსოვრებთ ბარათს (`saveCard: true`)
  - ვამოწმებთ რომ card token ბრუნდება

**`Card token-payment.spec.ts`** — დამახსოვრებული ბარათის token-ით გადახდა
- amount არის 0 (ბექში ბაგი — token არ ბრუნდება)
  - ვიხდით token-ით
  - ვამოწმებთ რომ გადახდის result ბრუნდება
- amount არის 0.1
  - ვიხდით token-ით
  - ვამოწმებთ რომ გადახდის result ბრუნდება

---

## 🔐 Pre-Authorization

**`pre-auth.spec.ts`**
- Pre Authorization — Partial complete (ნაწილობრივი capture)
  - ვამოწმებთ სტატუსს: pre-auth-ის მერე TO_BE_CONFIRMED
  - ვამოწმებთ სტატუსს: capture-ის მერე WAITING_FOR_SIGNATURE
  - ვამოწმებთ distributionAmount = complete თანხას
- Pre Authorization — Full complete (სრული capture)
  - იგივე შემოწმებები, სრული capture-ით

**`balance-check-pre-auth.spec.ts`** — ბალანსი pre-auth-ის დროს
- Pre-Auth balance — Partial complete
  - ვამოწმებთ სტატუსს: pre-auth-ის მერე TO_BE_CONFIRMED
  - ვამოწმებთ ბალანსს — hold-ის დროს **უცვლელი**
  - ვამოწმებთ ბალანსს — capture-ის მერე რამდენი დაემატა
- Pre-Auth balance — Full complete
  - იგივე შემოწმებები, სრული capture-ით

---

## 💰 ბალანსის შემოწმება - ბალანსზე თანხის შევსება

**`balance-check.spec.ts`**
- Receiver საკომისიო + PERCENTAGE
  - ვამოწმებთ ბალანსს — რამდენი დაემატა (receiver: თანხა − საკომისიო)
- Sender საკომისიო + PERCENTAGE
  - ვამოწმებთ ბალანსს — რამდენი დაემატა (sender: სრული თანხა)
- Receiver საკომისიო + FIXED
  - ვამოწმებთ ბალანსს — რამდენი დაემატა (receiver: თანხა − საკომისიო)
- Sender საკომისიო + FIXED
  - ვამოწმებთ ბალანსს — რამდენი დაემატა (sender: სრული თანხა)
- Multi-currency — USD
  - ვამოწმებთ ბალანსს — რამდენი დაემატა USD-ში
- Multi-currency — EUR
  - ვამოწმებთ ბალანსს — რამდენი დაემატა EUR-ში

---

## ↩️ Refund

**`refund-order.spec.ts`** — მერჩანტი + ADMIN არხები
- მერჩანტი — Partial Refund + საკომისიო Sender
  - ვამოწმებთ refund სტატუსს (PARTIALLY_REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- მერჩანტი — Full Refund + საკომისიო Sender
  - ვამოწმებთ refund სტატუსს (REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა (თანხა + საკომისიო)
- მერჩანტი — Partial Refund + საკომისიო Receiver
  - ვამოწმებთ refund სტატუსს (PARTIALLY_REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- მერჩანტი — Full Refund + საკომისიო Receiver
  - ვამოწმებთ refund სტატუსს (REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა (მხოლოდ თანხა)
- ADMIN — Partial Refund + საკომისიო Sender
  - ვამოწმებთ refund სტატუსს (PARTIALLY_REFUNDED) + refund თანხას
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- ADMIN — Full Refund + საკომისიო Sender
  - ვამოწმებთ refund სტატუსს (REFUNDED) + refund თანხას
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- ADMIN — Partial Refund + საკომისიო Receiver
  - ვამოწმებთ refund სტატუსს (PARTIALLY_REFUNDED) + refund თანხას
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- ADMIN — Full Refund + საკომისიო Receiver
  - ვამოწმებთ refund სტატუსს (REFUNDED) + refund თანხას
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა

**`refund-integrator.spec.ts`** — INTEGRATOR
- INTEGRATOR — Partial Refund + საკომისიო Sender
  - ვამოწმებთ refund სტატუსს (REFUND_REQUESTED → PARTIALLY_REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- INTEGRATOR — Full Refund + საკომისიო Sender
  - ვამოწმებთ refund სტატუსს (REFUND_REQUESTED → REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- INTEGRATOR — Partial Refund + საკომისიო Receiver
  - ვამოწმებთ refund სტატუსს (REFUND_REQUESTED → PARTIALLY_REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- INTEGRATOR — Full Refund + საკომისიო Receiver
  - ვამოწმებთ refund სტატუსს (REFUND_REQUESTED → REFUNDED)
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა
- INTEGRATOR — Partial → Full refund (failed full-ის მერე ბალანსი უცვლელი უნდა იყოს)
  - ვამოწმებთ partial refund-ს (PARTIALLY_REFUNDED) + ბალანსს
  - ვამოწმებთ ბალანსს — failed full refund-ის მერე **უცვლელი** უნდა იყოს

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
  - *(თორმეტივესთვის:)* ვამოწმებთ სტატუსს — pre-auth TO_BE_CONFIRMED, მერე capture
  - ვამოწმებთ refund სტატუსს (REFUNDED / PARTIALLY_REFUNDED) + refund თანხას
  - ვამოწმებთ ბალანსს — რამდენი ჩამოიჭრა

---

## 🔁 Redirect & Callback

**`redirect - Success_Fail.spec.ts`**
- Success redirect URL — ორდერს მიყვება success redirect
  - ვამოწმებთ რომ წარმატებული გადახდის მერე success URL-ზე გადადის
- Fail redirect URL — ორდერს მიყვება fail redirect
  - ვამოწმებთ რომ ჩავარდნილი გადახდის მერე fail URL-ზე გადადის

**`callback-test.spec.ts`**
- Callback — წარმატებული გადახდის მერე callback იგზავნება
  - ვამოწმებთ რომ callback მოვიდა (webhook-ზე)
  - ვამოწმებთ callback-ის სტატუსს (SUCCESS)

---

## 📊 სხვა

**`gpc.spec.ts`**
- GPS Status — order status-ის შემოწმება
  - ვამოწმებთ ტრანზაქციის სტატუსს (SUCCESS)
  - ვამოწმებთ რომ ყველა key არსებობს პასუხში