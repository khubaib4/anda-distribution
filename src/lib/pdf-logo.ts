import type { jsPDF } from 'jspdf'

const LOGO_TOP_Y_MM = 10
const MAX_LOGO_HEIGHT_MM = 25
const MAX_LOGO_WIDTH_MM = 60
const LOGO_DIVIDER_GAP_MM = 5

export interface PdfBrandedHeaderLayout {
  dividerY: number
  rightY:   number
}

function computeLogoDimensions(
  imgWidth: number,
  imgHeight: number,
): { width: number; height: number } {
  const maxHeight = MAX_LOGO_HEIGHT_MM
  const maxWidth = MAX_LOGO_WIDTH_MM

  let logoH = maxHeight
  let logoW = (imgWidth / imgHeight) * logoH

  if (logoW > maxWidth) {
    logoW = maxWidth
    logoH = (imgHeight / imgWidth) * logoW
  }

  return { width: logoW, height: logoH }
}

export async function loadLogoImageData(
  logoUrl: string,
): Promise<{ data: string; width: number; height: number } | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = logoUrl

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load logo'))
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(img, 0, 0)
    return {
      data:   canvas.toDataURL('image/png'),
      width:  img.width,
      height: img.height,
    }
  } catch {
    return null
  }
}

export async function drawPdfBrandedHeader(
  doc: jsPDF,
  opts: {
    margin:    number
    pageWidth: number
    y:         number
    logoUrl?:  string | null
    title:     string
    subtitle?: string
  },
): Promise<PdfBrandedHeaderLayout> {
  const { margin, y, logoUrl, title, subtitle } = opts

  if (logoUrl) {
    const logo = await loadLogoImageData(logoUrl)
    if (logo) {
      const { width: logoW, height: logoH } = computeLogoDimensions(
        logo.width,
        logo.height,
      )
      doc.addImage(logo.data, 'PNG', margin, LOGO_TOP_Y_MM, logoW, logoH)
      return {
        dividerY: LOGO_TOP_Y_MM + logoH + LOGO_DIVIDER_GAP_MM,
        rightY:   LOGO_TOP_Y_MM + logoH / 2,
      }
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(title, margin, y)

  if (subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(subtitle, margin, y + 8)
  }

  return {
    dividerY: y + 22,
    rightY:   y,
  }
}

export function drawPdfHeaderRight(
  doc: jsPDF,
  pageWidth: number,
  margin: number,
  centerY: number,
  lines: string[],
): void {
  const lineSpacing = 8
  const blockHeight = (lines.length - 1) * lineSpacing
  const startY = centerY - blockHeight / 2

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  lines.forEach((line, index) => {
    doc.text(line, pageWidth - margin, startY + index * lineSpacing, {
      align: 'right',
    })
  })
}
