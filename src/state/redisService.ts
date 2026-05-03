import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import type { Server } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export class RedisService {
  private pubClient?: RedisClientType;
  private subClient?: RedisClientType;
  private cacheClient?: RedisClientType;

  public get enabled(): boolean {
    return env.REDIS_URL !== undefined && env.REDIS_URL.length > 0;
  }

  public get ready(): boolean {
    return this.cacheClient?.isReady === true;
  }

  public async connect(): Promise<void> {
    if (!this.enabled) {
      logger.warn("REDIS_URL is not configured; Redis features are disabled");
      return;
    }

    const url = env.REDIS_URL;
    const redisOptions = {
      url,
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: false
      }
    } as const;
    this.pubClient = createClient(redisOptions);
    this.subClient = this.pubClient.duplicate();
    this.cacheClient = this.pubClient.duplicate();

    for (const client of [this.pubClient, this.subClient, this.cacheClient]) {
      client.on("error", (error) => {
        logger.error({ err: error }, "Redis client error");
      });
    }

    try {
      await Promise.all([
        this.pubClient.connect(),
        this.subClient.connect(),
        this.cacheClient.connect()
      ]);

      logger.info("Redis connected");
    } catch (error) {
      logger.warn(
        { err: error },
        "Redis is unavailable; continuing with in-process state only"
      );
      await this.close();
      this.pubClient = undefined;
      this.subClient = undefined;
      this.cacheClient = undefined;
    }
  }

  public attachSocketAdapter(io: Server): void {
    if (this.pubClient === undefined || this.subClient === undefined) {
      return;
    }

    io.adapter(createAdapter(this.pubClient, this.subClient));
    logger.info("Socket.IO Redis adapter enabled");
  }

  public async getJson<T>(key: string): Promise<T | undefined> {
    if (this.cacheClient === undefined || !this.cacheClient.isReady) {
      return undefined;
    }

    const value = await this.cacheClient.get(key);
    if (value === null) {
      return undefined;
    }

    return JSON.parse(value) as T;
  }

  public async setJson(key: string, value: unknown, ttlMs: number): Promise<void> {
    if (this.cacheClient === undefined || !this.cacheClient.isReady) {
      return;
    }

    await this.cacheClient.set(key, JSON.stringify(value), {
      PX: ttlMs
    });
  }

  public async delete(key: string): Promise<void> {
    if (this.cacheClient === undefined || !this.cacheClient.isReady) {
      return;
    }

    await this.cacheClient.del(key);
  }

  public async publish(channel: string, payload: unknown): Promise<void> {
    if (this.pubClient === undefined || !this.pubClient.isReady) {
      return;
    }

    await this.pubClient.publish(channel, JSON.stringify(payload));
  }

  public async close(): Promise<void> {
    await Promise.allSettled([
      this.cacheClient?.quit(),
      this.subClient?.quit(),
      this.pubClient?.quit()
    ]);
  }
}
