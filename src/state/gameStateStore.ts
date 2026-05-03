import { env } from "../config/env.js";
import type { GameRuntimeState } from "../game/types.js";
import type { RedisService } from "./redisService.js";

function stateKey(roomId: string): string {
  return `room:${roomId}:state`;
}

export class GameStateStore {
  private readonly memory = new Map<string, GameRuntimeState>();

  public constructor(private readonly redis: RedisService) {}

  public async get(roomId: string): Promise<GameRuntimeState | undefined> {
    const localState = this.memory.get(roomId);
    if (localState !== undefined) {
      return localState;
    }

    const redisState = await this.redis.getJson<GameRuntimeState>(stateKey(roomId));
    if (redisState !== undefined) {
      this.memory.set(roomId, redisState);
    }

    return redisState;
  }

  public async set(state: GameRuntimeState): Promise<void> {
    this.memory.set(state.roomId, state);
    await this.redis.setJson(stateKey(state.roomId), state, env.ROOM_STATE_TTL_MS);
  }

  public async delete(roomId: string): Promise<void> {
    this.memory.delete(roomId);
    await this.redis.delete(stateKey(roomId));
  }

  public roomIds(): string[] {
    return [...this.memory.keys()];
  }
}
