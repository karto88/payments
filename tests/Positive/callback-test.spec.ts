import { test } from '@playwright/test';
import { CallbackOrderHelper } from '../../utils/order-helpers/CallbackOrderHelper';
import { WebhookSiteHelper } from '../../utils/WebhookSiteHelper';
import { AuthPage } from '../../pages/AuthPage';
import { INTEGRATORS } from '../../config/integrators.config';
import { assertKeysPresent, assertField, assertCondition } from '../../utils/assertions';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);
const OP_CALLBACK = 'Callback (webhook.site)';
const OP_DECRYPT = 'Decrypted Callback';

test.describe('Callback Test', () => {
  test('should send callback after successful payment', async ({ request }) => {
    // 1. ახალი webhook.site URL შექმნა
    const webhookHelper = new WebhookSiteHelper(request);
    const webhookUrl = await webhookHelper.createWebhook();

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📞 WEBHOOK URL:');
    console.log(`   ${webhookUrl}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // 2. გადახდა
    const paymentHelper = new CallbackOrderHelper(request);
    await paymentHelper.createAndPayOrder({
      amount: 0.1,
      receiverId: 'a1b9a5c5-9f01-42ee-a6e3-8853297caf49',
      receiverType: 'BRANCH',
      integratorId: '76880b28-9033-4d48-b21f-37a9a36ec5dd',
      callbackUri: webhookUrl,
      cardType: 'TBC',
    });

    console.log('✅ Payment completed');

    // 3. Callback-ის მოლოდინი (30 წამი) — გადახდა წარმატებული, callback უნდა მოვიდეს
    console.log('⏳ Waiting for callback...');
    let callback: { body: any; headers: any; receivedAt: string; method: string } | null = null;
    try {
      callback = await webhookHelper.waitForCallback(30);
    } catch {
      callback = null;
    }

    // ჩეკი: callback მოვიდა? (მთავარი merchant-ისთვის კრიტიკული ქეისი)
    assertCondition(
      OP_CALLBACK,
      callback !== null,
      'გადახდა წარმატებული იყო, მაგრამ callback არ მოვიდა 30 წამში',
      `callback უნდა მოსულიყო webhook.site-ზე (${webhookUrl})`,
      { hint: 'შეამოწმე: callbackUri სწორად გაიგზავნა? integrator-ს აქვს callback-ის უფლება? webhook.site ხელმისაწვდომია?' }
    );

    console.log('\n📋 ===== CALLBACK RECEIVED (ENCRYPTED) =====');
    console.log('🕐 Received At:', callback!.receivedAt);
    console.log('==================================\n');

    // 4. Callback უნდა იყოს encrypted (encryptedData + encryptedKeys)
    assertKeysPresent(OP_CALLBACK, callback!.body, ['encryptedData', 'encryptedKeys']);

    console.log('🔓 Decrypting callback...');

    // ავტორიზაცია გაშიფვრისთვის
    const authPage = new AuthPage(request);
    const accessToken = await authPage.authenticate();

    const decryptResponse = await request.post(
      'https://gateway.dev.keepz.me/payment-service/api/v1/test/decryptAES',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          encryptedData: callback.body.encryptedData,
          encryptedAESProperties: callback.body.encryptedKeys,
          privateKey: INTEGRATORS.DEFAULT.PRIVATE_KEY,
        },
      }
    );

    if (!decryptResponse.ok()) {
      const errorText = await decryptResponse.text();
      throw new Error(`Decryption failed: ${decryptResponse.status()} - ${errorText}`);
    }

    const decryptedData = await decryptResponse.json();
    const callbackPayload = JSON.parse(decryptedData.value);

    console.log('\n📋 ===== DECRYPTED CALLBACK =====');
    console.log('📦 Payload:', JSON.stringify(callbackPayload, null, 2));
    console.log('================================\n');

    // ვალიდაცია: გაშიფრულ callback-ს უნდა ჰქონდეს ეს key-ები + status SUCCESS
    assertKeysPresent(OP_DECRYPT, callbackPayload, ['integratorOrderId', 'status']);
    assertField(OP_DECRYPT, callbackPayload, 'status', 'SUCCESS');

    console.log('✅ Test PASSED: Callback decrypted and validated');

    // 7. HTML report შექმნა და ბრაუზერში გახსნა (გაშიფრული callback)
    const rows = Object.entries(callbackPayload)
      .map(([k, v]) => `<tr><td class="key">${k}</td><td class="val">${v}</td></tr>`)
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Callback Result</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; padding: 40px; }
    h1 { color: #3fb950; }
    .status { display: inline-block; background: #238636; color: #fff; padding: 4px 12px; border-radius: 6px; font-weight: 600; }
    table { border-collapse: collapse; margin-top: 20px; width: 100%; max-width: 700px; }
    td { padding: 12px 16px; border-bottom: 1px solid #30363d; }
    .key { color: #7d8590; font-weight: 600; width: 220px; }
    .val { color: #e6edf3; font-family: monospace; }
    .meta { color: #7d8590; margin-top: 24px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>✅ Callback Received</h1>
  <span class="status">${callbackPayload.status}</span>
  <table>${rows}</table>
  <p class="meta">🕐 Received: ${callback.receivedAt} &nbsp;|&nbsp; 🌐 ${webhookUrl}</p>
</body>
</html>`;

    // docs/ ფოლდერი GitHub Pages-ისთვის (test-results gitignored-ია)
    const reportDir = join(process.cwd(), 'docs');
    mkdirSync(reportDir, { recursive: true });
    const reportPath = join(reportDir, 'callback-result.html');
    writeFileSync(reportPath, html);

    console.log(`📄 Report saved: ${reportPath}`);
    console.log('💡 Share it: npm run share-report');
    await execAsync(`start chrome "${reportPath}"`);
  });
});
