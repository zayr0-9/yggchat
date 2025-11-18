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
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;

  // Check environment variable defined in vite.config.ts
  // Note: We use a type assertion or loose check because Vite defines replace these at build time
  const isElectron = import.meta.env.VITE_ENVIRONMENT === 'electron' || 
                     (typeof process !== 'undefined' && process.env?.VITE_ENVIRONMENT === 'electron');

  if (isElectron) {
    // In Electron production, assets are relative to the index.html
    return cleanPath; // e.g., "img/logo.svg"
  }

  // In Web (development or production), use absolute paths from root
  return `/${cleanPath}`; // e.g., "/img/logo.svg"
};
