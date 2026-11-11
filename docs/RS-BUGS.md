# RS — Distributor Hub: ნაპოვნი ბაგები და ღია კითხვები

**Epic:** KD-2237 · **Story:** KD-2239 (Business / Wallet client) · **გარემო:** dev (`https://newadmin.dev.keepz.me`) · **თარიღი:** 2026-11-05
**ტესტები:** `tests/RS/Positive/`, `tests/RS/Negative/` (🐞 მონიშნული ტესტები ჩავარდება, სანამ ბაგი არ გასწორდება)

ტესტირების ტექნიკები: ზღვრული მნიშვნელობები (BVA), ეკვივალენტური კლასები (EP), error guessing, მდგომარეობის გადასვლები (link / unlink / update), optimistic lock (`version`).

---

## Jira (შეიქმნა 2026-11-05, parent KD-2237, label `RS-integration`)

| Jira | ბაგ(ებ)ი | Priority |
|---|---|---|
| [KD-2591](https://keepz-me.atlassian.net/browse/KD-2591) | RS-BUG-01, 02, 03 — PERCENTAGE > 100% | High |
| [KD-2592](https://keepz-me.atlassian.net/browse/KD-2592) | RS-BUG-04 — min > max ტრანზაქცია | Medium |
| [KD-2593](https://keepz-me.atlassian.net/browse/KD-2593) | RS-BUG-05 — min > max საკომისიო | Medium |
| [KD-2594](https://keepz-me.atlassian.net/browse/KD-2594) | RS-BUG-06 — tier-ები ერთი startAmount-ით | Medium |
| [KD-2595](https://keepz-me.atlassian.net/browse/KD-2595) | RS-BUG-07 — clientName space / დუბლიკატი | Low |
| [KD-2596](https://keepz-me.atlassian.net/browse/KD-2596) | RS-BUG-08 — filter `%` wildcard | Low |
| [KD-2597](https://keepz-me.atlassian.net/browse/KD-2597) | RS-BUG-09, 10 — pageSize 0 / -1 → 500 | Medium |
| [KD-2598](https://keepz-me.atlassian.net/browse/KD-2598) | RS-BUG-11 — clientName 256 → 500 | Medium |
| [KD-2599](https://keepz-me.atlassian.net/browse/KD-2599) | RS-BUG-12 — update status-ის გარეშე → 500 | Low |
| [KD-2600](https://keepz-me.atlassian.net/browse/KD-2600) | RS-BUG-13 — ბალანსი amount-ის გარეშე → 500 | Low |
| [KD-2601](https://keepz-me.atlassian.net/browse/KD-2601) | RS-BUG-14 — ბალანსის ერორის კოდი იკარგება (1141) | Low |
| [KD-2602](https://keepz-me.atlassian.net/browse/KD-2602) | RS-BUG-15 — სახელი მხოლოდ უხილავი სიმბოლოებით (` `, `​`, `　`) — screenshot მიმაგრებული, link KD-2595 | Medium |
| [KD-2608](https://keepz-me.atlassian.net/browse/KD-2608) | RS-BUG-16 — ბიზნესზე მიბმული WALLET კლიენტი RS რეგისტრაციას ავტომატურად არ ემატება (ENR-05) — 2 screenshot | High |
| [KD-2610](https://keepz-me.atlassian.net/browse/KD-2610) | RS-BUG-17 — UI: ინტეგრატორის შექმნის ფორმაზე Scheme (და Business) ველი არ არის → 1488, UI-დან კლიენტი ვერ იქმნება (CLI-01/02) | High |
| [KD-2612](https://keepz-me.atlassian.net/browse/KD-2612) | RS-BUG-18 — Edit business: უარყოფილი ident (1481) მაინც იწერება RS რეგისტრაციაში; ბიზნესი "Not registered with RS" (ცნობილი ხარვეზი #11) — 3 screenshot | High |
| [KD-2613](https://keepz-me.atlassian.net/browse/KD-2613) | RS-BUG-19 — UI: Submit changes to RS-ის შემდეგ "data differs" ბანერი და ღილაკი რჩება F5-მდე; მეორე კლიკი → 409 / 7011 (ცნობილი ხარვეზი #29) — 2 screenshot | Low |
| [KD-2616](https://keepz-me.atlassian.net/browse/KD-2616) | RS-BUG-20 — ყადაღის fill-up: ახალი ფული wallet-ზე იყინება (held 1), მაგრამ ყადაღა რჩება Partially restricted / restricted 0.5 / "0.50 GEL short" (15+ წთ) — ავტოტესტი rs-lien.spec.ts | Medium |
| [KD-2617](https://keepz-me.atlassian.net/browse/KD-2617) | RS-BUG-21 — UI: ყადაღის ფანჯარა — "Reallocate holds" აქტიური რჩება გადანაწილების შემდეგ (Fully restricted), ხელახლა დაჭერა → "Holds re-planned" ცვლილების გარეშე; 1-ელ დაჭერაზე ფანჯარა არ ახლდება — 3 screenshot | Low |

---

## 1. დადასტურებული ბაგები (21)

### A. API არავალიდურ მონაცემს იღებს და ინახავს

| ID | სიმძიმე | Endpoint | რა გავაგზავნეთ | მოსალოდნელი | რეალური | ტექნიკა |
|---|---|---|---|---|---|---|
| RS-BUG-01 | 🔴 High | `POST /api/distributor-hub-client` | `commissionRateType: PERCENTAGE`, `commission: 100.01` | 400 — პროცენტი ≤ 100 | **201**, შეინახა | BVA (100 + 0.01) |
| RS-BUG-02 | 🔴 High | `POST /api/distributor-hub-client` | `PERCENTAGE`, `commission: 1000` | 400 | **201**, შეინახა | EP (> 100) |
| RS-BUG-03 | 🔴 High | `POST /api/distributor-hub-client` (update, `integratorId`) | არსებულ კლიენტს `PERCENTAGE 500` | 400, საკომისიო უცვლელი | **201**, 500% შეინახა | EP (update) |
| RS-BUG-04 | 🟠 Medium | `POST /api/distributor-hub-client` | `minTransactionAmount: 100`, `maxTransactionAmount: 10` | 400 — min ≤ max | **201** — კლიენტზე ვერც ერთი თანხა ვერ გაივლის | BVA (min ↔ max) |
| RS-BUG-05 | 🟠 Medium | `POST /api/distributor-hub-client` | tier: `PERCENTAGE 5`, `minCommissionAmount: 10`, `maxCommissionAmount: 1` | 400 — min საკომისიო ≤ max | **201** | BVA (min ↔ max) |
| RS-BUG-06 | 🟠 Medium | `POST /api/distributor-hub-client` | 2 tier ერთი `startAmount: 0`-ით (FIXED 1 და FIXED 2) | 400 — startAmount უნიკალური | **201** — გაურკვეველია, რომელი tier იმოქმედებს | Error guessing |
| RS-BUG-07 | 🟡 Low | `POST /api/distributor-hub-client` | `clientName` = არსებული სახელი + ბოლოში space (`"QA Wolf "`) | 400 / 1186 (ან სახელის trim) | **201** — ორი ვიზუალურად ერთნაირი კლიენტი. სახელი space-ებით ინახება (business-ის `ownerFullName` კი trim-დება) | Error guessing |
| RS-BUG-08 | 🟡 Low | `GET /api/distributor-hub-business/filter` | `name=%` | მხოლოდ სახელები, რომლებიც `%`-ს შეიცავს | **ყველა ბიზნესი** — `%` SQL wildcard-ად მუშაობს (escape არ არის) | Error guessing |

| RS-BUG-15 | 🟠 Medium | `POST /api/distributor-hub-business` / `POST /api/distributor-hub-client` | სახელი მხოლოდ უხილავი სიმბოლოებით: non-breaking space ` `, zero-width space `​`; client-ზე ასევე ideographic space `　` | 400 — 1480 (business) / 1001 (client), როგორც ჩვეულებრივ space / tab / newline-ზე | **200 / 201** — ბიზნესი / კლიენტი ცარიელი (ან სრულიად უხილავი) სახელით იქმნება. business-ზე `　` იბლოკება, client-ზე — არა (შეუსაბამობა) | Error guessing |

### D. RS enrollment

- **RS-BUG-16** 🔴 High — ბიზნესზე მიბმული WALLET კლიენტი RS რეგისტრაციას ავტომატურად არ ემატება ([KD-2608](https://keepz-me.atlassian.net/browse/KD-2608)). ბიზნესი `8e186b95…`-ზე 2 WALLET კლიენტია (Kemmer, Kuhn), მაგრამ `GET /api/v1/rs/registrations/10990609…` და `lookup?holderRef=…` → enrollments-ში მხოლოდ Kemmer (ხელით არჩეული Register to RS-ში). Kuhn 16+ საათის შემდეგაც არ არის enrolled, `lookup?holderRef=CLIENT:<Kuhn>` → `{}`. მოსალოდნელი (docs, ENR-05): ~2 წუთში ყველა WALLET კლიენტი enrolled. ადრე Q17 იყო — დადასტურდა.

- **RS-BUG-17** 🔴 High (UI) — Dist. Integrators → შექმნა: ფორმაზე Scheme dropdown (WALLET / SYSTEM_OPERATOR) და Business ველი არ არის; request-ში `scheme` არ იგზავნება → 400 / 1488 "Choose the client's scheme." Postman-ით `"scheme": "WALLET"` გადის ([KD-2610](https://keepz-me.atlassian.net/browse/KD-2610)).

### B. ვალიდაციის ერორის ნაცვლად 500 (Unexpected error)

| ID | სიმძიმე | Endpoint | რა გავაგზავნეთ | მოსალოდნელი | რეალური |
|---|---|---|---|---|---|
| RS-BUG-09 | 🟠 Medium | `GET /api/distributor-hub-business/filter` | `pageSize=0` | 400 / 1001 | **500 / 1000** |
| RS-BUG-10 | 🟠 Medium | `GET /api/distributor-hub-business/filter` | `pageSize=-1` | 400 / 1001 | **500 / 1000** |
| RS-BUG-11 | 🟠 Medium | `POST /api/distributor-hub-client` | `clientName` 256 სიმბოლო (255 გადის) | 400 / 1001 — სიგრძის ლიმიტი | **500 / 1000** — ვალიდაცია არ არის, DB ჩავარდა |
| RS-BUG-12 | 🟡 Low | `POST /api/distributor-hub-client` (update) | `integratorId`, `status`-ის გარეშე | 400 / 1001 | **500 / 1000** (docs-შიც ასე წერია — ცნობილია, მაგრამ ბაგია) |
| RS-BUG-13 | 🟡 Low | `PUT /api/distributor-hub-client/{id}` (ბალანსი) | `amount`-ის გარეშე | 400 / 1001 | **500 / 1000** (docs-შიც ასე წერია) |

### C. ცნობილი ხარვეზი docs-იდან (ტესტი არ არის)

- **RS-BUG-14** 🟡 Low — `PUT /api/distributor-hub-client/{id}` ბალანსი: hub-ის ერორის კოდი იკარგება. `amount=0.00001` ან `description` 256 სიმბოლო → **400 / 1141 "Internal service rest template error"**. რეალური მიზეზი (`INSUFFICIENT_BALANCE_AMOUNT`, სიგრძე და ა.შ.) არ ჩანს.

### ტესტები, რომლებიც ბაგებს ამოწმებს

| ID | ტესტი |
|---|---|
| 01 | `RS Client Negative — PERCENTAGE 100.01 (100-ის ზედა ზღვარი +0.01) → 400` |
| 02 | `RS Client Negative — PERCENTAGE 1000 → 400` |
| 03 | `RS Client Negative — update: PERCENTAGE 500 → 400` |
| 04 | `RS Client Negative — min > max (100 > 10) → 400` |
| 05 | `RS Client Negative — minCommissionAmount > maxCommissionAmount (10 > 1) → 400` |
| 06 | `RS Client Negative — 2 tier ერთი startAmount-ით (0 და 0) → 400` |
| 07 | `RS Client Negative — clientName = არსებული + ბოლოში space → 1186` |
| 08 | `RS Business Negative — filter name "%" → მხოლოდ სახელები "%"-ით` |
| 09 | `RS Business Negative — filter pageSize 0 (ქვედა ზღვარი) → 400` |
| 10 | `RS Business Negative — filter pageSize -1 → 400` |
| 11 | `RS Client Negative — clientName 256 სიმბოლო → 400` |
| 12 | `RS Client Negative — update: status-ის გარეშე → 400` |
| 13 | `RS Client Negative — ბალანსი: amount-ის გარეშე → 400` |

ერთი ტესტის გაშვება: `npx playwright test tests/RS/Negative/ -g "PERCENTAGE 1000"`

---

## 2. დეველოპერთან დასაზუსტებელი (API იღებს, docs არაფერს ამბობს)

| # | რა | რა მოხდა | კითხვა |
|---|---|---|---|
| Q1 | `operDate` / `knownDate` მომავალში (+30 დღე, `9999-12-31`) | 200 | მომავალი თარიღი დასაშვებია? |
| Q2 | `operDate: 1900-01-01` | 200 | ქვედა ზღვარი არის? |
| Q3 | `knownDate` < `operDate` | 200 | knownDate-ს operDate-ზე ადრე შეიძლება იყოს? |
| Q4 | `personalNumberAlt` = საკუთარი `identificationNumber` | 200 | ერთი და იგივე ნომერი ორჯერ — დასაშვებია? |
| Q5 | ბიზნესის `identificationNumber` = სხვა ბიზნესის `personalNumberAlt`; ან ორ ბიზნესს ერთი `personalNumberAlt` | 200 | filter ორივეს იპოვის ერთი ნომრით — უნიკალური უნდა იყოს? |
| Q6 | `identificationNumber: "000000000"` / `"012345678"` | 200 | 0-ით დაწყებული / ნულოვანი ს/კ დასაშვებია? |
| Q7 | `clientName` დუბლიკატი სხვა რეგისტრით (`QA Wolf` / `QA WOLF`) | 201 | უნიკალურობა case-insensitive უნდა იყოს? |
| Q8 | `minTransactionAmount: 0.001` / `0.0001` | 201 | GEL-ზე > 2 ათწილადი დასაშვებია? |
| Q9 | `maxTransactionAmount: 1e20` | 201 | ზედა ზღვარი არის? |
| Q10 | FIXED საკომისიო 1 000 000 > `maxTransactionAmount` 100 000 | 201 | საკომისიო თანხაზე დიდი — დასაშვებია? |
| Q11 | tier-ები 0-დან არ იწყება (`startAmount: 10`) | 201 | 0–10 თანხაზე რა საკომისიო მოქმედებს? |
| Q12 | `enabledCurrencies: ["USD"]` USD-ის `currencyConfigs`-ის გარეშე | 201 | კონფიგის გარეშე ვალუტის ჩართვა? |
| Q13 | update `businessId: null`-ით | 201, `businessId` უცვლელი (ჩუმად იგნორირდება) | ერორი უნდა იყოს? (მოხსნა მხოლოდ DELETE-ით) |
| Q14 | `personalNumberAlt` 12 ციფრი → **1001**, 8 / 10 ციფრი → **1480** | შეუსაბამო კოდები | ერთი კოდი უნდა იყოს (docs: 1480)? |
| Q15 | `filter pageSize=100000` | 200, ყველა ჩანაწერი ერთად | max pageSize ლიმიტი უნდა იყოს? |
| Q16 | `ownerFullName: "<script>alert(1)</script>"` | 200, ინახება როგორც არის | UI-ში escape ხდება? (ვებში შესამოწმებელი — stored XSS) |
| Q17 | ~~ავტომატური RS enrollment~~ | → დადასტურდა ბაგად: **RS-BUG-16 / KD-2608** | — |
| Q18 | რეგისტრაციის "Edit data"-თ ident შეიცვალა (`982494650`), ბიზნესში დარჩა `982494657` | `lookup?identNumber=<ბიზნესის ident>` → `{}`; ბიზნესის გვერდი რეგისტრაციას მხოლოდ wallet holderRef-ით პოულობს | რეგისტრაციის edit ბიზნესს უნდა ასინქრონებდეს? wallet-ის მოხსნის შემდეგ ბიზნესი „Not registered“ გახდება |

---

## 3. შემოწმდა და სწორად მუშაობს (მოკლედ)

- **Business:** RESIDENT ident 8/10/12 ციფრი, ასოები, space, ცარიელი → 1480 · დუბლიკატი (შექმნა / update / RESIDENT ↔ FOREIGN) → 1481 · `ownerFullName` 250 ✅ / 251 → 1001, space-ები → 1480, trim ხდება · თარიღის ფორმატი, `2026-02-30` → 1003 · FOREIGN 6 მისამართი სავალდებულოა → 1480, სიგრძეები 25 / 100 / 250 ✅, +1 → 1001 · `version`: ძველი / -1 / მომავალი → 1482, გარეშე → 1001 · FOREIGN → RESIDENT ident / knownDate-ის გარეშე → 1480 · ქართული სახელი + ფილტრი ✅ · არარსებული id → 1479, ცუდი uuid → 1002 · token-ის გარეშე → 401.
- **Client:** scheme აკლია → 1488, არავალიდური enum (scheme / method / strategy / provider / currency / rateType, lowercase) → 1003 · SYSTEM_OPERATOR + businessId → 1484 · ლიმიტები 0 / უარყოფითი / null → 1001 · commission < 0, null → 1001 · DEFAULT აკლია / ორჯერ, provider ორჯერ → 1232 · `clientName` 255 ✅ / დუბლიკატი → 1186 · callbackUrl არავალიდური → 1187 · scheme-ის შეცვლა → 1487 · სხვა ბიზნესზე გადატანა → 1485.
- **მიბმა / მოხსნა:** SYSTEM_OPERATOR → 1484 · `[]` / `[null]` / body-ს გარეშე → 1001 · ცუდი uuid → 1003 · არარსებული კლიენტი → 1188 · არარსებული ბიზნესი → 1479 · სხვა ბიზნესზე → 1485 · ერთი id ორჯერ სიაში → 1-ჯერ ებმება ✅ · ვალიდური + SYSTEM_OPERATOR ერთად → მთლიანად უარყოფა (ატომური) ✅ · მოხსნა ორჯერ → 1491 · ხელახლა მიბმა ✅ · update-ით ბიზნესის არმქონე კლიენტის მიბმა ✅.
- **ბალანსი:** amount 0 → 1001 · ვალუტა XYZ → 1002 · ჩამოჭრა 0-ზე ქვემოთ დაშვებულია (docs: held-ზე ქვემოთ არა).

---

## 4. ჯერ არ გატესტილი (შემდეგი ეტაპი)

- **RS რეგისტრაციის მდგომარეობები** (state transition): NOT_SUBMITTED → PENDING_RS_APPROVAL → APPROVED / SUBMISSION_FAILED → CANCELLED; დაუშვებელი გადასვლები (7011, 7014, 7015, 7016).
- **უფლებები** (RS_SUBMITTED_FIELDS_EDIT → 7013, ACCESS_DENIED 1180) — მეორე, შეზღუდული ადმინი სჭირდება.
- **residency-ის შეცვლა RS-ში გაგზავნის შემდეგ** → 1483; ბიზნესის edit RS რეგისტრაციით (რეგისტრაციის განახლება, 1489).
- **მოხსნა, როცა თანხა დაკავებულია RS-ზე** → 1492 (ყადაღა / ინკასო — სიმულატორის token სჭირდება).
- **UI:** stored XSS (Q16), ფორმის ვალიდაცია ზემოთ ჩამოთვლილ ზღვრულ მნიშვნელობებზე.

### 4.1 RS რეგისტრაცია — დაგეგმილი ქეისები (`tests/RS/*/rs-registration.spec.ts`)

| # | ქეისი | მოსალოდნელი |
|---|---|---|
| REG-01 | Resident რეგისტრაცია | `clientNo` = null |
| REG-02 | Foreign რეგისტრაცია | `clientNo` = 10 სიმბოლო |
| REG-03 | Resident → Foreign, სანამ RS უპასუხებს | `clientNo` არ არის ცარიელი (ცნობილი ხარვეზი 26) |
| REG-04 | Submit → ~30 წმ | NOT_SUBMITTED → PENDING_RS_APPROVAL → APPROVED |
| REG-05 | Approved: residency-ის შეცვლა | რეგისტრაცია 7012 / ბიზნესი 1483 |
| REG-06 | Approved: სახელი / ident / თარიღები | ინახება, `dataDiffersFields`-ში ველი, Field changes სტრიქონი |
| REG-07 | Submit changes to RS | ახალი NEW_CLIENT მესიჯი, `dataDiffersFields` სუფთავდება |
| REG-08 | Submit changes, არაფერი შეცვლილა | 7011 |
| REG-09 | Alternative personal number-ის შეცვლა | თავისუფლად, "data differs" არ ჩნდება |
| REG-10 | Edit business Approved ბიზნესზე | ცვლილება რეგისტრაციაშიც იწერება |
| REG-11 | Edit business დაკავებული ident-ით | 1481, რეგისტრაცია არ იცვლება (ცნობილი ხარვეზი 11) |
| REG-12 | WALLET კლიენტის მიბმა რეგისტრირებულ ბიზნესზე | ~2 წთ-ში enrollments-ში ჩანს (KD-2608 — ჩავარდება) |
| REG-13 | Unlink | enrollment CLOSED (ENROLLMENT_ENDED) |
| REG-14 | Cancel | CANCELLED, ყველა enrollment CLOSED; ხელახლა Cancel → 7011; edit → 7011 |
| REG-15 | Register to RS: უკვე მიბმული wallet **იგივე ident-ით** (RSR-07) | ახალი რეგისტრაცია არ იქმნება — wallet ებმება არსებულს (იგივე registration id) |
| REG-16 | Register to RS: უკვე მიბმული wallet **სხვა ident-ით** (RSR-08) | 409 / 7021 "This holder is already enrolled for a different taxpayer" |
| REG-17 | Cancel ათავისუფლებს wallet-ს | რეგისტრაციის Cancel → enrollment CLOSED → იგივე wallet სხვა ident-ით რეგისტრირდება წარმატებით (7021 აღარ არის) |

მაგალითი dev-ზე (REG-15 – REG-17): wallet `QA Cormier - Stamm` (`CLIENT:56cb96f7…`) მიბმულია რეგისტრაციაზე `0f5cd699-93ec-4e25-ad34-2dc7bb0f33cd` (ident 454544444, Not submitted); ident `34344234323`-ით Register to RS → 7021 (2026-11-06).

**UX შენიშვნა (Low, Jira-ში ჯერ არ არის):** Register to RS → Wallet client dropdown უკვე მიბმულ wallet-საც აჩვენებს მონიშვნის გარეშე; 7021 ჩანს მხოლოდ Save-ის შემდეგ. სჯობს dropdown-შივე ეწეროს, მაგ. "QA Cormier - Stamm · enrolled in 454544444".

**ავტომატიზირებულია (2026-11-06):** `tests/RS/Positive/rs-registration.spec.ts` (11) + `tests/RS/Negative/rs-registration-negative.spec.ts` (12), helper `utils/order-helpers/RS/RsRegistrationHelper.ts`. REG-03 dev-ზე ვერ ტესტდება (სიმულატორი submit-ს მყისიერად ადასტურებს → residency მაშინვე 7012). შედეგი: 18 ✅ / 5 ❌ — ყველა ❌ ბაგია:

| ტესტი | ბაგი | Jira |
|---|---|---|
| ბიზნესზე მიბმული მეორე WALLET ავტომატურად enrolled | enrollment არ ხდება | KD-2608 |
| Unlink → enrollment CLOSED | 150+ წმ-ის შემდეგ ACTIVE რჩება (ENR-07) — სავარაუდოდ იგივე hub RS job | ჯერ არა (KD-2608-ის კომენტარად?) |
| Edit business დაკავებული ident-ით → რეგისტრაცია უცვლელი | ბიზნესი 1481, მაგრამ რეგისტრაციის ident იცვლება სხვისზე (ცნობილი ხარვეზი 11) | KD-2612 |
| operDate მომავალში — რეგისტრაცია / ბიზნესი | 200 — docs: "not in the future" (ადრე Q1) | ჯერ არა |

შენიშვნა: `dataDiffersFields` API-დან მასივის ნაცვლად JSON-ტექსტად მოდის (`"[\"ownerFullName\"]"`).

## 2026-11-10 — ახალი მიგნებები (Jira-ში ჯერ არ არის, ერთად გასაწერი)

| # | სად | ბაგი / კითხვა | ვის | ტესტი |
|---|---|---|---|---|
| 1 | hub wallet + ინკასო — [KD-2678](https://keepz-me.atlassian.net/browse/KD-2678) | ინკასოდან hub wallet-ს **ჩამოეჭრა** ნაწილი (0.3), RS-მა დარჩენილი მოხსნა (WITHDRAWN, allocation RELEASED, held 0) → wallet ბიზნესიდან **ვერ იხსნება**: `DELETE /api/distributor-hub-business/{id}/clients/{clientId}` → 400 / 5114 "Money is held on this client for RS". მაგ.: ინკასო `QA-C-MIX-1794321047940`, wallet `CLIENT:24fcf170-72a6-4b8e-93ca-8b88ecdb6eac`, ბიზნესი `90788951-bcff-4445-ad25-a1f664d4bd25` | Nika | rs-mixed-wallets "ინკასო 0.35 … ადმინი იხდის 0.3" |
| 2 | ახალი merchant | შექმნისას **თავისით არ ერთვება RS-ში** (ENR-01: უნდა შეიქმნას / მიებას რეგისტრაციას). 2+ წთ — enrollment არ ჩნდება; ხელით "Register to RS" მუშაობს | Nika | — (ტესტები ხელით აბამენ) |
| 3 | ადმინი `PUT /api/v1/merchant/update` | update მთელ merchant-ს გადაწერს; GET-ს ~20 ველი აკლია (isActive, isLocked…) → GET-ის პასუხით update → merchant **BLOCKED**, მისი ნომრით შესვლა 3050; `lock=false` / `status: ACTIVE` არ ხსნის. მაგ.: 995300000007 (`77fd84c7-3f9e-437a-9bac-18161ee68bc1`) | Nika (კითხვა) | — |
| 4 | ~~UI Treasury transfers~~ ✅ **გასწორდა 10.11 (ფრონტის განახლება)** | ~~"Bank reference" სვეტში integratorTxRef~~ → ახლა Executions-ში "MANUAL PAYMENT": Bank reference (ადმინის), Paid at, Recorded by; ცხრილში "Wallet reference" | — | rs-front-collection "ინკასოს ხელით გადახდა" ✅ |
| 5 | UI ბიზნესის გვერდი → Wallet clients | ფულით ნულამდე ჩამოჭრილი wallet: API 0 / 0 / 0, UI "-" (ნაცვლად "₾ 0.00 / ₾ 0.00 / ₾ 0.00") | Elene (Low) | rs-front-collection (⚠️ ლოგში) |
| 6 | ინკასოს History | თანხა რომ აკლია, "Allocation planned" ყოველ ~15 წთ-ში მეორდება | Nika (კითხვა) | — |
| 7 | Field changes | ალტ. ნომრის ცვლილება არ იწერება; თარიღი 2026-10-31 (სხვაგან 31 Oct 2026); "Changed by" — ID, სახელი არა | Elene / Nika (კითხვა) | rs-front-registration-tabs |
| 8 | ინკასოს ფანჯარა — ხელით რეჟიმი | Overview წერს "Pay it to treasury … **then record the payment**", მაგრამ გადახდის ჩაწერის ღილაკი UI-ში **არ არის** — მხოლოდ API (`POST …/manual-payment`, ჩვენს მომხმარებელს ეს უფლება აქვს). production-ზე ადმინი UI-დან ვერ ჩაწერს | Elene / Nika (კითხვა) | rs-front-collection "ინკასოს ხელით გადახდა" |
| 9 | ინკასოს ფანჯარა → Executions | გადახდის შემდეგაც წერს "Treasury payments are manual: **nothing was accomplished or paid**", თან Accomplished ₾0.30 და "paid by hand" — ტექსტი ეწინააღმდეგება | Elene (Low) | — |
| 10 | Register to RS → Payment merchant | merchant-ის არჩევისას Owner full name ივსება merchant-ის **სახელით** (არა Official name); ident-ის ველი რედაქტირებადი რჩება (merchant-ის RS ტაბიდან — ჩაკეტილია, RSR-15) | Elene / Nika (კითხვა) | — |
| 11 | ფანჯარა → "Reallocate holds" (11.11) | ღილაკი ჩანს **მხოლოდ Partially restricted**-ზე (KD-2617-ის გასწორების შედეგი). Fully restricted-ზე ვერ გადავანაწილებთ: მაგ. ყადაღა 0.45 = merchant 0.15 + hub 0.3 (ორივე მთლიანად) → merchant-ს შევუვსეთ 0.6 → UI-დან hub-ს ვერ გავათავისუფლებთ (API `POST …/reallocate` მუშაობს). განზრახ? | Elene (კითხვა) | rs-front-guards-negative "Reallocate holds არ ჩანს" |
| 12 | ინკასოს ფანჯარა → "Return collection" (11.11) | ✅ **განზრახ ამოიღეს** (დადასტურდა 11.11) — ბაგი არ არის. ტესტი ახლა ამოწმებს, რომ ღილაკი არ ჩანს; ფული თავისუფლდება RS-ის გამოთხოვით (Withdrawn) | — | rs-front-collection "Return collection ღილაკი არ ჩანს" |
| 14 | hub კლიენტის ბალანსი — ადმინის ჩამოჭრა (11.11) | 0 ბალანსზე `PUT /api/distributor-hub-client/{id}?amount=-5&currency=GEL` → **200**, ბალანსი **−5** (უარყოფითი). მოსალოდნელი: 400 / INSUFFICIENT_BALANCE_AMOUNT. (სატესტო კლიენტს ბალანსი 0-ზე დავუბრუნე) | Nika | — |
| — | **Retest 11.11** | Nika-ს 14 ბაგი → **TESTING DONE**: KD-2591…2601, KD-2608, KD-2612, KD-2616. **KD-2602 არ გასწორებულა** ბოლომდე:   და 　 იბლოკება, **​ (zero-width space) ისევ ინახება** (ბიზნესი + კლიენტი) — READY FOR TESTING-ში დარჩა | — | rs-client-negative / rs-business-negative "zero-width space" ❌ |
| 15 | Approved რეგისტრაცია → Edit data (11.11) | "Sent to RS" ველები ჩაკეტილია, გარდა **Known date**-ისა (Data ტაბზე "Sent to RS" ჭდე აქვს) და Alternative personal number-ისა. Known date-ის შეცვლა → 200 "Registration updated", მაგრამ ბანერი "data differs" / "Submit changes to RS" **არ ჩნდება**, dataDiffersFields null → RS-ში ძველი თარიღი რჩება, ჩვენთან ახალი. (QA RS Biz 541113-ზე თარიღი უკან დავაბრუნე) | Nika / Elene (კითხვა) | — |
| — | **Retest ელენე 11.11** | KD-2610, KD-2617 → **TESTING DONE**; KD-2659 → **To Do** (ახალი ისტორიის მოვლენები, Executions-ის ტექსტები ინგლისურად); KD-2613 — ძველი სცენარი აღარ მეორდება (RS-ის ველები ჩაკეტილია), READY FOR TESTING-ში დარჩა, იხ. #15 | — | — |
| — | **#8 ✅ 11.11** | ღილაკი "Record manual payment" დაემატა (permission ჩაირთო) — ფრონტის ტესტები UI-დან იწერენ გადახდას: rs-front-manual-payment (+ negative) | — | 14 ტესტი ✅ |
| 16 | Record manual payment ფორმა (11.11) | Amount paid წინასწარ ივსება **RS-ის პასუხით** მაშინაც, როცა გაყინული ნაკლებია (ინკასო 0.5, გაყინული 0.3, RS asks 0.50 → ფორმაში 0.5 → "Must be at most 0.3"). უმჯობესია წინასწარ = min(პასუხი, გაყინული) | Elene (Low) | rs-front-manual-payment "გაყინულია 0.3" |
| 17 | Executions → MANUAL PAYMENT (11.11) | "Recorded by" — `USER:995591078180-12322` (ID), სახელი არ ჩანს | Elene (Low) | — |
| 13 | ბიზნესის გვერდი → Unlink (11.11) | გაყინულ ფულზე Unlink **გამორთულია**, მაგრამ tooltip / მიზეზი არ ჩანს — ადმინმა არ იცის რატომ. API კოდი შეიცვალა: 400 / 5114 → **409 / 1492** "Money is held on this client for RS liens or collections…" | Elene (Low) | rs-front-guards-negative "Unlink გამორთულია" ✅ |
| **KD-2682** | ინკასოს priority — გაყინვა (11.11, High) | ფული იყინება **შემოსვლის რიგით**, priority-ს არ უყურებს (5.4.3). wallet 0.6 → P3 → P2 → P1 (თითო 0.3) → P3 Fully, P2 Fully, **P1 Pending**. ცარიელ wallet-ზე P3 → P1 → +0.3 → მიდის **P3-ს**. (QA-C-P*-DEMO-1794392517918, ident 999559299 — P1 / P3 ღიად დარჩა STR-ისთვის) | Nika | rs-front-collection "ინკასოს პრიორიტეტი" 1, 2 ❌ |
| **KD-2683** | ინკასოს priority — გადახდის რიგი (11.11, High) | Request amount / Record manual payment მუშაობს priority 2 / 3-ზე, როცა priority 1 ღიაა → P2 Executed 0.3, P1 Pending, დარჩენილი 0.3 გაყინულია P3-ზე | Nika | rs-front-collection "ინკასოს პრიორიტეტი" 4 ❌ |
| 18 | ინკასო statusReason (11.11) | Partially → შევსების შემდეგ **Fully restricted**, მაგრამ statusReason ისევ "Waiting for funds: 0.10 GEL short" (API; probe QA-C-PRIO1-1794391807337) | Nika (Low) | — |
| 19 | Withdrawn ინკასო (11.11) | გამოთხოვილ ინკასოზე Remaining **₾ 0.30** ჩანს (ვალი გაუქმებულია — უნდა 0 / "–"); მსგავსი REPLACED-ზე | Nika / Elene (Low, კითხვა) | — |
