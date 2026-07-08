# eCommerce API Reference

**Base URL:** `https://gateway.keepz.me/ecommerce-service/api/integrator`

---

## Order Types

| Type | Multiple Orders? | Overwrites? | Use Case |
|------|------------------|-------------|----------|
| DEFAULT-REQUEST | ✅ Yes | ❌ No | Shopping cart |
| DEFAULT-CHECK | ❌ No | ✅ Yes | Single checkout |
| TREASURY | ✅ Yes | ❌ No | Government payments |
| TRAFFIC_FINE | ✅ Yes | ❌ No | Traffic fines |

**Key Difference:**
- **REQUEST**: ახალი ორდერი **ემატება**
- **CHECK**: ახალი ორდერი **გადაეწერება** ძველს

---

## orderProperties by Type

### DEFAULT (REQUEST/CHECK)
```typescript
INVOICE_NUMBER_LABEL: { value: "Invoice", isEditable: false }
DESCRIPTION: { value: "Desc", isEditable: true }
INTEGRATOR_PRODUCT_NAME: { value: "Product", isEditable: false }  // Hidden
```

### TREASURY (All Mandatory)
```typescript
PURPOSE: { value: "გადახდის დანიშნულება", isEditable: false }
PERSONAL_NUMBER: { value: "61001234567", isEditable: true }
PAYER_NAME: { value: "გიორგი გიორგაძე", isEditable: true }
IS_FOREIGN: { value: "false", isEditable: false }
```

### TRAFFIC_FINE (All Mandatory)
```typescript
SERVICE_PROVIDER_CODE: { value: "PATROL", isEditable: false }  // Hidden
SERVICE_CODE: { value: "PATROL", isEditable: false }           // Hidden
ENTITY_IDENTIFIER: { value: "TEST123", isEditable: true }      // Visible
CAR_IDENTIFIER: { value: "TT000TT", isEditable: true }        // Visible
```

---

## Endpoints

### Create Order
```
POST /api/integrator/order
```

**Outer Request:**
```json
{
  "identifier": "uuid",
  "encryptedData": "...",
  "encryptedKeys": "...",
  "aes": true
}
```

**Inner Payload (Required):**
- `amount` (number) - must be >0 (subscriptions: 0)
- `receiverId` (UUID)
- `receiverType` ("BRANCH")
- `integratorId` (UUID)
- `integratorOrderId` (UUID) - unique

**Optional Fields:**
- `directLinkProvider` - BOG | TBC | CREDO | DEFAULT
- `openBankingLinkProvider` - TBC | BOG | CREDO | LB
- `installmentPaymentProvider` - CREDO (requires `personalNumber`, `isForeign`)
- `saveCard` (boolean)
- `cardToken` (UUID)
- `splitDetails` (array)
- `subscriptionPlan` (object - requires `amount: 0`, `saveCard: true`)
- `currency`, `language`, `commissionType`
- `successRedirectUri`, `failRedirectUri`, `callbackUri`
- `validUntil`
- `orderProperties` (object)

**Response (Decrypted):**
```json
{
  "integratorOrderId": "uuid",
  "urlForQR": "https://tiny.keepz.me/xxxxx"
}
```

---

### Get Status
```
GET /api/integrator/order/status?integratorOrderId={uuid}
```

**Statuses:**
INITIAL, PROCESSING, SUCCESS, FAILED, CANCELED, EXPIRED, WAITING_FOR_CONSENT, REFUND_REQUESTED, REFUNDED_BY_*

---

### Cancel Order
```
DELETE /api/integrator/order/cancel
```
Allowed: INITIAL, PROCESSING only

---

### Refund
```
POST /api/integrator/order/refund/v2
```
Allowed: SUCCESS, PARTIALLY_REFUNDED, REFUNDED_FAILED

---

## Validation Rules

| Field | Rule |
|-------|------|
| amount | >0 (except subscriptions) |
| personalNumber | 9 or 11 digits |
| UUIDs | Valid v4 format |
| installment | Requires `personalNumber` + `isForeign` |
| subscription | Requires `amount: 0` + `saveCard: true` |

---

## Encryption

1. Generate AES key + IV
2. Encrypt payload → `encryptedData`
3. Encrypt key+IV with RSA public → `encryptedKeys`
4. Send both
5. Server responds encrypted
6. Decrypt with RSA private → get AES key
7. Decrypt payload → get `urlForQR`

---

**Examples:** [EXAMPLES.md](EXAMPLES.md)
