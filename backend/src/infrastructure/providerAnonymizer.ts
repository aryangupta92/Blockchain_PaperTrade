/**
 * RULE 1.2 Guardrail: Never reveal upstream market-data provider branding,
 * hostnames, or vendor error codes in user-facing messages, API responses, or logs.
 */

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bdhan(hq)?\b/gi,
  /api\.dhan\.co/gi,
  /auth\.dhan\.co/gi,
  /api-feed\.dhan\.co/gi,
  /depth-api-feed\.dhan\.co/gi,
  /images\.dhan\.co/gi,
  /\bDH-\d{3}\b/g,
  /\bupstox\b/gi,
  /\byahoo(\s+finance)?\b/gi,
];

export function sanitizeUserMessage(raw: string): string {
  let clean = raw;
  for (const pattern of FORBIDDEN_PATTERNS) {
    clean = clean.replace(pattern, 'market data service');
  }
  return clean;
}

export function containsProviderLeak(text: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
