// vite.config.ts
import { defineConfig } from "file:///C:/Users/sapov/Desktop/codeE/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/sapov/Desktop/codeE/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///C:/Users/sapov/Desktop/codeE/node_modules/@tailwindcss/vite/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Bind to all interfaces so devices on the same network can hit
    // http://<host-ip>:5173. Vite prints the LAN URL on boot.
    host: true,
    proxy: {
      "/auth": "http://localhost:4000",
      "/rooms": "http://localhost:4000",
      "/ws": {
        target: "ws://localhost:4000",
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, "")
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxzYXBvdlxcXFxEZXNrdG9wXFxcXGNvZGVFXFxcXGFwcHNcXFxcd2ViXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxzYXBvdlxcXFxEZXNrdG9wXFxcXGNvZGVFXFxcXGFwcHNcXFxcd2ViXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9zYXBvdi9EZXNrdG9wL2NvZGVFL2FwcHMvd2ViL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ0B0YWlsd2luZGNzcy92aXRlJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCksIHRhaWx3aW5kY3NzKCldLFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIC8vIEJpbmQgdG8gYWxsIGludGVyZmFjZXMgc28gZGV2aWNlcyBvbiB0aGUgc2FtZSBuZXR3b3JrIGNhbiBoaXRcbiAgICAvLyBodHRwOi8vPGhvc3QtaXA+OjUxNzMuIFZpdGUgcHJpbnRzIHRoZSBMQU4gVVJMIG9uIGJvb3QuXG4gICAgaG9zdDogdHJ1ZSxcbiAgICBwcm94eToge1xuICAgICAgJy9hdXRoJzogJ2h0dHA6Ly9sb2NhbGhvc3Q6NDAwMCcsXG4gICAgICAnL3Jvb21zJzogJ2h0dHA6Ly9sb2NhbGhvc3Q6NDAwMCcsXG4gICAgICAnL3dzJzoge1xuICAgICAgICB0YXJnZXQ6ICd3czovL2xvY2FsaG9zdDo0MDAwJyxcbiAgICAgICAgd3M6IHRydWUsXG4gICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoL15cXC93cy8sICcnKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUErUyxTQUFTLG9CQUFvQjtBQUM1VSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxpQkFBaUI7QUFFeEIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sR0FBRyxZQUFZLENBQUM7QUFBQSxFQUNoQyxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUE7QUFBQTtBQUFBLElBR04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsU0FBUztBQUFBLE1BQ1QsVUFBVTtBQUFBLE1BQ1YsT0FBTztBQUFBLFFBQ0wsUUFBUTtBQUFBLFFBQ1IsSUFBSTtBQUFBLFFBQ0osU0FBUyxDQUFDLFNBQVMsS0FBSyxRQUFRLFNBQVMsRUFBRTtBQUFBLE1BQzdDO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
