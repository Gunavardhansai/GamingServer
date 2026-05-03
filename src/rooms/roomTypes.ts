import type { GameActionStatus, RoomStatus, RoomVisibility } from "@prisma/client";
import type { GameRuntimeState } from "../game/types.js";

export interface PlayerView {
  id: string;
  externalId?: string;
  displayName: string;
  rating: number;
  status: string;
}

export interface RoomParticipantView {
  playerId: string;
  displayName: string;
  seatNumber: number;
  teamNumber?: number;
  status: string;
  isReady: boolean;
  health: number;
  energy: number;
  connected: boolean;
  lastProcessedSeq: number;
}

export interface RoomView {
  id: string;
  code: string;
  status: RoomStatus;
  visibility: RoomVisibility;
  maxPlayers: number;
  minPlayers: number;
  tickRate: number;
  version: number;
  ownerPlayerId?: string;
  participants: RoomParticipantView[];
  latestState?: GameRuntimeState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface RoomJoinResult {
  room: RoomView;
  player: PlayerView;
  reconnectToken: string;
}

export interface ActionReservation {
  duplicate: boolean;
  status?: GameActionStatus;
  serverVersion?: number;
  rejectionReason?: string;
}

export interface DisconnectedMembership {
  roomId: string;
  playerId: string;
  roomStatus: RoomStatus;
}

export interface RecoverableRoom {
  room: RoomView;
  state: GameRuntimeState;
}
