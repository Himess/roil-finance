/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#059669',
          light: '#10B981',
        },
        surface: {
          DEFAULT: '#F3F4F9',
          card: '#FFFFFF',
          hover: '#EDEDF0',
          border: '#D6D9E3',
          muted: '#E8E8EC',
        },
        border: '#D6D9E3',
        ink: {
          DEFAULT: '#111827',
          secondary: '#6B7280',
          muted: '#9CA3AF',
          faint: '#C4C4C4',
        },
        accent: {
          DEFAULT: '#059669',
          hover: '#047857',
          light: '#E0F5EA',
          cyan: '#06B6D4',
          indigo: '#6366F1',
          amber: '#D97706',
          pink: '#EC4899',
          red: '#E11D48',
        },
        positive: '#16A34A',
        negative: '#DC2626',
        warning: '#D97706',
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
