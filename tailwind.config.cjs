/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif']
      },
      colors: {
        surface: {
          primary: '#0a0a0a',
          secondary: '#141414',
          tertiary: '#1e1e1e',
          border: '#222222'
        },
        // Verification outcomes — used by the proxy list and status pills.
        verdict: {
          pass: '#22c55e',
          warn: '#eab308',
          fail: '#ef4444',
          unknown: '#6b7280'
        }
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px'
      },
      fontSize: {
        xxs: ['0.625rem', { lineHeight: '0.875rem' }]
      }
    }
  },
  plugins: []
}
