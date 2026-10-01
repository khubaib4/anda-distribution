// Use the decimal value sent in JSON, just as PostgreSQL NUMERIC does. Multiplying
// decimal money as a JavaScript float can move a half-paisa below the midpoint.
export function decimalRatio(value: number): { numerator: bigint; denominator: bigint } {
  const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e')
  const [whole, fraction = ''] = coefficient.split('.')
  const scale = fraction.length - Number(exponent)
  const digits = BigInt(whole + fraction)
  return scale >= 0
    ? { numerator: digits, denominator: BigInt(10) ** BigInt(scale) }
    : { numerator: digits * BigInt(10) ** BigInt(-scale), denominator: BigInt(1) }
}

/** Round nonnegative integer ratios halfway up, matching PostgreSQL money rules. */
export function roundMoneyRatio(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator + (numerator % denominator * BigInt(2) >= denominator ? BigInt(1) : BigInt(0))
}
