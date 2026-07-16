import { APIRequestContext } from '@playwright/test';
import { AdminAuthPage } from '../pages/AdminAuthPage';

/**
 * Transaction Checker
 * ელოდება 20 წამს და ამოწმებს ტრანზაქციის distributionStatus-ს
 */
export class TransactionChecker {
  constructor(private request: APIRequestContext) {}

  /**
   * ტრანზაქციის status-ის შემოწმება
   * @param receiverIban - მიმღების IBAN (მაგ: GE62BG0000000610917722)
   * @param waitSeconds - რამდენ წამს დაველოდოთ (default: 10)
   */
  async checkTransactionStatus(
    receiverIban: string,
    waitSeconds: number = 10
  ): Promise<{ status: string; distributionStatus: string; transactionId: number }> {
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    // ადმინის token-ის მიღება
    const adminAuth = new AdminAuthPage(this.request);
    const adminToken = await adminAuth.authenticate();

    // 1. ტრანზაქციების წამოღება
    let transaction = await this.getTransaction(adminToken, receiverIban);

    if (!transaction) {
      return { status: 'NOT_FOUND', distributionStatus: 'NOT_FOUND', transactionId: 0 };
    }

    const { id, status, distributionStatus } = transaction;

    // 2. თუ უკვე SUCCESS-ია → ეგ არის! ✅
    if (distributionStatus === 'SUCCESS') {
      return { status, distributionStatus, transactionId: id };
    }

    // 3. თუ WAITING_FOR_SIGNATURE → Update status
    if (distributionStatus === 'WAITING_FOR_SIGNATURE') {
      try {
        await this.updateTransactionStatus(adminToken, id);
        console.log('✅ Status update successful');
      } catch (error) {
        console.log('❌ Status update failed:', error);
        throw error;
      }

      // 4. ისევ წამოვიღოთ ტრანზაქცია
      transaction = await this.getTransaction(adminToken, receiverIban);

      if (transaction) {
        return {
          status: transaction.status,
          distributionStatus: transaction.distributionStatus,
          transactionId: id
        };
      }
    }

    // თუ სხვა status-ია
    return { status, distributionStatus, transactionId: id };
  }

  /**
   * Read-only: ტრანზაქციის მიმდინარე status-ის წამოღება უნიკალური initialAmount-ით.
   * (IBAN არ გამოდგება — pre-auth ტრანზაქცია ჯერ დაუდასტურებელია. სამაგიეროდ
   *  თითო pre-auth ტესტს უნიკალური თანხა აქვს, მაგ. 0.17, და ლისტში პირველივე
   *  დამთხვევა ჩვენი ახალი ტრანზაქციაა. side-effect-ს არ იწვევს — მხოლოდ ვკითხულობთ.)
   */
  async getStatusByAmount(
    amount: number,
    waitSeconds: number = 10
  ): Promise<{ status: string; distributionStatus: string; transactionId: number }> {
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    const adminAuth = new AdminAuthPage(this.request);
    const adminToken = await adminAuth.authenticate();

    const transaction = await this.getTransactionByAmount(adminToken, amount);

    if (!transaction) {
      return { status: 'NOT_FOUND', distributionStatus: 'NOT_FOUND', transactionId: 0 };
    }

    return {
      status: transaction.status,
      distributionStatus: transaction.distributionStatus,
      transactionId: transaction.id,
    };
  }

  /**
   * Read-only: ტრანზაქციის მიმდინარე status-ის წამოღება კონკრეტული ID-ით (side-effect-ის გარეშე).
   */
  async getStatusById(
    transactionId: number,
    waitSeconds: number = 10
  ): Promise<{ status: string; distributionStatus: string; transactionId: number; distributionAmount: number }> {
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    const adminAuth = new AdminAuthPage(this.request);
    const adminToken = await adminAuth.authenticate();

    const transaction = await this.getTransactionById(adminToken, transactionId);

    if (!transaction) {
      return { status: 'NOT_FOUND', distributionStatus: 'NOT_FOUND', transactionId, distributionAmount: 0 };
    }

    return {
      status: transaction.status,
      distributionStatus: transaction.distributionStatus,
      transactionId: transaction.id,
      distributionAmount: transaction.distributionAmount,
    };
  }

  /**
   * ტრანზაქციის „ხელმოწერა" ID-ით — ერთხელ ვუშვებთ update-status-ს (signature).
   */
  async signById(transactionId: number): Promise<void> {
    const adminAuth = new AdminAuthPage(this.request);
    const adminToken = await adminAuth.authenticate();
    await this.updateTransactionStatus(adminToken, transactionId);
  }

  /**
   * Split-ის მშობელი + ორივე შვილი ტრანზაქცია.
   * split order იქმნება როგორც მშობელი (`hasChildren: true`) + N შვილი,
   * სადაც შვილს აქვს `parentTransaction === parentId`. მშობელს ვპოულობთ initialAmount-ით
   * (ლისტში პირველივე hasChildren დამთხვევა — ჩვენი ახალი split).
   */
  async getSplitStatuses(
    expectedAmount: number,
    waitSeconds: number = 10
  ): Promise<{ parent: any; children: any[] }> {
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    const adminAuth = new AdminAuthPage(this.request);
    const adminToken = await adminAuth.authenticate();

    let parent: any;
    let children: any[] = [];

    // split-ი გადახდის მალევე: parent/children შეიძლება WAITING_FOR_SIGNATURE-ში იყოს.
    // WAITING_FOR_SIGNATURE-ს ვაწერთ ხელს (update-status); ვჩერდებით როცა აღარაა ხელმოსაწერი
    // (ყველა SUCCESS ან PENDING). PENDING მისაღებია — გადახდა შედგა, მუშავდება.
    for (let i = 0; i < 15; i++) {
      const transactionResponse = await this.request.post(
        'https://newadmin.dev.keepz.me/api/transaction/filter',
        {
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          data: {}
        }
      );

      const data = await transactionResponse.json();
      const all = data.value.content;

      parent = all.find((t: any) => t.hasChildren && t.initialAmount === expectedAmount);
      children = parent ? all.filter((t: any) => t.parentTransaction === parent.id) : [];

      const txs = [parent, ...children].filter(Boolean);

      // ყველა distributionStatus === SUCCESS → მზადაა
      if (txs.length > 0 && txs.every((t: any) => t.distributionStatus === 'SUCCESS')) break;

      // ყველა არა-SUCCESS ტრანზაქციას (PENDING / WAITING_FOR_SIGNATURE) update-status ვუშვებთ → SUCCESS
      for (const t of txs) {
        if (t.distributionStatus !== 'SUCCESS') {
          await this.updateTransactionStatus(adminToken, t.id);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return { parent, children };
  }

  /**
   * ტრანზაქციის წამოღება უნიკალური initialAmount-ით (ლისტში პირველივე დამთხვევა)
   */
  private async getTransactionByAmount(adminToken: string, amount: number): Promise<any> {
    const transactionResponse = await this.request.post(
      'https://newadmin.dev.keepz.me/api/transaction/filter',
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        data: {}
      }
    );

    const data = await transactionResponse.json();
    const transactions = data.value.content;

    return transactions.find((t: any) => t.initialAmount === amount);
  }

  /**
   * ტრანზაქციის წამოღება კონკრეტული ID-ით
   */
  private async getTransactionById(adminToken: string, transactionId: number): Promise<any> {
    const transactionResponse = await this.request.post(
      'https://newadmin.dev.keepz.me/api/transaction/filter',
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        data: {}
      }
    );

    const data = await transactionResponse.json();
    const transactions = data.value.content;

    return transactions.find((t: any) => t.id === transactionId);
  }

  /**
   * ტრანზაქციის წამოღება IBAN-ით
   */
  private async getTransaction(adminToken: string, receiverIban: string): Promise<any> {
    const transactionResponse = await this.request.post(
      'https://newadmin.dev.keepz.me/api/transaction/filter',
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        data: {}
      }
    );

    const data = await transactionResponse.json();
    const transactions = data.value.content;

    return transactions.find((t: any) => t.iban === receiverIban);
  }

  /**
   * ტრანზაქციის status-ის განახლება
   */
  private async updateTransactionStatus(adminToken: string, transactionId: number): Promise<void> {
    await this.request.put(
      `https://newadmin.dev.keepz.me/api/transaction/update-status?id=${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
  }
}
