import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A raiz do site mostra o login; o endereço /login nunca aparece no navegador.
  async redirects() {
    return [{ source: "/login", destination: "/", permanent: false }];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/login" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;