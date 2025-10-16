// server/src/utils/markdownStripper.ts
// Utilities to convert Markdown content into plain text.
// Primary path: use `strip-markdown` via unified/remark dynamically (ESM-friendly).
// Fallback path: a conservative regex-based stripper that preserves textual content.

/**
 * Strip Markdown formatting and return plain text.
 * Tries to use `strip-markdown` (with unified + remark-parse) if available; otherwise falls back to a regex stripper.
 */
export async function stripMarkdownToText(markdown: string): Promise<string> {
  const input = String(markdown ?? '')

  // Try dynamic ESM imports to support projects compiled as CJS.
  try {
    const [{ unified }, remarkParseMod, stripMod, remarkStringifyMod] = await Promise.all([
      import('unified') as Promise<any>,
      import('remark-parse') as Promise<any>,
      import('strip-markdown') as Promise<any>,
      import('remark-stringify') as Promise<any>,
    ])

    const remarkParse = remarkParseMod.default ?? remarkParseMod
    const strip = stripMod.default ?? stripMod
    const remarkStringify = remarkStringifyMod.default ?? remarkStringifyMod

    const file = await unified()
      .use(remarkParse)
      .use(strip)
      // stringify back to plain text (after strip, nodes are mostly text/paragraphs)
      .use(remarkStringify, {
        bullet: '-',
        fences: true,
        rule: '-',
        listItemIndent: 'one',
      })
      .process(input)

    const text = String(file)
    return normalizePlainText(text)
  } catch (_err) {
    // Fallback if unified/remark packages are not installed or ESM interop fails
    const text = fallbackStripMarkdown(input)
    return normalizePlainText(text)
  }
}

/**
 * A conservative regex-based Markdown stripper.
 * Preserves link/image alt text and code contents, removes formatting markers.
 */
export function fallbackStripMarkdown(md: string): string {
  let text = String(md ?? '')

  // Normalize newlines
  text = text.replace(/\r\n?/g, '\n')

  // Remove front matter blocks (--- ... ---)
  text = text.replace(/^---\n[\s\S]*?\n---\n/gm, '')

  // Fenced code blocks: keep inner content, drop backticks and language
  text = text.replace(/```[\t ]*([a-zA-Z0-9_+-]+)?\n([\s\S]*?)```/g, (_m, _lang, code) => code)

  // Inline code: `code` -> code
  text = text.replace(/`([^`]+)`/g, '$1')

  // Images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^\)]*\)/g, '$1')

  // Links: [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '$1')

  // Autolinks: <http://example.com> -> http://example.com
  text = text.replace(/<([a-z]+:\/\/[^>]+)>/gi, '$1')

  // Headers: remove leading hashes and trailing setext underlines
  text = text.replace(/^#{1,6}\s*/gm, '')
  text = text.replace(/^(.+)\n[=-]{2,}\s*$/gm, '$1')

  // Blockquotes: remove leading >
  text = text.replace(/^>\s?/gm, '')

  // Lists: remove bullets/ordered markers
  text = text.replace(/^\s*([-*+])\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')

  // Task list checkboxes: [ ] / [x]
  text = text.replace(/\[[ xX]\]\s+/g, '')

  // Emphasis and strong: *text*, **text**, _text_, __text__
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  // Strikethrough: ~~text~~ -> text
  text = text.replace(/~~([^~]+)~~/g, '$1')

  // Tables: drop alignment lines, replace pipes with single spaces
  text = text.replace(/^\|?\s*:?[-=]{2,}:?\s*(\|\s*:?[-=]{2,}:?\s*)+\|?\s*$/gm, '')
  text = text.replace(/\|/g, ' ')

  // HTML tags: strip
  text = text.replace(/<[^>]+>/g, '')

  // Horizontal rules
  text = text.replace(/^\s*([-*_]\s*?){3,}\s*$/gm, '')

  return text
}

/**
 * Normalize whitespace: collapse multiple blank lines, trim, and normalize spaces.
 */
function normalizePlainText(input: string): string {
  return input
    .replace(/[\t\x0B\f\r]+/g, ' ')
    .replace(/\u00A0/g, ' ') // non-breaking space -> space
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default stripMarkdownToText
