import { Page, APIRequestContext } from '@playwright/test';

/**
 * Payment Page Object
 * გადახდის შექმნის ლოგიკა (Encrypt → Create Order → Decrypt)
 */
export class PaymentPage {
  private baseUrl = 'https://gateway.dev.keepz.me';

  // Default configuration
  private readonly PUBLIC_KEY =
    'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAyl8vLmSz+d0Q5Ubmdwbcy42Smhg4NDRcvQ7hsLqdmg1Lb82qDFbnfQr6psGDP2cNIEhA/HO+1XqJ9xADTLfIfd+nL9uQ00qukCDMItnohPDeV3DCjKJu948O2yhr3KfyGwWd6CQGpmj5TjbLw4OgOaiXMxP3VM3h3+VW0kdK3x4sB8NO/6hRQc+lhGzlPzD13vb6f2nVmEmd1TfIU6Gj25xzDe9WFj/JwnbYV4lZdKPrgfpHOYAlhdGn3CLfnJAX5G0R/MpZ467GQYQnt1dtYxyK7DHTcK09oAHFr+Tk6frB1GDuqUepo7Owq94M4sHwPt4I7kxH4t4oYwGVqhm5ve+bshUPe4coDWWS70deT4YhaGBdPyCOB6wnFQpARHMmh5ASdT24g5203l+dxrvxuJ6kLY2CvRfzRMECIXBZcB6OcDOtrYy5yBMHUtWEIOeCLppuHvmrvhe2yOZssj1pRqRBQXZ4FfplCgS9yWu1UR0OT/NWCZcODrsA33y9JtYbb+F/GthN3DKORWC+YeD56AVXC1lfm9nwkRQhXtPwTSQR1ALkUzUq9bbBShnto/wOYatQ+Pc8Iy0YlRhvVH7sZif+P4hf+ih8SNvBjs2sBemZ22t5q3pkZOMj1T73PCd9hJyESeUjvM8BMOv+irgeHwn9kHuzXyge0AQgBCh6IRUCAwEAAQ==';

  private readonly PRIVATE_KEY =
    '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';

  constructor(
    private request: APIRequestContext,
    private page: Page
  ) {}

  /**
   * Step 1: Encrypt order data
   */
  async encryptOrderData(accessToken: string, orderData: any) {
    const response = await this.request.post(
      `${this.baseUrl}/payment-service/api/v1/test/encryptAES`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          data: orderData,
          publicKey: this.PUBLIC_KEY,
        },
      }
    );

    if (!response.ok()) {
      const errorBody = await response.text();
      throw new Error(`Encryption failed: ${response.status()} - ${errorBody}`);
    }

    const encryptData = await response.json();
    return encryptData.value;
  }

  /**
   * Step 2: Create order
   */
  async createOrder(
    encryptedData: string,
    encryptedKeys: string,
    integratorId: string,
    path: string = '/ecommerce-service/api/integrator/order'
  ) {
    const response = await this.request.post(
      `${this.baseUrl}${path}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          identifier: integratorId,
          encryptedData,
          aes: true,
          encryptedKeys,
        },
      }
    );

    if (!response.ok()) {
      const errorBody = await response.text();

      // Try to parse error response
      let errorJson;
      try {
        errorJson = JSON.parse(errorBody);
      } catch (parseError) {
        // If not JSON, throw original error
        throw new Error(`Order creation failed: ${response.status()} - ${errorBody}`);
      }

      // Handle specific error codes
      if (errorJson.statusCode === 2219) {
        console.log('\n❌ Permission Error:');
        console.log('   This integrator does not have permission for directLinkProvider');
        console.log('   Use basic order (without directLinkProvider) or request permission from Keepz\n');
        throw new Error('Permission denied: directLinkProvider not allowed');
      }

      // Other errors
      console.log(`\n❌ Error ${errorJson.statusCode}: ${errorJson.message}\n`);
      throw new Error(`Order failed: ${errorJson.message}`);
    }

    const orderData = await response.json();
    return orderData;
  }

  /**
   * Step 3: Decrypt to get payment URL
   */
  async decryptPaymentUrl(accessToken: string, encryptedData: string, encryptedKeys: string) {
    const response = await this.request.post(
      `${this.baseUrl}/payment-service/api/v1/test/decryptAES`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          encryptedAESProperties: encryptedKeys,
          encryptedData: encryptedData,
          privateKey: this.PRIVATE_KEY,
        },
      }
    );

    if (!response.ok()) {
      const errorBody = await response.text();
      throw new Error(`Decryption failed: ${response.status()} - ${errorBody}`);
    }

    const decryptData = await response.json();
    const innerJson = JSON.parse(decryptData.value);
    const paymentUrl = innerJson.urlForQR;

    return paymentUrl;
  }

  /**
   * Generic decrypt (returns parsed JSON object)
   */
  async decryptData(accessToken: string, encryptedData: string, encryptedKeys: string) {
    const response = await this.request.post(
      `${this.baseUrl}/payment-service/api/v1/test/decryptAES`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          encryptedAESProperties: encryptedKeys,
          encryptedData: encryptedData,
          privateKey: this.PRIVATE_KEY,
        },
      }
    );

    if (!response.ok()) {
      const errorBody = await response.text();
      throw new Error(`Decryption failed: ${response.status()} - ${errorBody}`);
    }

    const decryptData = await response.json();
    return JSON.parse(decryptData.value);
  }

  /**
   * Get order status (encrypt body → GET status → decrypt response)
   */
  async getOrderStatus(accessToken: string, integratorId: string, integratorOrderId: string) {
    // 1. Encrypt status request body (იგივე encryptAES რაც ორდერის შექმნაზე)
    const statusBody = {
      integratorId,
      integratorOrderId,
      returnCheckDetails: true,
    };
    const encrypted = await this.encryptOrderData(accessToken, statusBody);

    // 2. GET order/status — encrypted params (იგივე რაც createOrder-ის body)
    const response = await this.request.get(
      `${this.baseUrl}/ecommerce-service/api/integrator/order/status`,
      {
        params: {
          identifier: integratorId,
          encryptedData: encrypted.encryptedData,
          encryptedKeys: encrypted.encryptedKeys,
          aes: true,
        },
      }
    );

    if (!response.ok()) {
      const errorBody = await response.text();
      throw new Error(`Get status failed: ${response.status()} - ${errorBody}`);
    }

    // 3. Decrypt response (იგივე decryptAES body)
    const statusResult = await response.json();

    return await this.decryptData(accessToken, statusResult.encryptedData, statusResult.encryptedKeys);
  }

  /**
   * Get saved card token (encrypt body → GET card/order-id → decrypt response)
   * იგივე encrypt→GET→decrypt პატერნი რაც getOrderStatus,
   * ოღონდ card/order-id endpoint-ზე და encrypt body-ში returnCheckDetails არ არის.
   */
  async getCardToken(accessToken: string, integratorId: string, integratorOrderId: string) {
    // 1. Encrypt request body (returnCheckDetails არ სჭირდება)
    const cardBody = {
      integratorOrderId,
      integratorId,
    };
    const encrypted = await this.encryptOrderData(accessToken, cardBody);

    // 2. GET card/order-id — encrypted params
    const response = await this.request.get(
      `${this.baseUrl}/ecommerce-service/api/v1/integrator/card/order-id`,
      {
        params: {
          identifier: integratorId,
          encryptedData: encrypted.encryptedData,
          encryptedKeys: encrypted.encryptedKeys,
          aes: true,
        },
      }
    );

    if (!response.ok()) {
      const errorBody = await response.text();
      throw new Error(`Get card token failed: ${response.status()} - ${errorBody}`);
    }

    // 3. Decrypt response (იგივე decryptAES body)
    const cardResult = await response.json();

    return await this.decryptData(accessToken, cardResult.encryptedData, cardResult.encryptedKeys);
  }

  /**
   * Complete full payment flow
   */
  async createPaymentOrder(
    accessToken: string,
    orderConfig: {
      amount: number;
      receiverId?: string;
      receiverType?: string;
      integratorId: string;
      validUntil?: string;
      callbackUri?: string;
      successRedirectUri?: string;
      failRedirectUri?: string;
      directLinkProvider?: string;
      openBankingLinkProvider?: string;
      installmentPaymentProvider?: string;
      saveCard?: boolean;
      payWithPreAuth?: boolean;
      currency?: string; // ვალუტა (default GEL) — USD/EUR order-ისთვის
      orderProperties?: any;
      splitDetails?: Array<{
        receiverType: string;
        receiverIdentifier: string;
        amount: number;
      }>;
    }
  ): Promise<{ paymentUrl: string; integratorOrderId: string }> {
    const randomUuid = crypto.randomUUID();

    const orderData: any = {
      amount: orderConfig.amount,
      integratorId: orderConfig.integratorId,
      integratorOrderId: randomUuid,
    };

    // Add validUntil if provided
    if (orderConfig.validUntil) {
      orderData.validUntil = orderConfig.validUntil;
    }

    // Add callbackUri if provided
    if (orderConfig.callbackUri) {
      orderData.callbackUri = orderConfig.callbackUri;
    }

    // Add redirect URIs if provided
    if (orderConfig.successRedirectUri) {
      orderData.successRedirectUri = orderConfig.successRedirectUri;
    }
    if (orderConfig.failRedirectUri) {
      orderData.failRedirectUri = orderConfig.failRedirectUri;
    }

    // Add receiverId/receiverType (required for all orders)
    orderData.receiverId = orderConfig.receiverId || orderConfig.splitDetails?.[0]?.receiverIdentifier;
    orderData.receiverType = orderConfig.receiverType || orderConfig.splitDetails?.[0]?.receiverType || 'BRANCH';

    // ვალუტა (default GEL) — USD/EUR order-ისთვის სამივე ველი უნდა დაისეტოს
    if (orderConfig.currency) {
      orderData.currency = orderConfig.currency;
      orderData.acquiringCurrency = orderConfig.currency;
      orderData.distributionCurrency = orderConfig.currency;
    }

    // Add splitDetails if provided
    if (orderConfig.splitDetails) {
      orderData.splitDetails = orderConfig.splitDetails;
    }

    // Add optional fields
    if (orderConfig.directLinkProvider) {
      orderData.directLinkProvider = orderConfig.directLinkProvider;
    }
    if (orderConfig.openBankingLinkProvider) {
      orderData.openBankingLinkProvider = orderConfig.openBankingLinkProvider;
    }
    if (orderConfig.installmentPaymentProvider) {
      orderData.installmentPaymentProvider = orderConfig.installmentPaymentProvider;
    }
    if (orderConfig.saveCard !== undefined) {
      orderData.saveCard = orderConfig.saveCard;
    }
    if (orderConfig.payWithPreAuth !== undefined) {
      orderData.payWithPreAuth = orderConfig.payWithPreAuth;
    }

    // Add orderProperties (default or custom)
    orderData.orderProperties = orderConfig.orderProperties || {
      INVOICE_NUMBER_LABEL: {
        value: 'Invoice',
        isEditable: false,
      },
      DESCRIPTION: {
        value: 'Desc',
        isEditable: true,
      },
    };

    const encrypted = await this.encryptOrderData(accessToken, orderData);
    const order = await this.createOrder(
      encrypted.encryptedData,
      encrypted.encryptedKeys,
      orderConfig.integratorId
    );
    const paymentUrl = await this.decryptPaymentUrl(
      accessToken,
      order.encryptedData,
      order.encryptedKeys
    );

    return { paymentUrl, integratorOrderId: randomUuid };
  }

  /**
   * Token (saved-card / recurring) payment.
   * იგივე flow რაც createPaymentOrder-ს (encrypt → createOrder → decrypt),
   * ოღონდ body-ში cardToken და payment link (urlForQR) არ ბრუნდება —
   * გადახდა მაშინვე ხდება, ამიტომ decryptPaymentUrl-ის ნაცვლად decryptData გამოიყენება.
   */
  async createTokenPayment(
    accessToken: string,
    orderConfig: {
      amount: number;
      receiverId: string;
      receiverType?: string;
      integratorId: string;
      cardToken: string;
    }
  ): Promise<{ result: any; integratorOrderId: string }> {
    const randomUuid = crypto.randomUUID();

    const orderData = {
      amount: orderConfig.amount,
      receiverId: orderConfig.receiverId,
      receiverType: orderConfig.receiverType || 'BRANCH',
      integratorId: orderConfig.integratorId,
      integratorOrderId: randomUuid,
      cardToken: orderConfig.cardToken,
    };

    const encrypted = await this.encryptOrderData(accessToken, orderData);
    const order = await this.createOrder(
      encrypted.encryptedData,
      encrypted.encryptedKeys,
      orderConfig.integratorId
    );
    const result = await this.decryptData(
      accessToken,
      order.encryptedData,
      order.encryptedKeys
    );

    return { result, integratorOrderId: randomUuid };
  }

  /**
   * Pre-Authorization — ეტაპი 2: ორდერის დაქომფლითება (complete/capture).
   *
   * იგივე პატერნი რაც createPaymentOrder-ს (encrypt → createOrder → decrypt),
   * ოღონდ POST მიდის /order/complete endpoint-ზე და inner body-ში ეთითება
   * არსებული (გადახდილი) integratorOrderId + amount — რამდენი უნდა დაქომფლითდეს.
   * დანარჩენი (order amount − complete amount) გადამხდელს უბრუნდება.
   */
  async completePreAuthOrder(
    accessToken: string,
    completeConfig: {
      integratorId: string;
      integratorOrderId: string;
      amount: number;
    }
  ): Promise<any> {
    const orderData = {
      integratorId: completeConfig.integratorId,
      integratorOrderId: completeConfig.integratorOrderId,
      amount: completeConfig.amount,
    };

    const encrypted = await this.encryptOrderData(accessToken, orderData);
    const order = await this.createOrder(
      encrypted.encryptedData,
      encrypted.encryptedKeys,
      completeConfig.integratorId,
      '/ecommerce-service/api/integrator/order/complete'
    );
    const result = await this.decryptData(
      accessToken,
      order.encryptedData,
      order.encryptedKeys
    );

    return result;
  }
}
