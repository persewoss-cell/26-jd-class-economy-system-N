import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 로컬 개발 시 API는 `vercel dev`로 띄운 서버(3000)로 전달
    proxy: { "/api": "http://localhost:3000" },
  },
});
