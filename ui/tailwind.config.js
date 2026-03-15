/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cc: '#3B82F6',
        usdcx: '#10B981',
        cbtc: '#F59E0B',
      },
    },
  },
  plugins: [],
};
