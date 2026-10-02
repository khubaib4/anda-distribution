/** Show integer paisa exactly in print, including very large safe amounts. */
export function formatPdfPKR(paisa: number): string {
  if (!Number.isFinite(paisa) || !Number.isInteger(paisa)) return 'Rs. —'
  const amount = BigInt(Math.abs(paisa))
  const fraction = amount % BigInt(100)
  return 'Rs. ' + (paisa < 0 ? '-' : '') + (amount / BigInt(100)).toLocaleString('en-IN')
    + (fraction === BigInt(0) ? '' : '.' + String(fraction).padStart(2, '0'))
}
