import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { output: { format: 'cjs' } } } },
  preload: { build: { rollupOptions: { output: { format: 'cjs' } } } },
  renderer: { plugins: [react()] }
})
