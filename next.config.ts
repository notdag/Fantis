import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev-mode badge (it sat over the manager drawer and buttons on small screens). Dev only.
  devIndicators: false,
};

export default nextConfig;
