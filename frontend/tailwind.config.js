/** @type {import('tailwindcss').Config} */
module.exports = {
    // `overline` is a Tailwind utility; without this an app's own eyebrow-label class draws a line above the text.
    blocklist: ["overline"],
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        /* The plum look. `slate` is the neutral ramp, tinted towards plum so no navy shows through anywhere; `emerald` and `teal` (the app's brand
           hue in a few hundred class names) are the orchid ramp. Colours that carry a meaning (a gain, a warning) are written as green/red/amber. */
        /* the theme's semantic surface colours (defined per theme in index.css) */
        line: 'var(--line)', 'line-strong': 'var(--line-strong)', field: 'var(--field)', hover: 'var(--hover)', sidebar: 'var(--sidebar)', scrim: 'var(--scrim)', 'accent-ink': 'var(--accent-ink)',
        slate: { 50: '#f7f4f8', 100: '#efe9f1', 200: '#ddd3e0', 300: '#c5b8ca', 400: '#a699ad', 500: '#857790', 600: '#655a6d', 700: '#4a424f', 800: '#322c37', 900: '#1d1921', 950: '#100d12' },
        emerald: { 50: '#fbf5fd', 100: '#f4e6f8', 200: '#ead0f1', 300: '#dcb0e5', 400: '#cc93d8', 500: '#b87cc8', 600: '#9a6aab', 700: '#7a5a8a', 800: '#644873', 900: '#4a3555', 950: '#2d1f35' },
        teal: { 50: '#faf5fc', 100: '#f1e5f6', 200: '#e3cdec', 300: '#d2afe0', 400: '#bc90cf', 500: '#a276b6', 600: '#855f98', 700: '#6c4d7d', 800: '#573e66', 900: '#402e4b', 950: '#271c2e' },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0'
          },
          to: {
            height: 'var(--radix-accordion-content-height)'
          }
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)'
          },
          to: {
            height: '0'
          }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
