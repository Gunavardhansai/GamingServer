import type { GameActionType } from "@prisma/client";

export type RuntimeGamePhase = "LOBBY" | "COUNTDOWN" | "ACTIVE" | "FINISHED";

export interface GamePlayerState {
  playerId: string;
  displayName: string;
  seatNumber: number;
  health: number;
  energy: number;
  shield: boolean;
  alive: boolean;
  connected: boolean;
  disconnectedAt?: string;
  lastProcessedSeq: number;
}

export interface GameEvent {
  id: string;
  type:
    | "game_started"
    | "damage"
    | "defend"
    | "heal"
    | "pass"
    | "turn_timeout"
    | "player_disconnected"
    | "player_reconnected"
    | "player_left"
    | "game_over";
  at: string;
  actorPlayerId?: string;
  targetPlayerId?: string;
  amount?: number;
  message: string;
}

export interface GameRuntimeState {
  roomId: string;
  phase: RuntimeGamePhase;
  roundNumber: number;
  turnNumber: number;
  tick: number;
  version: number;
  tickRate: number;
  turnDurationMs: number;
  turnStartedAt?: string;
  turnDeadlineAt?: string;
  currentTurnPlayerId?: string;
  winnerPlayerId?: string;
  turnOrder: string[];
  players: Record<string, GamePlayerState>;
  events: GameEvent[];
  processedActionIds: string[];
  startedAt?: string;
  endedAt?: string;
}

export interface InitialGameParticipant {
  playerId: string;
  displayName: string;
  seatNumber: number;
  health?: number;
  energy?: number;
  connected?: boolean;
  lastProcessedSeq?: number;
}

export interface EngineAction {
  actionId: string;
  playerId: string;
  seq: number;
  roundNumber: number;
  turnNumber: number;
  type: GameActionType;
  targetPlayerId?: string;
  power: number;
}

export interface EngineAcceptedResult {
  accepted: true;
  state: GameRuntimeState;
  event: GameEvent;
}

export interface EngineRejectedResult {
  accepted: false;
  state: GameRuntimeState;
  code: string;
  message: string;
}

export type EngineActionResult = EngineAcceptedResult | EngineRejectedResult;

export interface EngineTickResult {
  changed: boolean;
  state: GameRuntimeState;
  event?: GameEvent;
}
