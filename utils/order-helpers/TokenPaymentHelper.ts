import { APIRequestContext } from '@playwright/test';
import { AuthPage } from '../../pages/AuthPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { SavedCardHelper } from './SavedCardHelper';

type CardType = 'TBC' | 'BOG';

interface TokenPaymentConfig {
  amount: number;
  receiverId: string;
  receiverType?: string;
  integratorId: string;
  /** ბარათის ტიპი ეტაპ 1-ისთვის (token-ის მისაღებად) */
  cardType: CardType;
}

/**
 * Token (saved-card / recurring) payment flow — 2 ეტაპი:
 *
 *   ეტაპი 1 — card token-ის მიღება (REUSE: SavedCardHelper)
 *     ბარათს ვიმახსოვრებთ (saveCard + CREDO) და card token-ს ვიღებთ.
 *     ეს ეტაპი browser-ს/OTP-ს საჭიროებს.
 *
 *   ეტაპი 2 — token-ით გადახდა (PaymentPage.createTokenPayment)
 *     encrypt → createOrder → decryptData. body-ში cardToken.
 *     payment link (urlForQR) არ ბრუნდება — გადახდა მაშინვე ხდება,
 *     browser/card-fill არ არის.
 */
export class TokenPaymentHelper {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async payWithSavedCard(config: TokenPaymentConfig) {
    // ეტაპი 1 — card token-ის მიღება (REUSE)
    const savedCardHelper = new SavedCardHelper(this.request);
    const cardData = await savedCardHelper.createPayAndGetCardToken({
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      cardType: config.cardType,
    });

    // token-ის ამოღება (cardToken / token / id)
    const cardToken: string | undefined =
      cardData?.cardToken ?? cardData?.token ?? cardData?.id;

    if (!cardToken) {
      throw new Error(
        `Card token ვერ მოიძებნა ეტაპ 1-ის პასუხში: ${JSON.stringify(cardData)}`
      );
    }

    console.log(`✅ Card Token: ${cardToken}`);

    // ეტაპი 2 — token-ით გადახდა (browser არ სჭირდება)
    const authPage = new AuthPage(this.request);
    const paymentPage = new PaymentPage(this.request, null as any);

    const accessToken = await authPage.authenticate();

    const { result, integratorOrderId } = await paymentPage.createTokenPayment(accessToken, {
      amount: config.amount,
      receiverId: config.receiverId,
      receiverType: config.receiverType,
      integratorId: config.integratorId,
      cardToken,
    });

    console.log(`✅ Token Payment Order Created: ${integratorOrderId}`);

    return { result, integratorOrderId, cardToken };
  }
}
