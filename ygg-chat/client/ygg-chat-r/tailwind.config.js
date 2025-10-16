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
    },
  },
  plugins: [],
}
