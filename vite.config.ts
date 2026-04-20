import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('three') || id.includes('@react-three')) return 'three-stack';
          if (id.includes('firebase')) return 'firebase';
          if (id.includes('recharts') || id.includes('victory-vendor') || id.includes('d3-')) return 'charts';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('motion')) return 'motion';
          if (id.includes('@google')) return 'google-ai';
          if (id.includes('date-fns')) return 'date-fns';
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: [
      {find: '@', replacement: path.resolve(__dirname, '.')},
      {
        find: 'es-toolkit/compat/get',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/get.ts'),
      },
      {
        find: 'es-toolkit/compat/isPlainObject',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/isPlainObject.ts'),
      },
      {
        find: 'es-toolkit/compat/last',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/last.ts'),
      },
      {
        find: 'es-toolkit/compat/maxBy',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/maxBy.ts'),
      },
      {
        find: 'es-toolkit/compat/minBy',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/minBy.ts'),
      },
      {
        find: 'es-toolkit/compat/omit',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/omit.ts'),
      },
      {
        find: 'es-toolkit/compat/range',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/range.ts'),
      },
      {
        find: 'es-toolkit/compat/sortBy',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/sortBy.ts'),
      },
      {
        find: 'es-toolkit/compat/sumBy',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/sumBy.ts'),
      },
      {
        find: 'es-toolkit/compat/throttle',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/throttle.ts'),
      },
      {
        find: 'es-toolkit/compat/uniqBy',
        replacement: path.resolve(__dirname, 'src/shims/es-toolkit-compat/uniqBy.ts'),
      },
      {find: /^framer-motion$/, replacement: path.resolve(__dirname, 'node_modules/framer-motion/dist/cjs/index.js')},
      {find: /^zustand$/, replacement: path.resolve(__dirname, 'node_modules/zustand/index.js')},
      {find: 'zustand/middleware', replacement: path.resolve(__dirname, 'node_modules/zustand/middleware.js')},
      {find: 'zustand/react/shallow', replacement: path.resolve(__dirname, 'node_modules/zustand/shallow.js')},
      {find: 'zustand/shallow', replacement: path.resolve(__dirname, 'node_modules/zustand/shallow.js')},
      {
        find: 'zustand/traditional',
        replacement: path.resolve(__dirname, 'node_modules/zustand/traditional.js'),
      },
      {find: 'zustand/vanilla/shallow', replacement: path.resolve(__dirname, 'node_modules/zustand/shallow.js')},
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify: file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
