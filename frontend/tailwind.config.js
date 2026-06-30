/** @type {import('tailwindcss').Config} */
const themeData = require('./tailwind.theme.json');

module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: themeData.theme.extend,
  },
  plugins: [],
}
