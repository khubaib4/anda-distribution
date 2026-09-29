/** Format integer paisa for PDFs without hiding non-zero paisa. */
export function formatPdfPKR(paisa: number): string {
  const absolutePaisa = Math.abs(paisa)
  const wholeRupees = Math.trunc(absolutePaisa / 100)
  const remainingPaisa = absolutePaisa % 100
  const sign = paisa < 0 ? '-' : ''
  const fraction = remainingPaisa === 0
    ? ''
    : '.' + String(remainingPaisa).padStart(2, '0')

  return 'Rs. ' + sign + wholeRupees.toLocaleString('en-IN') + fraction
}
