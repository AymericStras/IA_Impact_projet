import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, /api est relayé vers le backend FastAPI (uvicorn sur le port 8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
