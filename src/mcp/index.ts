import { startMcpServer } from "./server.js";

startMcpServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
