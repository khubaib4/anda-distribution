const EGGS_PER_TRAY = 30
const WHOLE_EGG_TOLERANCE = 1e-9

export function isPositiveWholeEggCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Convert a tray quantity to a physically whole number of eggs. */
export function wholeEggsFromTrays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  const eggs = value * EGGS_PER_TRAY
  const wholeEggs = Math.round(eggs)
  if (
    !Number.isSafeInteger(wholeEggs) ||
    wholeEggs <= 0 ||
    Math.abs(eggs - wholeEggs) > WHOLE_EGG_TOLERANCE
  ) {
    return null
  }

  return wholeEggs
}

/** Sale and purchase item quantities use whole trays in the current UI and ledger. */
export function wholeEggsFromWholeTrays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return null
  }

  return wholeEggsFromTrays(value)
}
