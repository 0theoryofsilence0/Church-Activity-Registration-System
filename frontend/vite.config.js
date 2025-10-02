import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import svgLoader from "vite-svg-loader"; // <--- add this

export default defineConfig({
  plugins: [
    vue(),
    svgLoader(), // 
  ],
  server: {
    host: true, // expose to LAN
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001", // or your backend host:port
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
