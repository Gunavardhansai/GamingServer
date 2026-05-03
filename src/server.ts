import { createServer } from "node:http";
import { createDependencies } from "./bootstrap/dependencies.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./http/app.js";
import { createSocketServer } from "./realtime/socketServer.js";

const deps = await createDependencies();
const app = createApp(deps);
const httpServer = createServer(app);
const io = createSocketServer(httpServer, deps);

try {
  await deps.gameCoordinator.recoverActiveRooms();
} catch (error) {
  logger.warn(
    { err: error },
    "Could not recover active rooms during startup; continuing so health checks stay available"
  );
}

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, "Shutting down server");

  io.close(() => {
    httpServer.close((error) => {
      if (error) {
        logger.error({ err: error }, "HTTP server shutdown failed");
        process.exit(1);
      }

      deps
        .close()
        .then(() => {
          logger.info("Server shutdown complete");
          process.exit(0);
        })
        .catch((closeError: unknown) => {
          logger.error({ err: closeError }, "Dependency shutdown failed");
          process.exit(1);
        });
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(env.PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.PORT },
    "Battle game backend is listening"
  );
});
