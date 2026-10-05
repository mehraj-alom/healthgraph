/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Page theme is locked dark. No section flips theme mid-page.
        stage: '#08090D',
        // Elevated solid surface (phone mocks, mobile menu).
        panel: '#15161B',
        // Secondary text gray (Apple dark-mode secondary).
        fog: '#86868B',
        // Primary text, a touch softer than pure white.
        ink: '#F5F5F7',
        // The single accent, locked page-wide: pulse waves, live badges,
        // focus rings, the highlighted pricing tier border.
        teal: { DEFAULT: '#4FD1C5', deep: '#2E8B7E' },
        // Deep cobalt for premium depth: CTA gradients, header hairlines,
        // glow fields. Teal stays the signal color; cobalt is the room.
        cobalt: { DEFAULT: '#3B5BFF', deep: '#1B2AA0', abyss: '#0A1030' },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'Helvetica Neue',
          'Segoe UI',
          'Roboto',
          'Arial',
          'sans-serif',
        ],
      },
      // Shape rule: buttons and inputs are pill, cards use this radius.
      borderRadius: {
        card: '20px',
      },
    },
  },
  plugins: [],
};
