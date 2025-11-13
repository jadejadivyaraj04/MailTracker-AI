/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f2f7ff',
          100: '#d9e7ff',
          200: '#b0ceff',
          300: '#81b0ff',
          400: '#4a8bff',
          500: '#1a73e8',
          600: '#0f5cc7',
          700: '#0d47a1',
          800: '#0f3578',
          900: '#0f2c5f'
        }
      }
    }
  },
  plugins: []
};
