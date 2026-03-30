import { defineConfig } from 'vite';

const audioCacheBuster = Date.now().toString();

export default defineConfig({
  define: {
    __AUDIO_CACHE_BUSTER__: JSON.stringify(audioCacheBuster)
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: true,
    port: 4173
  }
});
