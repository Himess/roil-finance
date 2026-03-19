/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        surface: {
          DEFAULT: '#F5F5F7',
          card: '#FFFFFF',
          hover: '#EDEDF0',
          border: '#DDDDE2',
          muted: '#E8E8EC',
        },
        ink: {
          DEFAULT: '#1A1A1A',
          secondary: '#6B6B6B',
          muted: '#9B9B9B',
          faint: '#C4C4C4',
        },
        accent: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
          light: '#EFF6FF',
        },
        positive: '#16A34A',
        negative: '#DC2626',
        warning: '#D97706',
        cc: '#3B82F6',
        usdcx: '#10B981',
        cbtc: '#F59E0B',
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
        'dialog-in': 'dialogIn 0.2s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        dialogIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
