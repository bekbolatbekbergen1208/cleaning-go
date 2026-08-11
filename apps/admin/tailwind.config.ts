import type { Config } from 'tailwindcss';
export default { content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: { colors: { brand: { 50:'#e7f7f3',500:'#0f9d86',700:'#087562' } } } }, plugins: [] } satisfies Config;
