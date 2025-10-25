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
        // Override default 2xl breakpoint for proper 1080p detection
        '2xl': '1920px',  // Full HD / 1080p displays (overrides Tailwind's default 1536px)

        // Extended breakpoints for larger displays
        '3xl': '2560px',  // 2K displays at standard scaling
        '4xl': '3840px',  // 4K displays at standard scaling

        // Pixel density breakpoints to normalize high-DPI rendering
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
