/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  test: {
    // Pipeline-Code laeuft im Web Worker und in Node (Tests) ohne DOM —
    // XML wird mit fast-xml-parser geparst, kein jsdom noetig.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
