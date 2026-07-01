# Order Creation Examples

Quick code examples for each order type.

---

## 1. Basic Order (DEFAULT-REQUEST)

```typescript
{
  amount: 0.1,
  receiverId: "db1bb73d-30cf-4718-ad2b-bc25cd13b09c",
  receiverType: "BRANCH",
  integratorId: "76880b28-9033-4d48-b21f-37a9a36ec5dd",
  integratorOrderId: crypto.randomUUID()
}
```

---

## 2. Treasury Payment

```typescript
{
  amount: 0.1,
  orderProperties: {
    PURPOSE: { value: "გადასახადის გადახდა", isEditable: false },
    PERSONAL_NUMBER: { value: "61001234567", isEditable: true },
    PAYER_NAME: { value: "გიორგი გიორგაძე", isEditable: true },
    IS_FOREIGN: { value: "false", isEditable: false }
  },
  receiverId: "uuid",
  receiverType: "BRANCH",
  integratorId: "uuid",
  integratorOrderId: crypto.randomUUID()
}
```

---

## 3. Traffic Fine

```typescript
{
  amount: 0.1,
  orderProperties: {
    SERVICE_PROVIDER_CODE: { value: "PATROL", isEditable: false },
    SERVICE_CODE: { value: "PATROL", isEditable: false },
    ENTITY_IDENTIFIER: { value: "01024012345", isEditable: true },
    CAR_IDENTIFIER: { value: "TT123TT", isEditable: true }
  },
  receiverId: "uuid",
  receiverType: "BRANCH",
  integratorId: "uuid",
  integratorOrderId: crypto.randomUUID()
}
```

---

## 4. Save Card

```typescript
{
  amount: 0.1,
  saveCard: true,
  directLinkProvider: "CREDO",
  receiverId: "uuid",
  receiverType: "BRANCH",
  integratorId: "uuid",
  integratorOrderId: crypto.randomUUID()
}
```

---

## 5. Subscription

```typescript
{
  amount: 0,  // MUST be 0
  saveCard: true,
  subscriptionPlan: {
    interval: "MONTHLY",
    intervalCount: 1,
    amount: 10,
    startDate: "2026-06-20T00:00:00",
    callbackUrl: "https://yourapi.com/callback"
  },
  receiverId: "uuid",
  receiverType: "BRANCH",
  integratorId: "uuid",
  integratorOrderId: crypto.randomUUID()
}
```

---

## 5. Split Order Payment

**Split payments between multiple receivers (BRANCH + IBAN):**

```typescript
{
  amount: 1.0,
  integratorId: "76880b28-9033-4d48-b21f-37a9a36ec5dd",
  splitDetails: [
    {
      receiverType: "BRANCH",
      receiverIdentifier: "db1bb73d-30cf-4718-ad2b-bc25cd13b09c",
      amount: 0.5
    },
    {
      receiverType: "IBAN",
      receiverIdentifier: "GE62BG0000000610917722",
      amount: 0.5
    }
  ]
}
```

**IMPORTANT:**
- Use `splitDetails` (NOT splitOrders)
- Use `receiverIdentifier` (NOT receiverId)
- DO NOT include top-level `receiverId` when using splitDetails
- Total amount must equal sum of split amounts
- Supported receiverTypes: BRANCH, IBAN

---

## 6. Split Payment

```typescript
{
  amount: 0.1,
  splitDetails: [
    { receiverType: "BRANCH", receiverIdentifier: "uuid-1", amount: 75 },
    { receiverType: "IBAN", receiverIdentifier: "GE34BG...", amount: 25 }
  ],
  receiverId: "uuid",
  receiverType: "BRANCH",
  integratorId: "uuid",
  integratorOrderId: crypto.randomUUID()
}
```

---

## 7. Installment (CREDO)

```typescript
{
  amount: 0.1,
  installmentPaymentProvider: "CREDO",
  personalNumber: "01024012345",  // MANDATORY
  isForeign: false,               // MANDATORY
  receiverId: "uuid",
  receiverType: "BRANCH",
  integratorId: "uuid",
  integratorOrderId: crypto.randomUUID()
}
```

---

## Playwright Test

```typescript
import { test } from '@playwright/test';
import { AuthPage } from '../pages/AuthPage';
import { PaymentPage } from '../pages/PaymentPage';

test('Create order', async ({ request }) => {
  const authPage = new AuthPage(request);
  const paymentPage = new PaymentPage(request, null as any);

  const accessToken = await authPage.authenticate();

  const paymentUrl = await paymentPage.createPaymentOrder(accessToken, {
    amount: 0.1,
    receiverId: 'db1bb73d-30cf-4718-ad2b-bc25cd13b09c',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
    validUntil: '2026-12-30 14:40:23',
  });

  console.log('✅ Order Created');
  console.log('🔗 Payment URL:', paymentUrl);
});
```
