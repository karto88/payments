# RS — ყადაღა (Lien) და ინკასო (Collection): ლოგიკა + Endpoint-ები

> წყარო: `RS Integration Test Guide` (data.js + api.js, განახლება 2026-11-04) და Jira KD-2240.
> 📋 = დოკუმენტაციაში წერია · 💡 = რატომ (ახსნა, დეველოპერთან დასადასტურებელი) · ⚠️ = ცნობილი პრობლემა / ყურადღება

---

## 0. საერთო

### Base URL-ები და ავტორიზაცია

| ცვლადი | მისამართი (dev) | ავტორიზაცია |
|---|---|---|
| `$PANEL` | `https://newadmin.dev.keepz.me` | `Authorization: Bearer <admin token>` |
| `$SIM` | `https://rs-service.dev.keepz.me/api/rs/v1/simulator/keepz` | `X-RS-Simulator-Token: <token დეველოპერისგან>` |
| `$WALLET` | payment `localhost:8060` / hub `localhost:7897` (kubectl port-forward) | HMAC ხელმოწერა (`X-RS-Integrator`, `X-RS-Timestamp`, `X-RS-Signature`) — მხოლოდ დეველოპერის წვდომით |

- `$SIM`-ის პარამეტრები იგზავნება **query string-ით**: `POST $SIM/orders/lien?personId=205920001&amount=100&lienNumber=QA-L-01`
- `$SIM` პასუხი ყოველთვის **HTTP 200**-ია, უარყოფილი item-იც კი. შედეგი ჩანს `items[].code`-ში: `null` = მიღებულია, რიცხვი = RS-ის კოდი (1, 13, 21…).
- Panel-ის პასუხი შეფუთულია `{"value": …}`-ში; error → `{"message","statusCode","exceptionGroup"}`.

### მთავარი ფორმულა

```
Available = Amount (ბალანსი) − Held (დაბლოკილი)
```
📋 ნებისმიერი გასავალი ოპერაცია (withdrawal, refund, payout, debit) იღებს **მხოლოდ Available**-ს. ჩარიცხვა არასდროს იბლოკება.

### წინაპირობა ყველა ქეისისთვის (Hub WALLET კლიენტით)

| # | Call | რა ხდება |
|---|---|---|
| 1 | `POST $PANEL/api/distributor-hub-business` | business (RESIDENT, უნიკალური 9-ციფრიანი ident) |
| 2 | `POST $PANEL/api/distributor-hub-client` | WALLET კლიენტი `businessId`-ით → `value.clientId` |
| 3 | `PUT $PANEL/api/distributor-hub-client/{clientId}?amount=300&currency=GEL&description=QA` | ბალანსის შევსება |
| 4 | (ავტომატური, ~1–2 წთ) | hub → rs-service enrollment; რეგისტრაცია `NOT_SUBMITTED` |
| 5 | `POST $SIM/orders/honest-tax-payer?personId=<ident>` | RS ადასტურებს → `APPROVED` (ან თავისით 30 წმ-ში Submit-ის შემდეგ) |

💡 ყადაღა/ინკასო მოდის **ident-ზე** (`personId`) და არა კლიენტზე — rs-service თვითონ პოულობს ამ ident-ის ყველა wallet-ს.

📋 თუ რეგისტრაცია ჯერ არ იყო APPROVED და მოვიდა lien/collection — ისიც ითვლება RS-ის დადასტურებად (რეგისტრაცია → APPROVED).

### სტატუსები (restriction)

| სტატუსი | მნიშვნელობა |
|---|---|
| `PENDING` | მიღებულია, ჯერ არაფერი დაბლოკილა |
| `PARTIALLY_RESTRICTED` | დაბლოკილია მოთხოვნილზე ნაკლები (ფული არ ჰყოფნის) |
| `FULLY_RESTRICTED` | დაბლოკილია მთლიანად |
| `PROCESSING` | ინკასო: თანხა მოთხოვნილია RS-ისგან, გადახდა მიმდინარეობს |
| `PARTIALLY_EXECUTED` / `EXECUTED` | ინკასო: ნაწილობრივ / სრულად გადახდილი |
| `WITHDRAWN` | RS-მა მოხსნა |
| `REPLACED` | შესწორებამ ჩაანაცვლა |
| `RETURNED` | ჩვენ დავუბრუნეთ RS-ს |
| `FAILED` | გადახდა ჩავარდა ყველა retry-ის შემდეგ; ფული რჩება დაბლოკილი |

### შემოწმების endpoint-ები (ყველა ქეისში გამოიყენება)

| Call | რას აჩვენებს |
|---|---|
| `GET $PANEL/api/v1/rs/restrictions?rsNumber=<ნომერი>` | ყადაღა/ინკასო ნომრით: `status`, `requestedAmount`, `restrictedAmount`, `executedAmount`, `remainingAmount`, `statusReason` |
| `GET $PANEL/api/v1/rs/restrictions?personId=<ident>` | ამ ident-ის ყველა restriction |
| `GET $PANEL/api/v1/rs/restrictions/{id}` | დეტალები: `allocations[]` (რომელ wallet-ზე რამდენი: `target`, `held`, `fillUp`, `status`), `executions[]`, `transfers[]` |
| `GET $PANEL/api/v1/rs/restrictions/{id}/history` | სრული ისტორია |
| `GET $PANEL/api/distributor-hub-client/{clientId}` | `balances[]`: `amount`, `held` — **hub კლიენტის hold აქ ჩანს** |
| `POST $PANEL/api/distributor-hub-client-balance-history/filter` | ისტორია: `RS_HOLD` / `RS_RELEASE` / `RS_TRANSFER` ტიპის ჩანაწერები |

⚠️ merchant-ის (payment-service) held/available **არ ჩანს** ჩვეულებრივ API-ში (ცნობილი პრობლემა #6) — მხოლოდ `$WALLET/rs-spi/v1/holders/MERCHANT:<id>/balances` (ხელმოწერით) ან SQL.

---

# ნაწილი 1 — ყადაღა (Lien, HLD)

### Flow

```
1. RS (სიმულატორი)   POST $SIM/orders/lien?personId=&amount=&lienNumber=
2. rs-service (ავტო)  ყველა wallet-ს ეკითხება ბალანსს (GEL) → ანაწილებს: ყველაზე დიდი available პირველი
3. wallet (ავტო)      held იზრდება, available მცირდება
4. ფული არ ჰყოფნის → fill-up: ახალი ჩარიცხვა ავტომატურად ავსებს hold-ს
5. RS (სიმულატორი)   POST $SIM/orders/obtain-lien?lienNumber= → WITHDRAWN, held = 0
```

💡 ყადაღა = **მხოლოდ გაყინვა**. ფული არსად გადაირიცხება. მთავრდება მხოლოდ მაშინ, როცა RS მოხსნის.

### Endpoint-ები

| Method | Path | პარამეტრები |
|---|---|---|
| POST | `$SIM/orders/lien` | `personId`* (9/11 ციფრი), `amount`* (GEL, >0), `lienNumber` (თუ არა — `SIM-L-…`), `personIdAlt` |
| POST | `$SIM/orders/obtain-lien` | `lienNumber`* |
| POST | `$SIM/orders/resend/{rsMessageId}` | — (წინა შეტყობინების ხელახლა გაგზავნა) |
| POST | `$PANEL/api/v1/rs/restrictions/{id}/reallocate` | — (hold-ების ხელახლა განაწილება; perm `RS_RESTRICTION_MANAGE`) |

---

### HLD-01 — ყადაღა ერთ wallet-ზე (P1)

📋 merchant-ს აქვს **300** ლარი, ყადაღა **100**-ზე → held = **100**, available = **200**.
გატანა **250** → უარი **2501** (log: "balance 300 but 100 held for RS"); გატანა **200** → გადის.

💡 ბალანსზე 300 ჩანს, მაგრამ 100 "სახელმწიფოსია" — კლიენტს მხოლოდ 200 შეუძლია გამოიყენოს.
⚠️ merchant-ის API მაინც 300-ს აჩვენებს (ცნობილი პრობლემა #6).

| # | Call | რას ველით |
|---|---|---|
| 1 | `POST $SIM/orders/honest-tax-payer?personId=205920001` | რეგისტრაცია APPROVED |
| 2 | `GET $WALLET/rs-spi/v1/holders/MERCHANT:<id>/balances` | amount 300, available 300 |
| 3 | `POST $SIM/orders/lien?personId=205920001&amount=100&lienNumber=QA-L-HLD01` | `items[0].code = null` |
| 4 | `GET $PANEL/api/v1/rs/restrictions?rsNumber=QA-L-HLD01` | `FULLY_RESTRICTED` |
| 5 | `GET $WALLET/.../balances` | held 100, available 200 |
| 6 | merchant withdrawal 250 → 200 | 250 → 2501; 200 → OK; შემდეგ amount 100, held 100 |

👉 **Hub ვერსია (Postman-ით შესაძლებელი):** კლიენტს 300 შეუვსე → lien 100 → `GET $PANEL/api/distributor-hub-client/{id}` → `held: 100` → debit `PUT ...?amount=-250` უარი, `?amount=-200` გადის.

---

### HLD-02 — ყადაღა ფულზე მეტია (P1)

📋 ერთ ident-ს აქვს merchant (**100**) და hub კლიენტი (**1000**). ყადაღა **2000**-ზე →
ორივე **მთლიანად** იბლოკება (restricted **1100**), სტატუსი `PARTIALLY_RESTRICTED`, მიზეზი "Waiting for funds: 900.00 GEL short".

💡 ვბლოკავთ იმას, რაც გვაქვს; დანარჩენ 900-ს **მომავალი ჩარიცხვებიდან** ველოდებით (fill-up).

| # | Call | რას ველით |
|---|---|---|
| 1 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=1000&currency=GEL&description=QA%20HLD-02` | hub კლიენტს 1000 |
| 2 | `POST $SIM/orders/lien?personId=205920002&amount=2000&lienNumber=QA-L-HLD02` | მიღებულია |
| 3 | `GET $PANEL/api/v1/rs/restrictions?rsNumber=QA-L-HLD02` | `PARTIALLY_RESTRICTED`, `restrictedAmount 1100` |
| 4 | `GET $PANEL/api/v1/rs/restrictions/{id}` | ორი allocation `fillUp: true`; `statusReason` "…900.00 GEL short" |
| 5 | `GET $PANEL/api/distributor-hub-client/{id}` | amount 1000, held 1000 |
| 6 | merchant balances | held 100, available 0 |

---

### HLD-03 — ახალი ფული ავსებს hold-ს (P1)

📋 HLD-02-ის მდგომარეობიდან: merchant-ს ერიცხება **500** → hold იზრდება 500-ით, იგზავნება `HOLD_FILLED`, restricted → **1600**.

💡 სანამ ვალი სრულად არ დაიფარება, ყველა ახალი შემოსვლა იბლოკება.
⚠️ ჩავარდნილი withdrawal-ის დაბრუნებული (reversal) თანხაც იბლოკება (ცნობილი პრობლემა #8) — ეს სადავოა, რადგან ახალი ფული არ არის.

| # | Call | რას ველით |
|---|---|---|
| 1 | merchant balances (წინ) | held 100, available 0 |
| 2 | merchant-ზე 500-ის გადახდა (BALANCE-flow branch) | — |
| 3 | merchant balances | held 600 |
| 4 | `GET $PANEL/api/v1/rs/restrictions/{id}` | `restrictedAmount 1600`, merchant allocation held 600 |
| 5 | `GET $PANEL/api/v1/rs/restrictions/{id}/history` | fill-up ჩანაწერი |

👉 **Hub ვერსია:** fill-up hold-იან კლიენტს `PUT ...?amount=500` → `held` მაშინვე იზრდება (`RS_HOLD` ისტორიაში).

---

### HLD-04 — რომელი wallet ბლოკავს (P2)

📋 ა) ყადაღა **500**: merchant available **100**, hub **1000** → **მხოლოდ hub** ბლოკავს 500-ს.
ბ) ყადაღა **50**: ორივეს თანაბარი (100/100) → ბლოკავს ის integrator, რომლის `allocationPriority` **უფრო დაბალია** (payment-service = 10, distributor-hub = 20).

💡 ყველაზე დიდი ბალანსი პირველი — რაც შეიძლება ნაკლებ ანგარიშს შევეხოთ.

| # | Call | რას ველით |
|---|---|---|
| 1 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=1000&currency=GEL` | — |
| 2 | `POST $SIM/orders/lien?personId=205920004&amount=500&lienNumber=QA-L-HLD04A` | — |
| 3 | `GET $PANEL/api/v1/rs/restrictions/{id}` | ერთი allocation: hub კლიენტი, held 500 |
| 4 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=-400&currency=GEL` | hub-საც 100 available |
| 5 | `GET $PANEL/api/v1/rs/partners` | ჩაინიშნე `allocationPriority` |
| 6 | `POST $SIM/orders/lien?personId=205920004&amount=50&lienNumber=QA-L-HLD04B` | — |
| 7 | `GET $PANEL/api/v1/rs/restrictions/{id}` | ბლოკავს დაბალი priority-ს integrator |

---

### HLD-05 — მხოლოდ GEL ითვლება (P3)

📋 კლიენტს აქვს მხოლოდ **USD** → არაფერი იბლოკება; fill-up hold-ები held 0-ით; სტატუსი `PENDING` ან `PARTIALLY_RESTRICTED`.

💡 RS ვალი ლარშია; ვალუტის კონვერტაციის წესი ჯერ შეთანხმებული არ არის.
⚠️ Jira (KD-2240) მრავალვალუტიან დაბლოკვას აღწერს — **ნიკასთან დასაზუსტებელი**.

| # | Call | რას ველით |
|---|---|---|
| 1 | `POST $PANEL/api/distributor-hub-business` (ident 205920005) | — |
| 2 | `POST $PANEL/api/distributor-hub-client` — `enabledCurrencies:["USD"]`, `currencyConfigs.USD` GEL-ის ნაცვლად | USD-only WALLET |
| 3 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=500&currency=USD` | — |
| 4 | (~1 წთ) `POST $SIM/orders/lien?personId=205920005&amount=100&lienNumber=QA-L-HLD05` | — |
| 5 | `GET $PANEL/api/v1/rs/restrictions/{id}` | held 0, `PENDING`/`PARTIALLY_RESTRICTED` |
| 6 | `GET $PANEL/api/distributor-hub-client/{id}` | USD held 0 |

---

### HLD-06 — wallet-ები, რომლებიც ვერ ბლოკავენ (P2)

📋 **unlimited** hub კლიენტი (`unlimitedGel: true`) და **instant settlement** merchant → `holdCapable: false` მიზეზით; hold არ უნდა დაედოს. თუ სხვა wallet არ აქვს → restriction `uncoverable` + alert.

💡 instant settlement-ის დროს ფული ბალანსზე არ ჩერდება (მაშინვე IBAN-ზე მიდის); unlimited ბალანსი რეალური ფული არ არის — დასაბლოკი არაფერია.

| # | Call | რას ველით |
|---|---|---|
| 1 | `POST $PANEL/api/distributor-hub-client` — `"unlimitedGel": true`, businessId (205920006) | — |
| 2 | `GET $WALLET/rs-spi/v1/holders/CLIENT:<id>/balances` | `holdCapable: false`, reason unlimited |
| 3 | `POST $SIM/orders/lien?personId=205920006&amount=100&lienNumber=QA-L-HLD06A` | — |
| 4 | `GET $PANEL/api/v1/rs/restrictions/{id}` | კლიენტზე hold არ არის; თუ დაედო — ჩაიწერე (ბაგი) |
| 5 | instant-settlement merchant: იგივე (`QA-L-HLD06B`) | hold არ არის; `uncoverable: true` |

---

### HLD-07 — ყადაღის მოხსნა (P1)

📋 `obtain-lien` → სტატუსი `WITHDRAWN`; ყველა allocation `RELEASED`, held 0; available = მთელი ბალანსი; ისტორიაში `HOLD_RELEASE`.

💡 RS-მა გააუქმა ბრძანება — ფული მაშინვე ბრუნდება კლიენტის განკარგულებაში.

| # | Call | რას ველით |
|---|---|---|
| 1 | `POST $SIM/orders/obtain-lien?lienNumber=QA-L-HLD01` | მიღებულია |
| 2 | `GET $PANEL/api/v1/rs/restrictions?rsNumber=QA-L-HLD01` | `WITHDRAWN` |
| 3 | `GET $PANEL/api/v1/rs/restrictions/{id}` | ყველა allocation `RELEASED`, held 0 |
| 4 | `GET $PANEL/api/distributor-hub-client/{id}` (hub) | held 0 |

---

### HLD-08 — უცნობი ან დახურული კლიენტი (P2)

📋 ident ჩვენთან არ არსებობს → `items[].code = 1` + alert `CLIENT_NOT_MATCHED`; არაფერი ინახება.
კლიენტის ყველა ანგარიში დახურულია → `code = 13`.

💡 RS-მა უნდა იცოდეს, რომ ჩვენთან ფული არ არის — სხვა ბანკს მიმართავს.

| # | Call | რას ველით |
|---|---|---|
| 1 | `POST $SIM/orders/lien?personId=205929999&amount=100&lienNumber=QA-L-HLD08A` | `code: 1` |
| 2 | `GET $PANEL/api/v1/rs/restrictions?rsNumber=QA-L-HLD08A` | ცარიელი |
| 3 | `GET $PANEL/api/v1/rs/registrations/{id}` (დახურული კლიენტის) | enrollment `accountsOpen: false` |
| 4 | `POST $SIM/orders/lien?personId=<დახურულის ident>&amount=100&lienNumber=QA-L-HLD08B` | `code: 13` |

---

### HLD-09 — დუბლიკატი (P2)

📋 იგივე `lienNumber` მეორედ → `code = 21`. იგივე RS შეტყობინების ხელახლა გაგზავნა (`resend`) → იგივე პასუხი, ახალი არაფერი იქმნება.

💡 ორმაგი დაბლოკვა = კლიენტის ფულის უსამართლო გაყინვა. RS ხშირად იმეორებს შეტყობინებას, თუ პასუხი ვერ მიიღო — ამიტომ idempotency აუცილებელია.

| # | Call | რას ველით |
|---|---|---|
| 1 | `POST $SIM/orders/lien?personId=205920009&amount=50&lienNumber=QA-L-HLD09` | ჩაინიშნე `rsMessageId` |
| 2 | იგივე call | `code: 21` |
| 3 | `POST $SIM/orders/resend/{rsMessageId}` | იგივე acknowledgement |
| 4 | `GET $PANEL/api/v1/rs/restrictions?rsNumber=QA-L-HLD09` | **ზუსტად ერთი** |
| 5 | `GET $PANEL/api/v1/rs/messages/in?rsMessageId=<id>` | ერთი შენახული შეტყობინება |

---

### HLD-10 — hub-ის debit ვერ ეხება held-ს (P1) ⭐ Postman-ით სრულად

📋 ბალანსი **100**, held **70** (available 30):
debit **40** → უარი (payout/DEBIT: 5038 / REJECTED INSUFFICIENT_BALANCE; admin adjustment: **1141**).
debit **30** → გადის, balanceAfter 70. ბალანსი held-ზე დაბლა **ვერასდროს** ჩავა.

💡 დაბლოკილი 70 სახელმწიფოსია — ნებისმიერი გასავალი ოპერაცია მხოლოდ 30-ს იღებს.

| # | Call | რას ველით |
|---|---|---|
| 1 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=100&currency=GEL&description=QA%20HLD-10` | APPLIED |
| 2 | `POST $SIM/orders/lien?personId=205920010&amount=70&lienNumber=QA-L-HLD10` | — |
| 3 | `GET $PANEL/api/distributor-hub-client/{id}` | amount 100, held 70 |
| 4 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=-40&currency=GEL&description=QA%20debit` | **1141** (hub insufficient balance) |
| 5 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=-30&currency=GEL&description=QA%20debit` | APPLIED, `balanceAfter 70` |
| 6 | `GET $PANEL/api/distributor-hub-client/{id}` | amount 70, held 70 |

---

### HLD-11 — დეტალები და reallocate (P2)

| # | Call | რას ველით |
|---|---|---|
| 1 | `GET $PANEL/api/v1/rs/restrictions/{id}` | `allocations[]`: integrator, target, held, executed, fillUp, status |
| 2 | `GET $PANEL/api/v1/rs/restrictions/{id}/history` | ისტორია |
| 3 | `POST $PANEL/api/v1/rs/restrictions/{id}/reallocate` | 200 |
| 4 | `GET $PANEL/api/v1/rs/restrictions/{id}/audit?pageIndex=1&pageSize=10` | `REALLOCATE_REQUESTED` |

### HLD-12 — გატანა და ყადაღა ერთდროულად (P3)
📋 ორი ადამიანი ერთდროულად: ერთი იტანს მთელ თანხას, მეორე აგზავნის ყადაღას → ან hold იღებს დარჩენილს, ან გატანა ვარდება 2501-ით. **available ვერასდროს ჩავა 0-ზე დაბლა.**

### HLD-13 — hold გადადის, როცა wallet იხურება (P2)
📋 merchant-ზე hold 100; იმავე ident-ის hub კლიენტს 200 → merchant-ის წაშლა → merchant hold `RELEASED` (WALLET_GONE), hub კლიენტი იღებს 100-ს.
💡 ვალი რჩება — ის უბრალოდ სხვა ანგარიშზე გადადის.

---

# ნაწილი 2 — ინკასო (Collection, COL)

### Flow

```
1. RS (სიმულატორი)    POST $SIM/orders/collection → იბლოკება ყადაღასავით (FULLY_RESTRICTED)
2. სამუშაო დღე, 15:00–16:45 (Tbilisi):
     ხელით:  POST $PANEL/api/v1/rs/restrictions/{id}/request-amount   (დღეში ერთხელ)
     ავტო:   16:15
   → CHECK_COLLECTION_AMOUNT RS-ს → სტატუსი PROCESSING
3. RS პასუხობს თანხას (სიმულატორი: default = სრული; scenario-თი — შენი არჩეული)
4. rs-service → COLLECTION_ACCOMPLISH → wallet რიცხავს სახაზინოში (BOG) დაბლოკილიდან
5. SUCCESS → EXECUTED (ან PARTIALLY_EXECUTED), hold-ები იხსნება
   ალტერნატივა: POST .../return → RETURNED, ფული თავისუფლდება
   17:00-მდე პასუხი არ მოვიდა → უკან FULLY_RESTRICTED, ხვალ თავიდან
```

💡 რატომ ვეკითხებით RS-ს თანხას გადახდის დღეს: ვალი იცვლება (ჯარიმა, კლიენტმა ნაწილი თვითონ გადაიხადა). ამიტომ **ყოველთვის RS-ის იმ დღის პასუხს** ვიყენებთ და არა თავდაპირველ თანხას.

### Endpoint-ები

| Method | Path | პარამეტრები / Body |
|---|---|---|
| POST | `$SIM/orders/collection` | `personId`*, `amount`*, `collectionNumber`, `priority` (default 1), `revAccount` (სახაზინო კოდი, default 101001000), `collectionStatus` (1 ახალი / 2 შესწორება / 3 მესამე პირი), `note` (ტიპი 2: `#C-1`), `personName`, `thirdPersonId`, `thirdPersonName` |
| POST | `$SIM/orders/obtain-collection` | `collectionNumber`* |
| POST | `$SIM/scenarios` | JSON: `{"match","collectionNumber","amount"}` — RS რამდენს დაგვრთავს; ან `{"match","errorCode","description"}` |
| POST | `$SIM/orders/collection-amount` | `collectionNumber`, `amount` — RS-ის დაგვიანებული პასუხი |
| POST | `$PANEL/api/v1/rs/restrictions/{id}/request-amount` | — perm `RS_COLLECTION_MANUAL_AMOUNT_REQUEST` |
| POST | `$PANEL/api/v1/rs/restrictions/{id}/return` | `{"reason":"…"}` (1–500 სიმბოლო) — perm `RS_RESTRICTION_MANAGE` |
| POST | `$PANEL/api/v1/rs/restrictions/{id}/start-enforcement` | — (მესამე პირის ინკასოსთვის) |
| PUT / DELETE | `$PANEL/api/v1/rs/calendar/{YYYY-MM-DD}` | `{"working":false,"note":"…"}` — დღის სამუშაოდ/დასვენებად გადაყვანა (perm `RS_ADMIN`) |
| GET | `$PANEL/api/v1/rs/messages/out?operation=<OP>` | `CHECK_COLLECTION_AMOUNT`, `COLLECTION_ACCOMPLISH`, `RETURN_COLLECTION`, `ERROR_REPORT` |

⚠️ **დრო:** COL-02, 03, 04, 05, 06, 07, 08, 10 საჭიროებს **სამუშაო დღეს 15:00–16:45 (Tbilisi)**. ამ შუალედის გარეთ მხოლოდ 7017-ის შემოწმება შეიძლება.

---

### COL-01 — ინკასო ჯერ იბლოკება (P1)

📋 ინკასო მოსვლისთანავე იბლოკება ყადაღასავით (`FULLY_RESTRICTED`), ჩანს `revAccount`, `revCode`, `effectiveBusinessDay`.
**16:45-ის შემდეგ** მოსული → `effectiveBusinessDay` = **მომდევნო სამუშაო დღე**.

💡 ჯერ ფულს "ვიჭერთ", რომ კლიენტმა ვერ გაიტანოს; გადარიცხვა მხოლოდ დღის ციკლში ხდება.

| # | Call | რას ველით |
|---|---|---|
| 1 | `PUT $PANEL/api/distributor-hub-client/{id}?amount=300&currency=GEL&description=QA%20COL-01` | — |
| 2 | (16:45-მდე) `POST $SIM/orders/collection?personId=205930001&amount=100&collectionNumber=QA-C-COL01A` | — |
| 3 | `GET $PANEL/api/v1/rs/restrictions?rsNumber=QA-C-COL01A` | `FULLY_RESTRICTED`, `effectiveBusinessDay` = დღეს |
| 4 | (16:45-ის შემდეგ) `...&collectionNumber=QA-C-COL01B` | — |
| 5 | `GET ...?rsNumber=QA-C-COL01B` | `effectiveBusinessDay` = მომდევნო სამუშაო დღე |

---

### COL-02 — თანხის ხელით მოთხოვნის წესები (P1)

📋
| სიტუაცია | შედეგი |
|---|---|
| 15:00–16:45-ის გარეთ | **409 / 7017** |
| დასვენების დღეს | **409 / 7017** |
| შუალედში, სამუშაო დღეს | execution `REQUESTED`, სტატუსი `PROCESSING` |
| იმავე დღეს მეორედ | **409 / 7018** |
| ინკასო, რომელზეც არაფერი დაბლოკილა | **409 / 7011** "No funds are restricted for this collection yet" |

💡 RS-ის ციკლი დღეში ერთხელ მუშაობს; ორჯერ მოთხოვნა → ორმაგი ჩამოჭრის რისკი.

| # | Call | რას ველით |
|---|---|---|
| 1 | (შუალედის გარეთ) `POST $PANEL/api/v1/rs/restrictions/{id}/request-amount` | 7017 |
| 2 | `PUT $PANEL/api/v1/rs/calendar/<დღეს>` `{"working":false,"note":"QA COL-02 day off"}` | — |
| 3 | `POST .../request-amount` | 7017 |
| 4 | `DELETE $PANEL/api/v1/rs/calendar/<დღეს>` | 204 (დაბრუნება) |
| 5 | (შუალედში) `POST .../request-amount` | `status: REQUESTED` |
| 6 | `GET $PANEL/api/v1/rs/restrictions/{id}` | `PROCESSING` |
| 7 | `POST .../request-amount` | 7018 |
| 8 | `POST .../request-amount` (ინკასო held-ის გარეშე) | 7011 |

---

### COL-03 — ავტომატური მოთხოვნა 16:15-ზე (P2)

📋 ერთ ident-ზე ორი ინკასო, priority 1 და 2 → 16:15-ზე მოითხოვება **მხოლოდ უმაღლესი პრიორიტეტის** (priority 1).

| # | Call | რას ველით |
|---|---|---|
| 1 | `PUT .../distributor-hub-client/{id}?amount=500&currency=GEL` | — |
| 2 | `POST $SIM/orders/collection?personId=205930003&amount=100&collectionNumber=QA-C-COL03A&priority=1` | — |
| 3 | `POST $SIM/orders/collection?personId=205930003&amount=100&collectionNumber=QA-C-COL03B&priority=2` | — |
| 4 | `GET $PANEL/api/v1/rs/restrictions?personId=205930003` | ორივე `FULLY_RESTRICTED` |
| 5 | (16:15-ის შემდეგ) `GET $PANEL/api/v1/rs/messages/out?operation=CHECK_COLLECTION_AMOUNT` | მხოლოდ ერთი |
| 6 | `GET .../restrictions/{id}` თითოეული | execution მხოლოდ COL03A-ზე |

---

### COL-04 — სრული გადახდა სახაზინოში (P1) ⭐

📋 RS სრულ თანხას ადასტურებს → `COLLECTION_ACCOMPLISH` (urgent lane) → treasury transfer **SUCCESS** → `EXECUTED` → hold-ები იხსნება.
- hub: ტრანზაქცია `RS-TRANSFER:<id>`, ledger `PAYOUT_DEBIT`, ისტორიაში `RS_TRANSFER` −100.
- payment: generic transaction TREASURY → "სახელმწიფო ხაზინა", ledger `RS_TREASURY_TRANSFER`.

💡 ეს არის ინკასოს "ბედნიერი გზა" — ვალი გადახდილია, ფული სახელმწიფოს ანგარიშზეა.

| # | Call | რას ველით |
|---|---|---|
| 1 | `PUT .../distributor-hub-client/{id}?amount=200&currency=GEL` | — |
| 2 | `POST $SIM/orders/collection?personId=205930004&amount=100&collectionNumber=QA-C-COL04` | — |
| 3 | `POST $SIM/scenarios` `{"match":"QA-C-COL04","collectionNumber":"QA-C-COL04","amount":100}` | RS სრულ 100-ს დაგვრთავს |
| 4 | (15:00–16:45) `POST $PANEL/api/v1/rs/restrictions/{id}/request-amount` | `REQUESTED` |
| 5 | `GET $PANEL/api/v1/rs/restrictions/{id}` | `EXECUTED`, `transfers[].status SUCCESS`, allocations `RELEASED` |
| 6 | `GET $PANEL/api/v1/rs/messages/out?operation=COLLECTION_ACCOMPLISH` | არის (lane urgent) |
| 7 | `POST $PANEL/api/distributor-hub-client-balance-history/filter` `{"clientId":"<id>","type":"RS_TRANSFER","pageIndex":1,"pageSize":10}` | ერთი ჩანაწერი −100 |

---

### COL-05 — ნაწილობრივი გადახდა (P1)

📋 ინკასო **100**, RS დაგვრთავს **80** → 80 გადაირიცხა, `PARTIALLY_EXECUTED`, **20 რჩება დაბლოკილი**.

💡 RS-მა ვალი შეამცირა ან ნაწილის ჩამოჭრა დაგვრთო; დარჩენილი 20 ელოდება შემდეგ დღეს.

| # | Call | რას ველით |
|---|---|---|
| 1 | `PUT .../distributor-hub-client/{id}?amount=200&currency=GEL` | — |
| 2 | `POST $SIM/orders/collection?personId=205930005&amount=100&collectionNumber=QA-C-COL05` | — |
| 3 | `POST $SIM/scenarios` `{"match":"QA-C-COL05","collectionNumber":"QA-C-COL05","amount":80}` | — |
| 4 | `POST .../restrictions/{id}/request-amount` | — |
| 5 | `GET .../restrictions/{id}` | `executedAmount 80`, `PARTIALLY_EXECUTED`, allocation held 20 |
| 6 | `GET .../distributor-hub-client/{id}` | amount 120, held 20 |

---

### COL-06 — RS პასუხობს 0 (P2)

📋 RS: "დღეს არაფერი" → execution `NO_AMOUNT`, სტატუსი უკან `FULLY_RESTRICTED`, held რჩება 100.

| # | Call | რას ველით |
|---|---|---|
| 1–2 | შევსება 200 + collection 100 (`QA-C-COL06`) | — |
| 3 | `POST $SIM/scenarios` `{"match":"QA-C-COL06","collectionNumber":"QA-C-COL06","amount":0}` | — |
| 4 | `POST .../request-amount` | — |
| 5 | `GET .../restrictions/{id}` | execution `NO_AMOUNT`, `FULLY_RESTRICTED` |
| 6 | `GET .../distributor-hub-client/{id}` | held 100 |

---

### COL-07 — თანხა RS-ის error 18-ის ტექსტში (P3)

📋 RS error 18-ით პასუხობს და თანხა ტექსტშია ("80 GEL may be collected") → გამოიყენება **ტექსტის პირველი რიცხვი** (80). ორი რიცხვი ("30 of 120") → ჩაიწერე, რომელი აიღო.

| # | Call |
|---|---|
| 1 | `POST $SIM/orders` `{"items":[{"type":"Collection","fields":{"PersonId":"205930007","CollectionNumber":"QA-C-COL07A","Amount":"100"}},{"type":"Collection","fields":{"PersonId":"205930007","CollectionNumber":"QA-C-COL07B","Amount":"100"}}]}` |
| 2 | `POST $SIM/scenarios` `{"match":"QA-C-COL07A","errorCode":"18","description":"QA: 80 GEL may be collected"}` |
| 3 | `POST $SIM/scenarios` `{"match":"QA-C-COL07B","errorCode":"18","description":"QA: 30 of 120 GEL may be collected"}` |
| 4 | `request-amount` ორივეზე → `GET .../restrictions/{id}`: COL07A `answerAmount 80`; COL07B — ჩაიწერე |

---

### COL-08 — სახაზინოში გადარიცხვა ჩავარდა (P1)

📋 ყოველი ჩავარდნისას ფული ბრუნდება და ისევ იბლოკება; retry transfer ID-ებით `…-2`, `…-3`, `…-4`.
მე-4-ის შემდეგ: RS-ს **Error 23** (`ERROR_REPORT`), სტატუსი `FAILED`, critical alert, **ფული რჩება დაბლოკილი**. მომდევნო სამუშაო დღეს ხელით მოთხოვნა დაშვებულია.

💡 ფული არც იკარგება და არც კლიენტს უბრუნდება — ადამიანი უნდა ჩაერიოს.

| # | Call | რას ველით |
|---|---|---|
| 1–2 | შევსება 200 + collection 100 (`QA-C-COL08`) | — |
| 3 | (დეველოპერი აფეილებს ბანკის გადარიცხვას) `POST .../request-amount` | — |
| 4 | `GET .../restrictions/{id}` | `transfers[]` FAILED ×4, `FAILED`, allocations held |
| 5 | `GET $PANEL/api/v1/rs/messages/out?operation=ERROR_REPORT` | Error 23 |
| 6 | (მომდევნო სამუშაო დღე) `POST .../request-amount` | დაშვებულია |

### COL-09 — სახაზინო გადარიცხვის ხელით retry აკრძალულია (P2)
📋 payment: **2537**; hub: **403** "You can't retry an RS treasury payment…".
💡 ორმაგი გადარიცხვის თავიდან ასაცილებლად — retry-ს მხოლოდ rs-service მართავს.

### COL-10 — wallet უარს ამბობს გადარიცხვაზე (P2)
📋 სახაზინო კოდი არ არის 9 ციფრი (payment) → FAILED "Treasury code (revAccount) must have 9 digits"; hub კლიენტს არ აქვს BOG system account → FAILED "No BOG treasury rail…". **არაფერი ჩამოიჭრება.**

---

### COL-11 — ინკასოს დაბრუნება RS-ისთვის (P2) ⭐ Postman-ით (დროის შეზღუდვის გარეშე)

📋 `reason` ცარიელი → **400 / 1001**; 501 სიმბოლო → **400 / 1001**; ნორმალური → `RETURNED`, ყველა allocation `RELEASED`, `RETURN_COLLECTION` შეტყობინება.

💡 მაგ. კლიენტი იხურება ან ინკასო შეცდომითაა — ვუბრუნებთ RS-ს და ფულს ვათავისუფლებთ.

| # | Call | რას ველით |
|---|---|---|
| 1–2 | შევსება 200 + collection 100 (`QA-C-COL11`) | — |
| 3 | `POST $PANEL/api/v1/rs/restrictions/{id}/return` `{"reason":""}` | 1001 |
| 4 | იგივე, `reason` 501 სიმბოლო | 1001 |
| 5 | `{"reason":"QA COL-11 client closing"}` | `RETURNED` |
| 6 | `GET .../restrictions/{id}` | allocations `RELEASED` |
| 7 | `GET $PANEL/api/v1/rs/messages/out?operation=RETURN_COLLECTION` | არის |

---

### COL-12 — შესწორება ცვლის ინკასოს (P2)

📋 `collectionStatus=2` + `note=#<ძველი ნომერი>` → ძველი `REPLACED`, hold-ები გადადის ახალზე, **ორმაგი ბლოკის გარეშე** (held 120 და არა 220).

| # | Call | რას ველით |
|---|---|---|
| 1 | შევსება 300 | — |
| 2 | `POST $SIM/orders/collection?personId=205930012&amount=100&collectionNumber=QA-C-COL12` | — |
| 3 | `POST $SIM/orders/collection?personId=205930012&amount=120&collectionNumber=QA-C-COL12R&collectionStatus=2&note=%23QA-C-COL12` | — |
| 4 | `GET .../restrictions?rsNumber=QA-C-COL12` | `REPLACED`, `replacedById` |
| 5 | `GET .../restrictions/{id of COL12R}` | `replacesNumbers: QA-C-COL12` |
| 6 | `GET .../distributor-hub-client/{id}` | held **120** |

---

### COL-13 — მესამე პირის ვალი (P2)

📋 `collectionStatus=3` → ინახება **hold-ის გარეშე**, მიზეზი "Third-person collection: needs a manual decision", alert. `start-enforcement`-ის შემდეგ → hold-ები, `FULLY_RESTRICTED`.

💡 სხვისი ვალის გამო კლიენტის ფულის ავტომატური გაყინვა სამართლებრივად სადავოა — ადამიანი წყვეტს.

| # | Call | რას ველით |
|---|---|---|
| 1 | შევსება 200 | — |
| 2 | `POST $SIM/orders/collection?personId=205930013&amount=100&collectionNumber=QA-C-COL13&collectionStatus=3&thirdPersonId=205930113&thirdPersonName=QA%20Third` | — |
| 3 | `GET .../restrictions?rsNumber=QA-C-COL13` | `enforcementEnabled: false`, held 0 |
| 4 | `POST $PANEL/api/v1/rs/restrictions/{id}/start-enforcement` | — |
| 5 | `GET .../restrictions/{id}` | held, `FULLY_RESTRICTED` |

---

### COL-14 — არასწორი სახაზინო კოდი / დუბლიკატი ნომერი (P3)

📋 იგივე `collectionNumber` → `code 11`; `revAccount=999999999` → `code 24`. შენახული რჩება მხოლოდ პირველი ვალიდური.

| # | Call | რას ველით |
|---|---|---|
| 1 | `POST $SIM/orders/collection?personId=205930014&amount=100&collectionNumber=QA-C-COL14` | მიღებულია |
| 2 | იგივე call | `code: 11` |
| 3 | `...&collectionNumber=QA-C-COL14B&revAccount=999999999` | `code: 24` |
| 4 | `GET .../restrictions?personId=205930014` | მხოლოდ QA-C-COL14 |

---

## შეჯამება

| | ყადაღა (Lien) | ინკასო (Collection) |
|---|---|---|
| რას აკეთებს | **ყინავს** | ყინავს → **რიცხავს სახაზინოში** |
| როდის მთავრდება | მხოლოდ RS მოხსნის (`obtain-lien`) | EXECUTED / RETURNED / RS მოხსნა / REPLACED |
| დრო | ნებისმიერ დროს | გადარიცხვა: სამუშაო დღე 15:00–16:45 |
| თანხა | ფიქსირებული | RS აზუსტებს გადახდის დღეს |
| დუბლიკატი ნომერი | code 21 | code 11 |

### RS item code-ები (`$SIM` პასუხის `items[].code`)

| Code | ნიშნავს |
|---|---|
| `null` | მიღებულია |
| 1 | გადასახადის გადამხდელი ვერ მოიძებნა |
| 4 | ხელმოწერა არასწორია (მთელი შეტყობინება უარყოფილია) |
| 11 | ინკასოს ნომერი უკვე არსებობს |
| 13 | ღია ანგარიში არ აქვს |
| 14 | უკვე რეგისტრირებულია (NewClient-ზე = დადასტურება) |
| 18 | ინკასოს თანხა ტექსტში |
| 21 | ყადაღის ნომერი უკვე არსებობს |
| 23 | გადარიცხვა ჩავარდა (ჩვენ ვუგზავნით RS-ს) |
| 24 | უცნობი/არააქტიური სახაზინო კოდი |

### Postman-ით ახლავე (hub კლიენტით, დროის შეზღუდვის გარეშე)
HLD-02 · HLD-04 · HLD-05 · HLD-07 · HLD-08 · HLD-09 · **HLD-10** · HLD-11 · COL-01 · COL-02 (7017 ნაწილი) · **COL-11** · COL-12 · COL-13 · COL-14

### საჭიროებს
- `X-RS-Simulator-Token` — ყველა `$SIM` call-ისთვის (დეველოპერი)
- 15:00–16:45 სამუშაო დღე — COL-02 (შიგნით), 03, 04, 05, 06, 07, 08, 10
- `$WALLET` ხელმოწერა ან SQL — merchant-ის held/available (HLD-01, 03, 06, 12, 13)
- დეველოპერი — ბანკის გადარიცხვის აფეილება (COL-08), merchant-ის წაშლა (HLD-13)
