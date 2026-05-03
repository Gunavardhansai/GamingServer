import { GameActionStatus, RoomStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { RealtimeGateway } from "../realtime/gateway.js";
import { SERVER_EVENTS, type PlayerMoveRequest } from "../shared/contracts.js";
import { AppError } from "../shared/errors.js";
import { RoomRepository } from "../rooms/roomRepository.js";
import type { RoomView } from "../rooms/roomTypes.js";
import { GameStateStore } from "../state/gameStateStore.js";
import { GameEngine } from "./gameEngine.js";
import type { GameRuntimeState } from "./types.js";

export interface MoveResult {
  accepted: boolean;
  state: GameRuntimeState;
  code?: string;
  message?: string;
  duplicate?: boolean;
}

export class GameCoordinator {
  private readonly engine = new GameEngine();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  public constructor(
    private readonly rooms: RoomRepository,
    private readonly stateStore: GameStateStore,
    private readonly gateway: RealtimeGateway
  ) {}

  public createInitialState(input: {
    roomId: string;
    tickRate: number;
    participants: Parameters<GameEngine["createInitialState"]>[0]["participants"];
  }): GameRuntimeState {
    return this.engine.createInitialState({
      roomId: input.roomId,
      tickRate: input.tickRate,
      turnDurationMs: env.TURN_DURATION_MS,
      participants: input.participants
    });
  }

  public async startRoom(state: GameRuntimeState): Promise<void> {
    await this.stateStore.set(state);
    this.startLoop(state.roomId, state.tickRate);
    this.gateway.emitToRoom(state.roomId, SERVER_EVENTS.GAME_STARTED, { state });
    this.gateway.emitToRoom(state.roomId, SERVER_EVENTS.GAME_STATE_UPDATE, {
      state
    });
  }

  public async applyPlayerMove(input: PlayerMoveRequest): Promise<MoveResult> {
    const reservation = await this.rooms.reserveAction(input);
    const currentState = await this.getState(input.roomId);

    if (reservation.duplicate) {
      return {
        accepted: reservation.status === GameActionStatus.APPLIED,
        duplicate: true,
        state: currentState,
        code:
          reservation.status === GameActionStatus.APPLIED
            ? "DUPLICATE_ACTION"
            : "DUPLICATE_REJECTED_ACTION",
        message: reservation.rejectionReason ?? "Action was already received"
      };
    }

    const result = this.engine.applyAction(currentState, {
      actionId: input.actionId,
      playerId: input.playerId,
      seq: input.seq,
      roundNumber: input.roundNumber,
      turnNumber: input.turnNumber,
      type: input.type,
      targetPlayerId: input.targetPlayerId,
      power: input.power
    });

    if (!result.accepted) {
      await this.rooms.updateActionStatus({
        roomId: input.roomId,
        playerId: input.playerId,
        actionId: input.actionId,
        status: GameActionStatus.REJECTED,
        rejectionReason: result.code,
        serverVersion: currentState.version
      });

      return {
        accepted: false,
        state: result.state,
        code: result.code,
        message: result.message
      };
    }

    await this.persistAndBroadcast(result.state);
    await this.rooms.updateActionStatus({
      roomId: input.roomId,
      playerId: input.playerId,
      actionId: input.actionId,
      status: GameActionStatus.APPLIED,
      serverVersion: result.state.version
    });

    this.gateway.emitToRoom(input.roomId, SERVER_EVENTS.ACTION_ACCEPTED, {
      actionId: input.actionId,
      playerId: input.playerId,
      version: result.state.version
    });

    return {
      accepted: true,
      state: result.state
    };
  }

  public async getState(roomId: string): Promise<GameRuntimeState> {
    const cachedState = await this.stateStore.get(roomId);
    if (cachedState !== undefined) {
      return cachedState;
    }

    const state = await this.rooms.getLatestGameState(roomId);
    await this.stateStore.set(state);
    return state;
  }

  public async handleDisconnect(roomId: string, playerId: string): Promise<void> {
    const currentState = await this.stateStore.get(roomId);
    if (currentState === undefined || currentState.phase === "FINISHED") {
      return;
    }

    const nextState = this.engine.markConnection(currentState, playerId, false);
    await this.persistAndBroadcast(nextState);
    this.gateway.emitToRoom(roomId, SERVER_EVENTS.PLAYER_DISCONNECTED, {
      roomId,
      playerId,
      graceMs: env.RECONNECT_GRACE_MS
    });
  }

  public async handleReconnect(roomId: string, playerId: string): Promise<void> {
    const currentState = await this.getState(roomId);
    if (currentState.phase === "FINISHED") {
      return;
    }

    const nextState = this.engine.markConnection(currentState, playerId, true);
    await this.persistAndBroadcast(nextState);
    this.gateway.emitToRoom(roomId, SERVER_EVENTS.PLAYER_RECONNECTED, {
      roomId,
      playerId
    });
  }

  public async handleLeave(roomId: string, playerId: string): Promise<void> {
    const currentState = await this.stateStore.get(roomId);
    if (currentState === undefined || currentState.phase === "FINISHED") {
      return;
    }

    const nextState = this.engine.markLeft(currentState, playerId);
    await this.persistAndBroadcast(nextState);
  }

  public async recoverActiveRooms(): Promise<void> {
    const recoverableRooms = await this.rooms.listRecoverableRooms();

    for (const recoverable of recoverableRooms) {
      await this.stateStore.set(recoverable.state);

      if (recoverable.room.status === RoomStatus.IN_PROGRESS) {
        this.startLoop(recoverable.room.id, recoverable.room.tickRate);
      }

      logger.info(
        {
          roomId: recoverable.room.id,
          version: recoverable.state.version
        },
        "Recovered active room"
      );
    }
  }

  public stopAll(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }

    this.timers.clear();
  }

  private startLoop(roomId: string, tickRate: number): void {
    if (this.timers.has(roomId)) {
      return;
    }

    const intervalMs = Math.max(1000 / tickRate, 100);
    const timer = setInterval(() => {
      void this.tickRoom(roomId).catch((error: unknown) => {
        logger.error({ err: error, roomId }, "Game tick failed");
      });
    }, intervalMs);

    timer.unref();
    this.timers.set(roomId, timer);
  }

  private async tickRoom(roomId: string): Promise<void> {
    const currentState = await this.stateStore.get(roomId);
    if (currentState === undefined) {
      this.stopLoop(roomId);
      return;
    }

    if (currentState.phase === "FINISHED") {
      this.stopLoop(roomId);
      await this.stateStore.delete(roomId);
      return;
    }

    const tickResult = this.engine.processTick(currentState);

    if (!tickResult.changed) {
      await this.stateStore.set(tickResult.state);
      return;
    }

    await this.persistAndBroadcast(tickResult.state);
  }

  private async persistAndBroadcast(state: GameRuntimeState): Promise<void> {
    await this.stateStore.set(state);
    await this.rooms.persistGameState(state);

    this.gateway.emitToRoom(state.roomId, SERVER_EVENTS.GAME_STATE_UPDATE, {
      state
    });

    if (state.phase === "FINISHED") {
      this.gateway.emitToRoom(state.roomId, SERVER_EVENTS.GAME_OVER, {
        roomId: state.roomId,
        winnerPlayerId: state.winnerPlayerId,
        state
      });
      this.stopLoop(state.roomId);
      await this.stateStore.delete(state.roomId);
    }
  }

  private stopLoop(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer !== undefined) {
      clearInterval(timer);
      this.timers.delete(roomId);
    }
  }
}
