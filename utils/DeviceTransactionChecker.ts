import { APIRequestContext } from '@playwright/test';
import { AuthDevicePage } from '../pages/AuthDevicePage';

/**
 * Device Transaction Checker
 * იუზერის ტრანზაქციების შემოწმება (device authentication)
 */
export class DeviceTransactionChecker {
  constructor(private request: APIRequestContext) {}

  /**
   * იუზერის ტრანზაქციების წამოღება
   * @param page - გვერდის ნომერი (default: 0)
   * @param limit - რაოდენობა (default: 20)
   */
  async getTransactions(
    page: number = 0,
    limit: number = 10
  ): Promise<any[]> {
    // Device authentication
    const authDevice = new AuthDevicePage(this.request);
    const accessToken = await authDevice.authenticate();

    // ტრანზაქციების წამოღება
    const response = await this.request.post(
      `https://gateway.dev.keepz.me/payment-service/api/v1/generic-transaction/filter?page=${page}&limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          sentOrReceived: 'ALL',
          senderInfo: '',
          recipientInfo: ''
        }
      }
    );

    const data = await response.json();
    return data.value?.transactionsPage?.content || [];
  }

  /**
   * კონკრეტული ტრანზაქციის მოძებნა (მაგალითად receiver IBAN-ით)
   * @param receiverIban - მიმღების IBAN
   * @param waitSeconds - დაყოვნება წამოღებამდე (default: 10)
   */
  async findTransactionByIban(
    receiverIban: string,
    waitSeconds: number = 10
  ): Promise<any | null> {
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    const transactions = await this.getTransactions();
    return transactions.find((t: any) => t.receiverIban === receiverIban) || null;
  }

  /**
   * ბოლო ტრანზაქციის მიღება
   */
  async getLatestTransaction(): Promise<any | null> {
    const transactions = await this.getTransactions(0, 1);
    return transactions[0] || null;
  }
}
