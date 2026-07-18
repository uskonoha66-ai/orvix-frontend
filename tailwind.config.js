/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: {
          primary: '#050b14',
          secondary: '#0b1f3a',
        },
        accent: {
          navy: '#133c74',
          cyan: '#5cceff',
        },
        border: {
          DEFAULT: 'rgba(92,206,255,0.12)',
          hover: 'rgba(92,206,255,0.24)',
        },
        hover: 'rgba(92,206,255,0.08)',
        success: '#23d18b',
        warning: '#ffc857',
        error: '#ff5d73',
        text: {
          primary: '#ffffff',
          secondary: 'rgba(255,255,255,0.72)',
          muted: 'rgba(255,255,255,0.40)',
        },
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '18px',
      },
      boxShadow: {
        soft: '0 4px 24px rgba(0,0,0,0.32)',
        card: '0 2px 16px rgba(0,0,0,0.24)',
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite linear',
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 220ms ease-out',
        'scale-in': 'scaleIn 180ms ease-out',
        float: 'float 6s ease-in-out infinite',
        pulse: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        spin: 'spin 1s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
    },
  },
  plugins: [],
};
