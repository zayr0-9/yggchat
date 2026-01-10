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

  // Use document.baseURI which handles appropriate relative resolution
  // for both Web (http://...) and Electron (file://.../index.html)
  // causing assets to be resolved relative to the application root/current file.
  try {
    return new URL(cleanPath, document.baseURI).href
  } catch (e) {
    // Fallback if something goes wrong (e.g. testing environment without window)
    return path
  }
}
