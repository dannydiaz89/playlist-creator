/* Design tokens — single source of truth.
   Mirrors the "Design System" section of implementation_plan.md.
   Port this object straight into tailwind.config.ts when scaffolding the app. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        canvas:  '#f8fafc', // slate-50
        ink:     '#0f172a', // slate-900
        muted:   '#64748b', // slate-500
        rule:    '#e2e8f0', // slate-200
        accent:  { DEFAULT: '#4f46e5', hover: '#4338ca' }, // indigo-600/700
        ok:      '#059669', // emerald-600
        warn:    '#b45309', // amber-700  (AA on amber-50)
        bad:     '#e11d48', // rose-600
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { lg: '0.5rem', xl: '0.75rem' },
    },
  },
};
