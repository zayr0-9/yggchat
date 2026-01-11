/**
 * Helper utility to handle asset paths correctly across Web and Electron environments.
 *
 * In Electron (with base: './'), assets should be referenced without a leading slash
 * to be resolved relative to the HTML file.
 *
 * In Web, absolute paths (starting with /) are preferred to ensure they resolve to the public root
 * regardless of the current route depth.
 */
export const getAssetPath = (path: string): string => {
  // Clean path: ensure it doesn't start with / for processing
  const cleanPath = path.startsWith('/') ? path.slice(1) : path

  // Branch by protocol: file:// needs relative resolution; http(s) should use base URL.
  if (typeof window !== 'undefined') {
    const protocol = window.location?.protocol

    if (protocol === 'file:') {
      try {
        return new URL(cleanPath, document.baseURI).href
      } catch (e) {
        return cleanPath
      }
    }

    const base = import.meta.env.BASE_URL || '/'
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return new URL(cleanPath, base).href
    }

    const normalizedBase = base.endsWith('/') ? base : `${base}/`
    return `${normalizedBase}${cleanPath}`
  }

  const fallbackBase = import.meta.env?.BASE_URL || '/'
  const normalizedFallback = fallbackBase.endsWith('/') ? fallbackBase : `${fallbackBase}/`
  return `${normalizedFallback}${cleanPath}`
}
