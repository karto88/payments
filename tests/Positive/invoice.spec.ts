import { test } from '@playwright/test';
import { InvoiceHelper } from '../../utils/order-helpers';
import * as dotenv from 'dotenv';

dotenv.config();

// ქვითრის ჩეკი — გადახდის success გვერდზე QR modal-ის ჩახურვა + ქვითრის გადმოწერა (ახალი ტაბი)
test('Invoice Check', async ({ request }) => {
  test.setTimeout(180000);
  const helper = new InvoiceHelper(request);

  await helper.createPayAndDownloadInvoice({
    amount: 0.1,
    receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
    receiverType: 'BRANCH',
    integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
  });
});
