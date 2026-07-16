import { APIRequestContext } from '@playwright/test';

/**
 * Admin Authentication Page Object
 * ადმინის ავტორიზაცია (Pre-login → Login)
 */
export class AdminAuthPage {
  private baseUrl = 'https://newadmin.dev.keepz.me';

  constructor(private request: APIRequestContext) {}

  /**
   * Step 1: Pre-login
   */
  async preLogin(username: string, countryCode: string) {
    const response = await this.request.post(
      `${this.baseUrl}/api/auth/pre-login`,
      {
        data: {
          countryCode,
          username,
        },
      }
    );
    return response;
  }

  /**
   * Step 2: Login and get admin access token
   */
  async login(
    username: string,
    password: string,
    countryCode: string,
    deviceId: string
  ) {
    const response = await this.request.post(
      `${this.baseUrl}/api/auth/login`,
      {
        data: {
          countryCode,
          deviceId,
          loginType: 'PASSWORD',
          password,
          userType: 'ADMIN',
          username,
        },
      }
    );
    const data = await response.json();

    // ცხადი შეტყობინება login-ის ჩავარდნაზე (cryptic "undefined" error-ის ნაცვლად)
    if (!data.value || !data.value.accessToken) {
      throw new Error(
        `Admin login failed: ${data.message || 'no access token'} ` +
          `(statusCode: ${data.statusCode ?? response.status()}). შეამოწმე ADMIN_PASSWORD .env-ში.`
      );
    }

    return data.value.accessToken;
  }

  /**
   * Complete full admin authentication flow.
   * credentials .env-იდან (ADMIN_USERNAME/PASSWORD/COUNTRY_CODE/DEVICE_ID), fallback default-ებით.
   */
  async authenticate(
    username: string = process.env.ADMIN_USERNAME || '591078180',
    password: string = process.env.ADMIN_PASSWORD || 'Keepz@1234',
    countryCode: string = process.env.ADMIN_COUNTRY_CODE || '995',
    deviceId: string = process.env.ADMIN_DEVICE_ID || 'bf38e78b-95c7-4f39-8183-f095a1919fe2'
  ): Promise<string> {
    await this.preLogin(username, countryCode);
    const accessToken = await this.login(username, password, countryCode, deviceId);
    return accessToken;
  }
}
