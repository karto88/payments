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
    const accessToken = data.value.accessToken;
    return accessToken;
  }

  /**
   * Complete full admin authentication flow
   */
  async authenticate(
    username: string = '591078180',
    password: string = 'Keepz1234',
    countryCode: string = '995',
    deviceId: string = 'bf38e78b-95c7-4f39-8183-f095a1919fe2'
  ): Promise<string> {
    await this.preLogin(username, countryCode);
    const accessToken = await this.login(username, password, countryCode, deviceId);
    return accessToken;
  }
}
