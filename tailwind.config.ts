import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07090d', 900: '#0b0f16', 800: '#121823', 700: '#1b2330', 600: '#2a3444' },
        swarm: {
          50: '#eef6ff', 100: '#d9eaff', 200: '#bcdaff', 300: '#8ec2ff',
          400: '#59a0ff', 500: '#337dff', 600: '#1b5df5', 700: '#1449e1',
          800: '#173cb6', 900: '#19378f', 950: '#142357',
        },
        signal: { 400: '#4ade80', 500: '#22c55e', 600: '#16a34a' },
        warn: { 400: '#fbbf24', 500: '#f59e0b' },
        danger: { 400: '#f87171', 500: '#ef4444' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(9,15,30,0.14)',
        lift: '0 2px 4px rgba(0,0,0,0.04), 0 18px 44px -18px rgba(9,15,30,0.22)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-480px 0' }, '100%': { backgroundPosition: '480px 0' } },
      },
      animation: { 'fade-up': 'fade-up .32s ease-out both', shimmer: 'shimmer 1.4s linear infinite' },
    },
  },
  plugins: [],
} satisfies Config;
