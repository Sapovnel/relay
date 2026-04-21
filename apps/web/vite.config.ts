import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Bind to all interfaces so devices on the same network can hit
    // http://<host-ip>:5173. Vite prints the LAN URL on boot.
    host: true,
    proxy: {
      '/auth': 'http://localhost:4000',
      '/rooms': 'http://localhost:4000',
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
    },
  },
});
