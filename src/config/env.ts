import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().min(1).default("*"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SERVER_ID: z.string().min(1).default(`server-${process.pid}`),
  MAX_ROOM_PLAYERS: z.coerce.number().int().min(2).max(32).default(8),
  MIN_ROOM_PLAYERS: z.coerce.number().int().min(2).max(8).default(2),
  GAME_TICK_RATE: z.coerce.number().int().min(1).max(30).default(10),
  TURN_DURATION_MS: z.coerce.number().int().min(3000).max(60000).default(10000),
  START_COUNTDOWN_MS: z.coerce.number().int().min(0).max(30000).default(3000),
  RECONNECT_GRACE_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  ROOM_STATE_TTL_MS: z.coerce.number().int().min(30000).default(600000)
});

export const env = envSchema.parse(process.env);

export type AppEnv = typeof env;
