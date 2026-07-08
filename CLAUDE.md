# Keepz eCommerce - Playwright Testing

**Project:** Automated testing for Keepz eCommerce API integration  
**Base URL:** `https://gateway.keepz.me/ecommerce-service/api/integrator`

---

## Overview

Playwright-based test framework for Keepz eCommerce payment orders with 4 integrator types:
- **Default — REQUEST** - Multiple orders per receiver (shopping cart)
- **Default — CHECK** - Single order per receiver (checkout page, overwrites)
- **Treasury** - Government/treasury payments
- **Traffic Fine** - Traffic fine payments

---

## Testing Rules

### ⚠️ CRITICAL RULES - MUST FOLLOW

#### 1. **Never Add Unapproved Parameters**
- **NEVER** add new parameters to helpers/functions without explicit user request
- **ONLY** use parameters documented in:
  - Official API documentation
  - OpenAPI spec (`postman/api-docs.json`)
  - User's explicit instructions
- If unsure about a parameter → **ASK first, do NOT assume**

**Example of WRONG approach:**
```typescript
// ❌ NEVER do this - adding enableTIP without user asking
interface Config {
  amount: number;
  enableTIP?: boolean;  // ← NOT asked for!
  tipAmount?: number;   // ← NOT in API docs!
}
```

#### 2. **Always Confirm Before Deleting**
- When user says "delete X", **FIRST** check if X is important/used
- If X is critical or used elsewhere → **TELL USER & EXPLAIN WHY**
- Do NOT blindly agree to delete everything
- Ask "Are you sure? This is used in Y and Z"

**Example:**
```
User: "Delete TIPPaymentHelper"
✅ CORRECT: "Wait! TIPPaymentHelper is used in all-methods-automation.spec.ts 
            for TIP Payment test. Deleting it will break that test.

#### 3. **REUSE EXISTING CODE - Don't Reinvent the Wheel**

**CRITICAL RULE:** When implementing similar functionality with different credentials/endpoints but **SAME FLOW** → **COPY existing code and modify endpoints ONLY**.

**Applies to ALL code:**
- Helpers
- Authentication
- API calls
- Test flows
- Any logic that already exists somewhere

**Process:**
1. ✅ **Search first** - Does similar code exist? (use Grep, file browser)
2. ✅ **Read completely** - Understand the existing flow
3. ✅ **Copy as base** - Don't start from scratch
4. ✅ **Modify only what's different**:
   - API endpoints
   - Credentials/auth method
   - Parameter names
5. ✅ **Keep same flow/structure** - Don't change the logic

**Example:**
```
User: "Create device user refund with same flow as admin refund"

✅ CORRECT:
1. Read RefundAdmin.ts
2. Copy entire file → RefundDevice.ts
3. Change ONLY:
   - AuthPage → AuthDevicePage
   - Admin API endpoint → Device API endpoint
4. Keep same flow: auth once → token passed everywhere
Result: 5 minutes ✅

❌ WRONG:
1. Create new logic from scratch
2. Different authentication pattern
3. Multiple auth calls instead of one
4. Different flow/structure
Result: 30 minutes wasted, bugs, inconsistent code ❌
```

**Why this matters:**
- ⏱️ **Saves massive time** (5 min vs 30+ min)
- ✅ **Consistent codebase** - same patterns everywhere
- 🐛 **Fewer bugs** - reusing proven code
- 🔧 **Easier maintenance** - familiar structure

**Red flags (means you're doing it wrong):**
- Creating new helper when similar one exists
- Different authentication pattern than existing code
- Calling auth multiple times when existing code calls once
- More complex than the existing solution 
            Should I still delete it?"

❌ WRONG: "OK, deleted!" (blindly following instruction)
```

#### 4. **ALWAYS Check Documentation Before Creating ANY Order Type**

**CRITICAL RULE:** When user says "create [ANY ORDER TYPE]" → **FIRST go to documentation and check what parameters THAT SPECIFIC order type needs!**

**This applies to ALL order types:**
- Treasury orders
- Traffic Fine orders
- DEFAULT-REQUEST orders
- DEFAULT-CHECK orders
- Split Payment orders
- TIP Payment orders
- Open Banking orders
- **ANY other order type!**

**Process:**
1. ✅ **User asks:** "Create [X] order helper" (X = Treasury, Traffic Fine, Split, etc.)
2. ✅ **FIRST:** Read official API docs: https://www.developers.keepz.me/eCommerece%20integration/create-an-order
3. ✅ **Find [X] order section** - check what parameters that specific type needs
4. ✅ **Use ONLY documented parameters** - don't copy from other order types
5. ✅ **Create helper with correct parameters for THAT order type**

**Example:**
```
User: "Create Treasury order helper"

✅ CORRECT:
1. Read docs for Treasury order type
2. Find Treasury-specific parameters (may have different fields than DEFAULT!)
3. Create helper with ONLY Treasury documented parameters
4. Test with documented Treasury example

❌ WRONG:
1. Copy DefaultOrderHelper
2. Assume Treasury = same as Default
3. Use Default parameters for Treasury
4. Create helper that fails or uses wrong parameters
```

**Example 2:**
```
User: "Create Traffic Fine order helper"

✅ CORRECT:
1. Read docs for Traffic Fine order type
2. Find Traffic Fine-specific parameters
3. Create helper with ONLY Traffic Fine parameters
4. Don't assume it's same as Treasury or Default

❌ WRONG:
1. Copy Treasury helper
2. Assume all order types are the same
3. Miss Traffic Fine-specific required fields
```

**Why this matters:**
- 📚 **Each order type has different requirements** - don't assume they're the same!
- ✅ **Documentation shows exact parameters per type** - use it!
- 🎯 **Treasury ≠ Default ≠ Traffic Fine** - each has unique fields
- ⚡ **One implementation, no debugging** - correct from start

**Documentation locations:**
- Official: https://www.developers.keepz.me/eCommerece%20integration/create-an-order
- Local: `API.md`
- OpenAPI spec: `postman/api-docs.json`

---

### Console Output
- ✅ Log only essential info: Order Created, Payment URL, Browser status
- ❌ NO step-by-step progress logs, decorative lines, verbose instructions

### Code Structure
- Use **Page Objects** pattern (`pages/` directory)
- Authentication logic → `AuthPage.ts`
- Payment logic → `PaymentPage.ts`
- Remove intermediate console logs from Page Objects
- Only log final results in test files

### Test Execution
- **Hybrid Mode**: API requests via Playwright + Real Chrome for 3DS
- **CRITICAL**: ALWAYS open payment URLs in REAL Chrome using `execAsync`
- **NEVER** use Playwright browser (`page.goto`) - TBC/BOG block it
- No waiting for manual payment completion
- Tests should complete immediately after opening browser

---

## Error Handling Standard (API Tests)

**⚠️ CRITICAL:** ყველა API ტესტმა უნდა გამოიყენოს საერთო assertion helper — `utils/assertions.ts`.

### წესები

1. **არ გამოიყენო Playwright-ის default assertion-ები** API ველების შესამოწმებლად
   (მაგ. `expect(x).toEqual([])` → აგდებს გაუგებარ `Expected [] / Received ["report"]`).
2. **ყოველი ჩავარდნისას** გამოჩნდეს ადამიანისთვის გასაგები შეტყობინება, სადაც წერია:
   - 🔧 რომელი **API / ოპერაცია** ჩაიჭრა
   - ⚠️ კონკრეტულად რომელი **ველი აკლია** ან რა **ვერ დაემთხვა**
   - ✅ რა იყო **მოსალოდნელი**
   - 📥 რა **მოვიდა რეალურად** (ლამაზად ფორმატირებული JSON)
3. **ყველა ტესტმა ერთი და იგივე ფორმატი** გამოიყენოს — არ დაადუბლირო კოდი, გამოიყენე `utils/assertions.ts`.

### Helper-ები (`utils/assertions.ts`)

| ფუნქცია | რას ამოწმებს |
|---|---|
| `assertKeysPresent(operation, actual, expectedKeys)` | ყველა key არსებობს object-ში |
| `assertField(operation, actual, field, expected)` | კონკრეტული ველი ემთხვევა მოსალოდნელს |
| `assertCondition(operation, condition, problem, expected, actual)` | ზოგადი პირობა |

### გამოყენების მაგალითი

```typescript
import { assertKeysPresent, assertField } from '../../utils/assertions';

const OP = 'GET /order/status';

// ყველა key უნდა არსებობდეს
assertKeysPresent(OP, status, ['integratorOrderId', 'status', 'transactionId']);

// status უნდა იყოს SUCCESS
assertField(OP, status, 'status', 'SUCCESS');
```

### ჩავარდნის output-ის მაგალითი

```
❌ API TEST FAILED
───────────────────────────────────────────
🔧 ოპერაცია:    GET /order/status
⚠️  პრობლემა:    აკლია ველ(ებ)ი: transactionId
✅ მოსალოდნელი: ყველა ველი უნდა არსებობდეს: integratorOrderId, status, transactionId
📥 მოვიდა:
{
  "integratorOrderId": "...",
  "status": "SUCCESS"
}
───────────────────────────────────────────
```

ეს შეტყობინება ჩანს **console-შიც** და **Playwright report-შიც** (`docs/report/`).

---

## Order Types Quick Reference

| Type | Multiple Orders? | Use Case |
|------|------------------|----------|
| **DEFAULT-REQUEST** | ✅ Yes (unlimited) | E-commerce cart |
| **DEFAULT-CHECK** | ❌ No (overwrites) | Single checkout |
| **TREASURY** | ✅ Yes | Government payments |
| **TRAFFIC_FINE** | ✅ Yes | Traffic fines |

**Key Difference:**
- **REQUEST** type: ახალი ორდერი **ემატება** არსებულებს
- **CHECK** type: ახალი ორდერი **გადაეწერება** ძველს

---

## Saved Card Flow (Card Token)

**დამახსოვრებული ბარათით (saved card) გადახდა + card token-ის წამოღება.**

- **Helper:** `utils/order-helpers/SavedCardHelper.ts`
- **Spec:** `tests/Positive/saved-card.spec.ts`

### Flow
1. **ორდერის შექმნა** — DEFAULT integrator, დამატებით `saveCard: true` + `directLinkProvider: "CREDO"`
   (`createPaymentOrder`-ს ორივე უკვე აქვს optional პარამეტრად).
2. **გადახდა** — ჩვეულებრივი card-fill + OTP flow (TBC/BOG), success გვერდი იხურება `closePaymentSuccess`-ით.
3. **Card token-ის წამოღება** — `PaymentPage.getCardToken(accessToken, integratorId, integratorOrderId)`:
   - **encrypt body:** `{ integratorOrderId, integratorId }` (returnCheckDetails **არ** არის)
   - **endpoint:** `GET /ecommerce-service/api/v1/integrator/card/order-id`
   - პატერნი: `encryptAES` → GET (`identifier`, `encryptedData`, `encryptedKeys`, `aes`) → `decryptAES`
   - იგივე encrypt→GET→decrypt პატერნია რაც `getOrderStatus` (მხოლოდ endpoint + body განსხვავდება).
   - დაბრუნდება ბარათის მონაცემები, token-ის ჩათვლით.

---

## Token Payment Flow (Recurring / Saved Card Token)

**დამახსოვრებული ბარათის card token-ით გადახდა (browser/OTP ეტაპ 2-ს არ სჭირდება).**

- **Helper:** `utils/order-helpers/TokenPaymentHelper.ts`
- **Spec:** `tests/Positive/token-payment.spec.ts`
- **Page Object:** `PaymentPage.createTokenPayment(accessToken, { amount, receiverId, receiverType, integratorId, cardToken })`

### Flow (2 ეტაპი)
1. **ეტაპი 1 — card token-ის მიღება (REUSE):** `SavedCardHelper.createPayAndGetCardToken(...)` — ბარათს ვიმახსოვრებთ და card token-ს ვიღებთ (ეს ეტაპი browser + OTP-ს საჭიროებს). token ამოღება: `cardToken / token / id`.
2. **ეტაპი 2 — token-ით გადახდა:** `PaymentPage.createTokenPayment` — `encryptOrderData` → `createOrder` → `decryptData`.
   - **inner body:** `{ amount, receiverId, receiverType, integratorId, integratorOrderId, cardToken }` (`cardToken` — documented optional ველი).
   - ⚠️ **მთავარი განსხვავება:** payment link (`urlForQR`) **არ ბრუნდება** — გადახდა მაშინვე ხდება. ამიტომ `decryptPaymentUrl`-ის ნაცვლად გამოიყენება `decryptData` (generic), რომელიც აბრუნებს payment result-ს. browser/card-fill ეტაპ 2-ს არ სჭირდება.

---

## Documentation

📁 **Detailed Documentation:**
- [API Reference](API.md) - Full API endpoints, parameters, validation
- [Examples](EXAMPLES.md) - Use case examples, code snippets

📚 **Create an order:**
- [Official API Docs](https://www.developers.keepz.me/eCommerece%20integration/create-an-order)

---

## Project Structure

```
Admin - Playwright/
├── CLAUDE.md                    # This file - project overview & rules
├── docs/
│   ├── API.md                   # Complete API documentation
│   └── EXAMPLES.md              # Use case examples
├── config/
│   └── orders.config.ts         # Order types & credentials structure
├── pages/
│   ├── AuthPage.ts              # Authentication logic
│   └── PaymentPage.ts           # Payment/order logic
└── tests/
    └── payment-flow.spec.ts     # Test scenarios
```

---

## Quick Start

```bash
# Run payment flow test
npx playwright test tests/payment-flow.spec.ts
```

---

*For implementation details, see [API.md](API.md)*
