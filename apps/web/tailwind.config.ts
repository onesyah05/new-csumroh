import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'] },
      boxShadow: { soft: '0 12px 40px rgba(0,0,0,.06)', lift: '0 18px 50px rgba(0,0,0,.10)' },
      animation: { 'fade-up': 'fadeUp .35s ease-out both', 'slide-in': 'slideIn .28s ease-out both' },
      keyframes: {
        fadeUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(10px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
      },
    },
  },
  plugins: [],
} satisfies Config;
