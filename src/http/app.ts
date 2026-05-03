import compression from "compression";
import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type RequestHandler
} from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppDependencies } from "../bootstrap/dependencies.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { isAppError } from "../shared/errors.js";
import { registerRoutes } from "./routes.js";

function parseCorsOrigin(origin: string): string | string[] {
  if (origin === "*") {
    return "*";
  }

  return origin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route not found"
    }
  });
};

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error({ err }, "Unhandled HTTP request error");

  if (res.headersSent) {
    return;
  }

  const statusCode = isAppError(err)
    ? err.statusCode
    : typeof err === "object" &&
        err !== null &&
        "statusCode" in err &&
        typeof err.statusCode === "number"
      ? err.statusCode
      : typeof err === "object" &&
          err !== null &&
          "status" in err &&
          typeof err.status === "number"
        ? err.status
        : 500;

  const code = isAppError(err)
    ? err.code
    : statusCode === 500
      ? "INTERNAL_SERVER_ERROR"
      : "REQUEST_ERROR";

  res.status(statusCode).json({
    error: {
      code,
      message:
        statusCode === 500
          ? "Unexpected server error"
          : err instanceof Error
            ? err.message
            : "Request failed",
      details: isAppError(err) ? err.details : undefined
    }
  });
};

export function createApp(deps?: AppDependencies): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: parseCorsOrigin(env.CORS_ORIGIN) }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "battle-game-backend",
      time: new Date().toISOString()
    });
  });

  if (deps !== undefined) {
    app.get("/ready", (_req, res) => {
      res.status(200).json({
        status: "ok",
        redis: deps.redis.ready ? "ready" : "disabled-or-unavailable",
        time: new Date().toISOString()
      });
    });

    registerRoutes(app, deps);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
