import { PrismaClient, type Prisma } from "@prisma/client";
import { logger } from "../config/logger.js";

const prismaClientOptions = {
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" }
  ]
} as const satisfies Prisma.PrismaClientOptions;

type PrismaClientWithLogs = PrismaClient<typeof prismaClientOptions>;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientWithLogs;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(prismaClientOptions);

prisma.$on("error", (event) => {
  logger.error({ target: event.target, message: event.message }, "Prisma error");
});

prisma.$on("warn", (event) => {
  logger.warn({ target: event.target, message: event.message }, "Prisma warning");
});

prisma.$on("query", (event) => {
  logger.debug(
    {
      duration: event.duration,
      query: event.query,
      params: event.params
    },
    "Prisma query"
  );
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
