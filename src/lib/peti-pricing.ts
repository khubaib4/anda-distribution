import { roundMoneyRatio } from './exact-money'
import { moneyInputToPaisa, moneyPaisaToInput } from './customer-account-money'

export interface PetiPricedItem {
  quantity_trays?: number
  quantity_peti?: number
  quantity_tray?: number
  price_per_tray_paisa: number
  // NULL means a historical tray-priced entry. Never guess its original peti rate.
  price_per_peti_paisa?: number | null
}

export function itemTrays(item: PetiPricedItem): number {
  return item.quantity_trays ?? (item.quantity_peti ?? 0) * 12 + (item.quantity_tray ?? 0)
}

/** A tray rate is compatibility/display metadata, never the basis of a peti-priced line. */
export function trayPriceFromPetiPaisa(petiPaisa: number): number {
  if (!Number.isSafeInteger(petiPaisa) || petiPaisa <= 0) return 0
  return Math.max(1, Number(roundMoneyRatio(BigInt(petiPaisa), BigInt(12))))
}

export function petiPriceInputPatch(input: string) {
  const price_per_peti_paisa = moneyInputToPaisa(input) ?? 0
  return { price_per_peti_paisa, price_per_tray_paisa: trayPriceFromPetiPaisa(price_per_peti_paisa) }
}

/** Round the whole line once, keeping complete peti prices exact. */
export function baseLineTotalPaisa(trays: number, trayPaisa: number, petiPaisa?: number | null): number {
  if (!Number.isSafeInteger(trays) || trays < 0 || !Number.isSafeInteger(trayPaisa) || trayPaisa < 0) return NaN
  if (petiPaisa != null && (!Number.isSafeInteger(petiPaisa) || petiPaisa < 0)) return NaN
  const total = petiPaisa == null
    ? BigInt(trays) * BigInt(trayPaisa)
    : roundMoneyRatio(BigInt(trays) * BigInt(petiPaisa), BigInt(12))
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : NaN
}

export function itemBaseLineTotalPaisa(item: PetiPricedItem): number {
  return baseLineTotalPaisa(itemTrays(item), item.price_per_tray_paisa, item.price_per_peti_paisa)
}

export function itemPetiPricePaisa(item: Pick<PetiPricedItem, 'price_per_tray_paisa' | 'price_per_peti_paisa'>): number {
  return item.price_per_peti_paisa ?? item.price_per_tray_paisa * 12
}

export function itemPetiPriceInput(item: Pick<PetiPricedItem, 'price_per_tray_paisa' | 'price_per_peti_paisa'>): string {
  const paisa = itemPetiPricePaisa(item)
  if (!paisa) return ''
  return moneyPaisaToInput(paisa)
}
