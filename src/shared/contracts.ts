import { z } from "zod";

export const CLIENT_EVENTS = {
  CREATE_ROOM: "CREATE_ROOM",
  JOIN_ROOM: "JOIN_ROOM",
  FIND_MATCH: "FIND_MATCH",
  LEAVE_ROOM: "LEAVE_ROOM",
  PLAYER_READY: "PLAYER_READY",
  START_GAME: "START_GAME",
  PLAYER_MOVE: "PLAYER_MOVE",
  RECONNECT_PLAYER: "RECONNECT_PLAYER",
  SYNC_STATE: "SYNC_STATE",
  PING: "PING"
} as const;

export const SERVER_EVENTS = {
  SERVER_READY: "SERVER_READY",
  ROOM_JOINED: "ROOM_JOINED",
  ROOM_UPDATED: "ROOM_UPDATED",
  PLAYER_LEFT: "PLAYER_LEFT",
  PLAYER_DISCONNECTED: "PLAYER_DISCONNECTED",
  PLAYER_RECONNECTED: "PLAYER_RECONNECTED",
  GAME_STARTING: "GAME_STARTING",
  GAME_STARTED: "GAME_STARTED",
  GAME_STATE_UPDATE: "GAME_STATE_UPDATE",
  ACTION_ACCEPTED: "ACTION_ACCEPTED",
  ACTION_REJECTED: "ACTION_REJECTED",
  GAME_OVER: "GAME_OVER",
  ERROR: "ERROR",
  PONG: "PONG"
} as const;

export const roomVisibilitySchema = z.enum(["PUBLIC", "PRIVATE"]);
export const actionTypeSchema = z.enum([
  "ATTACK",
  "DEFEND",
  "SPECIAL",
  "HEAL",
  "PASS"
]);

export const playerIdentitySchema = z.object({
  playerId: z.string().uuid().optional(),
  externalId: z.string().trim().min(1).max(128).optional(),
  displayName: z.string().trim().min(2).max(48)
});

export const createPlayerRequestSchema = z.object({
  externalId: z.string().trim().min(1).max(128).optional(),
  displayName: z.string().trim().min(2).max(48)
});

export const createRoomRequestSchema = z.object({
  player: playerIdentitySchema,
  visibility: roomVisibilitySchema.default("PUBLIC"),
  maxPlayers: z.number().int().min(2).max(8).default(8),
  minPlayers: z.number().int().min(2).max(8).default(2)
});

export const joinRoomRequestSchema = z
  .object({
    roomId: z.string().uuid().optional(),
    roomCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,12}$/)
      .optional(),
    player: playerIdentitySchema
  })
  .refine((value) => value.roomId !== undefined || value.roomCode !== undefined, {
    message: "roomId or roomCode is required"
  });

export const findMatchRequestSchema = z.object({
  player: playerIdentitySchema,
  maxPlayers: z.number().int().min(2).max(8).default(8)
});

export const roomPlayerCommandSchema = z.object({
  roomId: z.string().uuid(),
  playerId: z.string().uuid()
});

export const leaveRoomRequestSchema = roomPlayerCommandSchema.extend({
  reason: z.string().trim().max(120).optional()
});

export const playerReadyRequestSchema = roomPlayerCommandSchema.extend({
  isReady: z.boolean().default(true)
});

export const startGameRequestSchema = roomPlayerCommandSchema;

export const playerMoveRequestSchema = roomPlayerCommandSchema.extend({
  actionId: z.string().trim().min(8).max(80),
  seq: z.number().int().min(1),
  roundNumber: z.number().int().min(1),
  turnNumber: z.number().int().min(1),
  type: actionTypeSchema,
  targetPlayerId: z.string().uuid().optional(),
  power: z.number().int().min(1).max(3).default(1),
  clientTime: z.string().datetime().optional()
});

export const reconnectPlayerRequestSchema = z.object({
  roomId: z.string().uuid(),
  playerId: z.string().uuid(),
  reconnectToken: z.string().trim().min(32).max(128),
  lastSeenVersion: z.number().int().min(0).default(0)
});

export const syncStateRequestSchema = roomPlayerCommandSchema.extend({
  lastSeenVersion: z.number().int().min(0).default(0)
});

export const pingRequestSchema = z.object({
  clientTime: z.string().datetime().optional()
});

export interface AckOk<T> {
  ok: true;
  data: T;
}

export interface AckFail {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type AckResponse<T> = AckOk<T> | AckFail;

export function ackOk<T>(data: T): AckOk<T> {
  return { ok: true, data };
}

export function ackFail(error: AckFail["error"]): AckFail {
  return { ok: false, error };
}

export type CreatePlayerRequest = z.infer<typeof createPlayerRequestSchema>;
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;
export type FindMatchRequest = z.infer<typeof findMatchRequestSchema>;
export type LeaveRoomRequest = z.infer<typeof leaveRoomRequestSchema>;
export type PlayerReadyRequest = z.infer<typeof playerReadyRequestSchema>;
export type StartGameRequest = z.infer<typeof startGameRequestSchema>;
export type PlayerMoveRequest = z.infer<typeof playerMoveRequestSchema>;
export type ReconnectPlayerRequest = z.infer<
  typeof reconnectPlayerRequestSchema
>;
export type SyncStateRequest = z.infer<typeof syncStateRequestSchema>;
export type PingRequest = z.infer<typeof pingRequestSchema>;
