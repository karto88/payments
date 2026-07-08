import { APIRequestContext } from '@playwright/test';

interface WebhookToken {
  uuid: string;
  url: string;
}

interface WebhookRequest {
  content: string;
  created_at: string;
  headers: Record<string, string>;
  method: string;
}

export class WebhookSiteHelper {
  private request: APIRequestContext;
  private token?: WebhookToken;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * შექმნა ახალი webhook.site URL (ავტომატურად)
   */
  async createWebhook(): Promise<string> {
    const response = await this.request.post('https://webhook.site/token', {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok()) {
      throw new Error('Failed to create webhook.site token');
    }

    const data = await response.json();
    this.token = {
      uuid: data.uuid,
      url: `https://webhook.site/${data.uuid}`,
    };

    console.log(`🌐 Created webhook: ${this.token.url}`);
    return this.token.url;
  }

  /**
   * Callback-ების წამოღება
   */
  async getCallbacks(timeoutSeconds: number = 30): Promise<any[]> {
    if (!this.token) {
      throw new Error('Webhook not created! Call createWebhook() first.');
    }

    const startTime = Date.now();
    const maxTime = timeoutSeconds * 1000;

    while (Date.now() - startTime < maxTime) {
      const response = await this.request.get(
        `https://webhook.site/token/${this.token.uuid}/requests`,
        { headers: { 'Accept': 'application/json' } }
      );

      if (response.ok()) {
        const data = await response.json();
        // მხოლოდ POST request-ები (რეალური callback-ები, არა ბრაუზერის GET)
        const requests: WebhookRequest[] = (data.data || []).filter(
          (req: WebhookRequest) => req.method === 'POST'
        );

        if (requests.length > 0) {
          console.log(`✅ Found ${requests.length} callback(s)`);

          // Parse JSON content
          return requests.map((req: WebhookRequest) => {
            try {
              return {
                body: JSON.parse(req.content),
                headers: req.headers,
                receivedAt: req.created_at,
                method: req.method,
              };
            } catch {
              return {
                body: req.content,
                headers: req.headers,
                receivedAt: req.created_at,
                method: req.method,
              };
            }
          });
        }
      }

      console.log(`⏳ Waiting for callback... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 წამში შემოწმება
    }

    throw new Error(`Callback not received within ${timeoutSeconds} seconds`);
  }

  /**
   * პირველი callback-ის მიღება
   */
  async waitForCallback(timeoutSeconds: number = 30): Promise<any> {
    const callbacks = await this.getCallbacks(timeoutSeconds);
    return callbacks[0];
  }

}
