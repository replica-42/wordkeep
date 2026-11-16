import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {
    build: {
      lib: { formats: ['cjs'] },
      rolldownOptions: { output: { entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    server: { host: '127.0.0.1' },
    plugins: [
      react(),
      {
        name: 'development-csp',
        transformIndexHtml(html, context) {
          // React Fast Refresh injects an inline script only during development.
          return html.replace(
            '__DEV_SCRIPT__',
            context.server ? " 'unsafe-inline'" : '',
          );
        },
      },
    ],
  },
});
