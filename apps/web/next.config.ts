import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rtm/ui", "@rtm/contracts"],
};

export default nextConfig;
