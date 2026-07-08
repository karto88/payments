/**
 * API ტესტების Error Handling სტანდარტი.
 *
 * ყველა API ტესტმა უნდა გამოიყენოს ეს helper-ები assertion-ებისთვის.
 * Playwright-ის სტანდარტული "Expected [] / Received [...]" ნაცვლად,
 * გამოაქვს ადამიანისთვის გასაგები შეტყობინება:
 *   - რომელი ოპერაცია/API ჩაიჭრა
 *   - კონკრეტულად რა აკლია / რა ვერ დაემთხვა
 *   - რა იყო მოსალოდნელი
 *   - რა მოვიდა რეალურად (ლამაზად ფორმატირებული JSON)
 */

/** ლამაზად ფორმატირებული JSON */
function pretty(value: any): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** საერთო error შეტყობინების ფორმატი */
function buildError(
  params: {
    operation: string;
    problem: string;
    expected: string;
    actual: any;
  },
  stackRef: Function
): Error {
  const message = [
    '',
    '❌ API TEST FAILED',
    '───────────────────────────────────────────',
    `🔧 ოპერაცია:    ${params.operation}`,
    `⚠️  პრობლემა:    ${params.problem}`,
    `📥 მიმდინარე შედეგი:`,
    pretty(params.actual),
    `✅ მოსალოდნელი შედეგი: ${params.expected}`,
    '───────────────────────────────────────────',
    '',
  ].join('\n');

  const error = new Error(message);
  error.name = 'ApiAssertionError';

  // helper-ის შიდა ხაზები დავმალოთ — stack პირდაპირ ტესტზე მიუთითებს
  if (typeof (Error as any).captureStackTrace === 'function') {
    (Error as any).captureStackTrace(error, stackRef);
  }

  return error;
}

/**
 * ამოწმებს რომ ყველა მოსალოდნელი key არსებობს object-ში.
 * @param operation - რომელი ოპერაცია/API (მაგ. "GET /order/status")
 * @param actual - რეალურად მოსული object
 * @param expectedKeys - key-ების სია რომელიც უნდა არსებობდეს
 */
export function assertKeysPresent(operation: string, actual: any, expectedKeys: string[]): void {
  const missing = expectedKeys.filter((k) => !(actual && k in actual));

  if (missing.length > 0) {
    throw buildError({
      operation,
      problem: `აკლია ველ(ებ)ი: ${missing.join(', ')}`,
      expected: `ყველა ველი უნდა არსებობდეს: ${expectedKeys.join(', ')}`,
      actual,
    }, assertKeysPresent);
  }
}

/**
 * ამოწმებს რომ კონკრეტული ველი ემთხვევა მოსალოდნელ მნიშვნელობას.
 * @param operation - რომელი ოპერაცია/API
 * @param actual - რეალურად მოსული object
 * @param field - ველის სახელი
 * @param expected - მოსალოდნელი მნიშვნელობა
 */
export function assertField(operation: string, actual: any, field: string, expected: any): void {
  const got = actual?.[field];

  if (got !== expected) {
    throw buildError({
      operation,
      problem: `ველი "${field}" ვერ დაემთხვა (მოვიდა: ${got})`,
      expected: `${field} = ${expected}`,
      actual,
    }, assertField);
  }
}

/**
 * ზოგადი პირობის შემოწმება.
 * @param operation - რომელი ოპერაცია/API
 * @param condition - პირობა (true = წარმატება)
 * @param problem - რა არის პრობლემა თუ ჩაიჭრა
 * @param expected - რა იყო მოსალოდნელი
 * @param actual - რა მოვიდა რეალურად
 */
export function assertCondition(
  operation: string,
  condition: boolean,
  problem: string,
  expected: string,
  actual: any
): void {
  if (!condition) {
    throw buildError({ operation, problem, expected, actual }, assertCondition);
  }
}
