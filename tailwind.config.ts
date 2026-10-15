import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f8fafc',
        ink: '#0f172a',
        muted: '#64748b',
        rule: '#e2e8f0',
        accent: { DEFAULT: '#4f46e5', hover: '#4338ca' },
        ok: '#059669',
        warn: '#b45309',
        bad: '#e11d48',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { lg: '0.5rem', xl: '0.75rem' },
    },
  },
  plugins: [],
};
export default config;
