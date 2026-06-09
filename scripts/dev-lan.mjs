import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = String(process.env.PORT ?? process.argv[2] ?? "3000");

function getLanIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const net of interfaces ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

const lanIp = getLanIp();
const localhostUrl = `http://localhost:${port}`;
const lanUrl = lanIp ? `http://${lanIp}:${port}` : null;

console.log("");
console.log("  tBrain — локальная разработка (LAN)");
console.log("  ───────────────────────────────────");
console.log(`  Local:   ${localhostUrl}`);
console.log(`  iPhone:  ${lanUrl ?? "(IP не найден — проверь Wi-Fi)"}`);
console.log("  ───────────────────────────────────");
if (lanIp) {
  console.log(`  allowedDevOrigins: ${lanIp}`);
}
console.log("  iPhone и ПК должны быть в одной Wi-Fi сети.");
console.log("  Остановка: Ctrl+C");
console.log("");

const nextEntry = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  [nextEntry, "dev", "--hostname", "0.0.0.0", "--port", port],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: port,
      ...(lanIp ? { ALLOWED_DEV_ORIGINS: lanIp } : {})
    }
  }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
