import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const cli = join(process.cwd(), "dist", "cli", "index.js");
const ui = join(process.cwd(), "dist", "ui", "index.html");

if (!(await exists(cli)) || !(await exists(ui))) {
  console.log("Building agenttrace once…");
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build"], {
      stdio: "inherit",
      shell: true,
      cwd: process.cwd(),
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`build failed (${code})`)),
    );
  });
}

const args = process.argv.slice(2);
const child = spawn(process.execPath, [cli, ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
});
child.on("exit", (code) => process.exit(code ?? 1));
