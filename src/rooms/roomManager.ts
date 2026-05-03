import { env } from "../config/env.js";
import { GameCoordinator } from "../game/gameCoordinator.js";
import { RealtimeGateway } from "../realtime/gateway.js";
import { SERVER_EVENTS } from "../shared/contracts.js";
import type {
  CreatePlayerRequest,
  CreateRoomRequest,
  FindMatchRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  PlayerReadyRequest,
  ReconnectPlayerRequest,
  StartGameRequest,
  SyncStateRequest
} from "../shared/contracts.js";
import type { RoomJoinResult, RoomView } from "./roomTypes.js";
import { RoomRepository } from "./roomRepository.js";

export class RoomManager {
  public constructor(
    private readonly rooms: RoomRepository,
    private readonly games: GameCoordinator,
    private readonly gateway: RealtimeGateway
  ) {}

  public createPlayer(input: CreatePlayerRequest) {
    return this.rooms.upsertPlayer(input);
  }

  public async createRoom(
    input: CreateRoomRequest,
    connectionId?: string
  ): Promise<RoomJoinResult> {
    const result = await this.rooms.createRoom(input, connectionId);
    this.gateway.emitToRoom(result.room.id, SERVER_EVENTS.ROOM_UPDATED, {
      room: result.room
    });
    return result;
  }

  public async joinRoom(
    input: JoinRoomRequest,
    connectionId?: string
  ): Promise<RoomJoinResult> {
    const result = await this.rooms.joinRoom(input, connectionId);
    this.gateway.emitToRoom(result.room.id, SERVER_EVENTS.ROOM_UPDATED, {
      room: result.room
    });
    return result;
  }

  public async findMatch(
    input: FindMatchRequest,
    connectionId?: string
  ): Promise<RoomJoinResult> {
    const result = await this.rooms.findMatch(input, connectionId);
    this.gateway.emitToRoom(result.room.id, SERVER_EVENTS.ROOM_UPDATED, {
      room: result.room
    });
    return result;
  }

  public getRoom(roomId: string): Promise<RoomView> {
    return this.rooms.getRoom(roomId);
  }

  public async setReady(input: PlayerReadyRequest): Promise<RoomView> {
    const room = await this.rooms.setReady(input);
    this.gateway.emitToRoom(room.id, SERVER_EVENTS.ROOM_UPDATED, { room });
    return room;
  }

  public async startGame(input: StartGameRequest): Promise<{
    room: RoomView;
  }> {
    const startData = await this.rooms.getStartParticipants(
      input.roomId,
      input.playerId
    );
    await this.rooms.markRoomStarting(input.roomId);

    this.gateway.emitToRoom(input.roomId, SERVER_EVENTS.GAME_STARTING, {
      roomId: input.roomId,
      countdownMs: env.START_COUNTDOWN_MS
    });

    if (env.START_COUNTDOWN_MS > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, env.START_COUNTDOWN_MS);
      });
    }

    const state = this.games.createInitialState({
      roomId: input.roomId,
      tickRate: startData.room.tickRate,
      participants: startData.participants
    });
    const room = await this.rooms.persistGameStart(state);
    await this.games.startRoom(state);

    return { room };
  }

  public async leaveRoom(input: LeaveRoomRequest): Promise<RoomView> {
    const room = await this.rooms.leaveRoom(input);
    await this.games.handleLeave(input.roomId, input.playerId);
    this.gateway.emitToRoom(input.roomId, SERVER_EVENTS.PLAYER_LEFT, {
      roomId: input.roomId,
      playerId: input.playerId,
      reason: input.reason
    });
    this.gateway.emitToRoom(input.roomId, SERVER_EVENTS.ROOM_UPDATED, { room });
    return room;
  }

  public async reconnectPlayer(
    input: ReconnectPlayerRequest,
    connectionId?: string
  ): Promise<{ room: RoomView; state: unknown }> {
    const room = await this.rooms.reconnectPlayer({
      roomId: input.roomId,
      playerId: input.playerId,
      reconnectToken: input.reconnectToken,
      connectionId
    });
    await this.games.handleReconnect(input.roomId, input.playerId);
    const state = await this.games.getState(input.roomId);
    return { room, state };
  }

  public async syncState(input: SyncStateRequest) {
    const state = await this.games.getState(input.roomId);
    return {
      state,
      isDelta: false,
      requestedFromVersion: input.lastSeenVersion
    };
  }

  public async handleSocketDisconnect(connectionId: string): Promise<void> {
    const membership = await this.rooms.markSocketDisconnected(connectionId);
    if (membership === undefined) {
      return;
    }

    await this.games.handleDisconnect(membership.roomId, membership.playerId);
  }
}
