import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { preview } from "vite-plus";

const root = fileURLToPath(new URL("../apps/web", import.meta.url));
const backend = "http://127.0.0.1:3773";
const build = JSON.parse(await readFile(`${root}/dist/math-build.json`, "utf8"));
const response = await fetch(`${backend}/.well-known/t3/environment`, {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error("请先启动官方 T3 Code。");
const environment = await response.json();
if (environment.serverVersion !== build.version) {
  throw new Error(`官方版本已变为 ${environment.serverVersion}，请在公式版启动器中更新网页。`);
}

// Keep the browser's Host and Origin, including its port, so DPoP URL proofs
// remain valid. Authentication and all state stay with the official backend.
const proxy = Object.fromEntries(
  ["/api", "/oauth", "/.well-known", "/ws"].map((prefix) => [
    `^${prefix.replaceAll(".", "\\.")}(?:/|$|\\?)`,
    { target: backend, ws: true, changeOrigin: false },
  ]),
);
const server = await preview({
  configFile: false,
  root,
  build: { outDir: "dist" },
  preview: { host: "127.0.0.1", port: 3774, strictPort: true, proxy },
});
console.log(`公式界面：http://127.0.0.1:3774/（共用官方 ${build.version} 后端）`);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
