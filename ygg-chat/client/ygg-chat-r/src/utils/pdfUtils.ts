import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'

// Set worker source relative to the public folder or use a CDN as a fallback
// For Vite, we can trying importing via ?url if available, but a reliable method without extra config
// is often pointing to a CDN or a manually copied worker.
// Using unpkg for simplicity to match the installed version.
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${'5.4.449'}/build/pdf.worker.min.mjs`

interface PdfTextItem {
  str?: string
  transform?: number[]
  height?: number
}

const buildLineAwareText = (items: PdfTextItem[]): string => {
  const lines: { y: number; text: string }[] = []

  for (const item of items) {
    const text = item.str?.replace(/\s+/g, ' ')?.trim()
    if (!text) continue

    const y = typeof item.transform?.[5] === 'number' ? item.transform[5] : 0
    const heightEstimate = item.height ?? 0
    const threshold = Math.max(6, heightEstimate * 0.5, 4)

    const lastLine = lines[lines.length - 1]
    if (!lastLine || Math.abs(lastLine.y - y) > threshold) {
      lines.push({ y, text })
      continue
    }

    const separator = lastLine.text.endsWith('-') ? '' : ' '
    lastLine.text += `${separator}${text}`
    lastLine.y = (lastLine.y + y) / 2
  }

  return lines
    .map(line => line.text.trim())
    .filter(Boolean)
    .join('\n')
}

export async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise

    let fullText = ''

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = buildLineAwareText(textContent.items as PdfTextItem[])

      if (pageText) {
        fullText += pageText + '\n\n'
      }
    }

    return fullText.trim()
  } catch (error) {
    console.error('Error extracting text from PDF:', error)
    throw new Error('Failed to extract text from PDF')
  }
}
