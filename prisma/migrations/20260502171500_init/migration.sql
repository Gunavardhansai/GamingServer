CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "PlayerStatus" AS ENUM ('OFFLINE', 'ONLINE', 'MATCHMAKING', 'IN_ROOM', 'IN_GAME');
CREATE TYPE "RoomStatus" AS ENUM ('WAITING', 'STARTING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');
CREATE TYPE "RoomVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "RoomPlayerStatus" AS ENUM ('JOINED', 'READY', 'PLAYING', 'DISCONNECTED', 'ELIMINATED', 'LEFT');
CREATE TYPE "GamePhase" AS ENUM ('LOBBY', 'COUNTDOWN', 'ACTIVE', 'RESOLVING', 'FINISHED');
CREATE TYPE "GameActionType" AS ENUM ('ATTACK', 'DEFEND', 'SPECIAL', 'HEAL', 'PASS');
CREATE TYPE "GameActionStatus" AS ENUM ('RECEIVED', 'APPLIED', 'DUPLICATE', 'REJECTED', 'EXPIRED');

CREATE TABLE "players" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "externalId" VARCHAR(128),
  "displayName" VARCHAR(48) NOT NULL,
  "status" "PlayerStatus" NOT NULL DEFAULT 'ONLINE',
  "rating" INTEGER NOT NULL DEFAULT 1000,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "currentRoomId" UUID,
  "lastSeenAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rooms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(12) NOT NULL,
  "status" "RoomStatus" NOT NULL DEFAULT 'WAITING',
  "visibility" "RoomVisibility" NOT NULL DEFAULT 'PUBLIC',
  "maxPlayers" INTEGER NOT NULL DEFAULT 8,
  "minPlayers" INTEGER NOT NULL DEFAULT 2,
  "tickRate" INTEGER NOT NULL DEFAULT 10,
  "version" INTEGER NOT NULL DEFAULT 0,
  "ownerPlayerId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6),
  "startedAt" TIMESTAMPTZ(6),
  "endedAt" TIMESTAMPTZ(6),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_players" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "roomId" UUID NOT NULL,
  "playerId" UUID NOT NULL,
  "status" "RoomPlayerStatus" NOT NULL DEFAULT 'JOINED',
  "seatNumber" INTEGER NOT NULL,
  "teamNumber" INTEGER,
  "health" INTEGER NOT NULL DEFAULT 100,
  "energy" INTEGER NOT NULL DEFAULT 0,
  "isReady" BOOLEAN NOT NULL DEFAULT false,
  "lastProcessedSeq" INTEGER NOT NULL DEFAULT 0,
  "connectionId" VARCHAR(128),
  "reconnectTokenHash" VARCHAR(128),
  "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(6),
  "disconnectedAt" TIMESTAMPTZ(6),
  "leftAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "room_players_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "roomId" UUID NOT NULL,
  "phase" "GamePhase" NOT NULL DEFAULT 'LOBBY',
  "roundNumber" INTEGER NOT NULL DEFAULT 0,
  "turnNumber" INTEGER NOT NULL DEFAULT 0,
  "tick" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL,
  "checksum" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "roomId" UUID NOT NULL,
  "playerId" UUID NOT NULL,
  "actionId" VARCHAR(80) NOT NULL,
  "seq" INTEGER NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "turnNumber" INTEGER NOT NULL,
  "type" "GameActionType" NOT NULL,
  "status" "GameActionStatus" NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB NOT NULL,
  "rejectionReason" VARCHAR(255),
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMPTZ(6),
  "serverVersion" INTEGER,
  CONSTRAINT "game_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "players_externalId_key" ON "players"("externalId");
CREATE INDEX "players_status_idx" ON "players"("status");
CREATE INDEX "players_rating_idx" ON "players"("rating");
CREATE INDEX "players_currentRoomId_idx" ON "players"("currentRoomId");

CREATE UNIQUE INDEX "rooms_code_key" ON "rooms"("code");
CREATE INDEX "rooms_status_visibility_createdAt_idx" ON "rooms"("status", "visibility", "createdAt");
CREATE INDEX "rooms_ownerPlayerId_idx" ON "rooms"("ownerPlayerId");

CREATE UNIQUE INDEX "room_players_reconnectTokenHash_key" ON "room_players"("reconnectTokenHash");
CREATE UNIQUE INDEX "room_players_roomId_playerId_key" ON "room_players"("roomId", "playerId");
CREATE UNIQUE INDEX "room_players_roomId_seatNumber_key" ON "room_players"("roomId", "seatNumber");
CREATE INDEX "room_players_roomId_status_idx" ON "room_players"("roomId", "status");
CREATE INDEX "room_players_playerId_status_idx" ON "room_players"("playerId", "status");

CREATE UNIQUE INDEX "game_states_roomId_version_key" ON "game_states"("roomId", "version");
CREATE INDEX "game_states_roomId_phase_idx" ON "game_states"("roomId", "phase");
CREATE INDEX "game_states_roomId_roundNumber_turnNumber_idx" ON "game_states"("roomId", "roundNumber", "turnNumber");

CREATE UNIQUE INDEX "game_actions_roomId_playerId_actionId_key" ON "game_actions"("roomId", "playerId", "actionId");
CREATE UNIQUE INDEX "game_actions_roomId_playerId_seq_key" ON "game_actions"("roomId", "playerId", "seq");
CREATE INDEX "game_actions_roomId_roundNumber_turnNumber_idx" ON "game_actions"("roomId", "roundNumber", "turnNumber");
CREATE INDEX "game_actions_status_receivedAt_idx" ON "game_actions"("status", "receivedAt");

ALTER TABLE "players"
  ADD CONSTRAINT "players_currentRoomId_fkey"
  FOREIGN KEY ("currentRoomId") REFERENCES "rooms"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_ownerPlayerId_fkey"
  FOREIGN KEY ("ownerPlayerId") REFERENCES "players"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "room_players"
  ADD CONSTRAINT "room_players_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "room_players"
  ADD CONSTRAINT "room_players_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "players"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_states"
  ADD CONSTRAINT "game_states_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_actions"
  ADD CONSTRAINT "game_actions_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_actions"
  ADD CONSTRAINT "game_actions_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "players"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
