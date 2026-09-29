export const BUSINESS_TIME_ZONE = 'Asia/Karachi'

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Calendar dates represent business days, not UTC timestamps.
export function businessDateString(at: Date = new Date()): string {
  const parts = businessDateFormatter.formatToParts(at)
  const value = (type: 'year' | 'month' | 'day') =>
    parts.find(part => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

// Move a YYYY-MM-DD calendar date without using the host machine's timezone.
export function shiftCalendarDate(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function calendarDaysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`)
  const to = Date.parse(`${toDate}T00:00:00Z`)
  return Math.round((to - from) / 86_400_000)
}
