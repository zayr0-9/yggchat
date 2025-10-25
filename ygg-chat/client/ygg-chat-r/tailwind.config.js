/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // optional: keep Inter alias
        inter: ['Inter', 'sans-serif'],
        // default sans will be DM Sans with sensible fallbacks
        sans: ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
        // optional: dedicated utility
        dm: ['"DM Sans"', 'sans-serif'],
      },
      screens: {
        // Standard Tailwind breakpoints (sm: 640px, md: 768px, lg: 1024px, xl: 1280px remain default)

        // Override default 2xl breakpoint to target Full HD only (1920 ≤ width < 2560)
        '2xl': { min: '1920px', max: '2559px' },

        // Extended breakpoints for larger displays using non-overlapping ranges
        '3xl': { min: '2560px', max: '3839px' },  // 2K/QHD displays (2560×1440)
        '4xl': { min: '3840px' },                // 4K/UHD displays (3840×2160)

        // Pixel density breakpoints to normalize high-DPI rendering
        // These detect physical pixel density, not viewport size
        'hidpi': { raw: '(min-resolution: 144dpi)' },
        'retina': { raw: '(-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi)' },
      },
      spacing: {
        // Custom spacing values to support existing usage
        // These map to the invalid classes currently in use
        '15': '60px',   // ml-15
        '35': '140px',  // mr-35
        '90': '360px',  // w-90 (sidebar width)
      },
      flex: {
        // Custom flex values to support existing usage
        '2': '2 2 0%',
        '4': '4 4 0%',
      },
    },
  },
  plugins: [],
}
