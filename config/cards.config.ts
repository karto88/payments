// ბარათების მონაცემები — მხოლოდ .env-იდან (⚠️ ნომერი / ვადა / CVV კოდში და git-ში არ უნდა იყოს)
import 'dotenv/config';

type Bank = 'TBC' | 'BOG' | 'LB' | 'CREDO';

/** CARD_<NAME>_NUMBER / _EXPIRY / _CVV — .env-ში; აკლია → გასაგები შეცდომა, როცა ტესტი ბარათს მიმართავს */
function card(name: string, bank: Bank) {
  const read = (field: 'NUMBER' | 'EXPIRY' | 'CVV') => {
    const key = `CARD_${name}_${field}`;
    const value = process.env[key];
    if (!value) throw new Error(`${key} არ არის .env-ში — ბარათის მონაცემები დაამატე (.env.example)`);
    return value;
  };
  return {
    get number() { return read('NUMBER'); },
    get expiry() { return read('EXPIRY'); },
    get cvv() { return read('CVV'); },
    bank,
  };
}

export const CARDS = {
  TBC: card('TBC', 'TBC'),
  BOG: card('BOG', 'BOG'),
  LIBERTY: card('LIBERTY', 'LB'),
  CREDO: card('CREDO', 'CREDO'),
};
