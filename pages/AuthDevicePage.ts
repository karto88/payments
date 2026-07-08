import { APIRequestContext } from '@playwright/test';

/**
 * Device Authentication Page Object
 * დივაისის ავტორიზაციის ლოგიკა (Check → Send SMS → Verify → Login)
 */
export class AuthDevicePage {
  private baseUrl = 'https://gateway.dev.keepz.me';

  constructor(private request: APIRequestContext) {}

  /**
   * Step 1: Check phone
   */
  async checkPhone(phone: string, countryCode: string) {
    const response = await this.request.post(
      `${this.baseUrl}/common-service/api/v1/auth/check`,
      {
        data: {
          phone: `${countryCode}${phone}`,
          phoneNumberDetails: {
            phoneNumber: phone,
            countryCode: countryCode,
          },
        },
      }
    );
    return response;
  }

  /**
   * Step 2: Send SMS
   */
  async sendSMS(phone: string, countryCode: string, otphash: string = 'RDNhQrdwYdh') {
    const response = await this.request.post(
      `${this.baseUrl}/common-service/api/v1/auth/send-sms`,
      {
        data: {
          phone: phone,
          countryCode: countryCode,
          otphash: otphash,
          smsType: 'LOGIN',
          phoneNumberDetails: {
            phoneNumber: phone,
            countryCode: countryCode,
          },
        },
      }
    );
    return response;
  }

  /**
   * Step 3: Verify SMS
   */
  async verifySMS(phone: string, countryCode: string, code: string) {
    const response = await this.request.post(
      `${this.baseUrl}/common-service/api/v1/auth/verify-sms`,
      {
        data: {
          code: code,
          countryCode: countryCode,
          phone: phone,
        },
      }
    );
    const data = await response.json();
    const userSMSId = data.value;
    return userSMSId;
  }

  /**
   * Step 4: Login and get access token
   */
  async login(userSMSId: string, phone: string, countryCode: string) {
    const response = await this.request.post(
      `${this.baseUrl}/common-service/api/v1/auth/login`,
      {
        data: {
          deviceToken: 'eDMH6TX9QO2ZV9sauxlAH5:APA91bGwyldltXIt78XrF5LydNorhEZ9FdlqlJsqMC4Kbf2RuHP2nbW1M9cLlNX4RJwhk1nqGGOc7yBdQdgliV1eeqWZyEC6_dDY3EsinX-plZGD-Nb694E',
          mobileName: 'Pixel 5',
          mobileOS: 'ANDROID',
          userSMSId: userSMSId,
          userType: 'BUSINESS',
          mobileNumber: `${countryCode}${phone}`,
        },
      }
    );
    const data = await response.json();
    const accessToken = data.value.access_token;
    return accessToken;
  }

  /**
   * Complete full device authentication flow
   */
  async authenticate(
    phone: string = '591078180',
    countryCode: string = '995',
    smsCode: string = '111111'
  ): Promise<string> {
    await this.checkPhone(phone, countryCode);
    await this.sendSMS(phone, countryCode);
    const userSMSId = await this.verifySMS(phone, countryCode, smsCode);
    const accessToken = await this.login(userSMSId, phone, countryCode);
    return accessToken;
  }
}
