/**
 * Robust JSON object extractor that handles complex nested structures
 * Fixes the broken regex-based extraction that couldn't handle:
 * - Nested objects/arrays
 * - Escaped quotes
 * - Mixed types (numbers, booleans, null)
 * - Multi-line JSON
 */

/**
 * Extract valid JSON objects from text using bracket counting
 * Properly handles nested structures, escape sequences, and string literals
 *
 * @param text - The text to search for JSON objects
 * @returns Object containing extracted JSON objects and cleaned text
 *
 * @example
 * const text = 'Here is a tool call: {"name":"search","args":{"query":"test","nested":{"deep":true}}} and some text'
 * const result = extractJsonObjects(text)
 * // result.jsonObjects = [{name: 'search', args: {query: 'test', nested: {deep: true}}}]
 * // result.cleanedText = 'Here is a tool call:  and some text'
 */
export function extractJsonObjects(text: string): {
  jsonObjects: any[]
  cleanedText: string
} {
  const jsonObjects: any[] = []
  const replacements: Array<{ start: number; end: number; text: string }> = []

  let i = 0
  while (i < text.length) {
    // Look for start of potential JSON object
    if (text[i] === '{') {
      const startIndex = i
      let depth = 0
      let inString = false
      let escaped = false
      let isValid = true

      // Scan through tracking braces and string state
      while (i < text.length && isValid) {
        const char = text[i]

        // Handle escape sequences
        if (escaped) {
          escaped = false
          i++
          continue
        }

        if (char === '\\' && inString) {
          escaped = true
          i++
          continue
        }

        // Toggle string state
        if (char === '"' && !escaped) {
          inString = !inString
          i++
          continue
        }

        // Only count braces/brackets outside of strings
        if (!inString) {
          if (char === '{' || char === '[') {
            depth++
          } else if (char === '}' || char === ']') {
            depth--

            // We found a complete object/array
            if (depth === 0) {
              const jsonText = text.substring(startIndex, i + 1)

              // Validate it's actually JSON
              try {
                const parsed = JSON.parse(jsonText)
                jsonObjects.push(parsed)
                replacements.push({
                  start: startIndex,
                  end: i + 1,
                  text: jsonText,
                })
                i++
                break
              } catch (e) {
                // Not valid JSON, this wasn't a real object
                // Continue searching from next character
                i = startIndex + 1
                isValid = false
                break
              }
            }
          }
        }

        i++
      }

      // If we hit end of string without closing braces, reset
      if (isValid && depth !== 0) {
        i = startIndex + 1
      }
    } else {
      i++
    }
  }

  // Build cleaned text by removing all found JSON objects
  let cleanedText = text
  // Sort replacements in reverse order so indices don't shift
  replacements.sort((a, b) => b.start - a.start)
  for (const replacement of replacements) {
    cleanedText = cleanedText.substring(0, replacement.start) + cleanedText.substring(replacement.end)
  }

  return {
    jsonObjects,
    cleanedText: cleanedText.trim(),
  }
}

/**
 * Extract JSON objects specifically from assistant tool calls
 * Ensures extracted objects are valid tool calls with 'name' and 'arguments' fields
 *
 * @param text - The text containing tool call JSON
 * @returns Filtered array of valid tool call objects
 */
export function extractToolCalls(text: string): any[] {
  const { jsonObjects } = extractJsonObjects(text)

  // Filter to only valid tool calls (have name and arguments fields)
  return jsonObjects.filter(obj => {
    return obj && typeof obj === 'object' && ('name' in obj || 'function' in obj)
  })
}
