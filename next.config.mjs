import os from "node:os";

function normalizeDevOrigin(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return trimmed.split(":")[0].toLowerCase();
}

function getDevOrigins() {
  const origins = new Set(["localhost", "127.0.0.1"]);

  if (process.env.ALLOWED_DEV_ORIGINS) {
    for (const entry of process.env.ALLOWED_DEV_ORIGINS.split(",")) {
      const normalized = normalizeDevOrigin(entry);
      if (normalized) origins.add(normalized);
    }
  }

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const net of interfaces ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        origins.add(net.address.toLowerCase());
      }
    }
  }

  return [...origins];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: getDevOrigins(),
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }]
      }
    ];
  }
};

export default nextConfig;
