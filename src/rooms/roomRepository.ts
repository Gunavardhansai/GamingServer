import {
  GameActionStatus,
  GamePhase,
  PlayerStatus,
  Prisma,
  PrismaClient,
  RoomPlayerStatus,
  RoomStatus,
  RoomVisibility,
  type GameActionType
} from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { env } from "../config/env.js";
import type { GameRuntimeState, InitialGameParticipant } from "../game/types.js";
import type {
  CreatePlayerRequest,
  CreateRoomRequest,
  FindMatchRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  PlayerMoveRequest,
  PlayerReadyRequest
} from "../shared/contracts.js";
import { AppError } from "../shared/errors.js";
import {
  generateReconnectToken,
  generateRoomCode,
  hashReconnectToken
} from "../shared/security.js";
import type {
  ActionReservation,
  DisconnectedMembership,
  PlayerView,
  RecoverableRoom,
  RoomJoinResult,
  RoomParticipantView,
  RoomView
} from "./roomTypes.js";

type PrismaTx = Prisma.TransactionClient;

const activeMembershipStatuses: RoomPlayerStatus[] = [
  RoomPlayerStatus.JOINED,
  RoomPlayerStatus.READY,
  RoomPlayerStatus.PLAYING,
  RoomPlayerStatus.DISCONNECTED,
  RoomPlayerStatus.ELIMINATED
];

const roomInclude = {
  participants: {
    include: {
      player: true
    },
    orderBy: {
      seatNumber: "asc" as const
    }
  },
  gameStates: {
    orderBy: {
      version: "desc" as const
    },
    take: 1
  }
} satisfies Prisma.RoomInclude;

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function toPlayerView(player: {
  id: string;
  externalId: string | null;
  displayName: string;
  rating: number;
  status: PlayerStatus;
}): PlayerView {
  return {
    id: player.id,
    externalId: player.externalId ?? undefined,
    displayName: player.displayName,
    rating: player.rating,
    status: player.status
  };
}

function toRoomView(room: Prisma.RoomGetPayload<{ include: typeof roomInclude }>): RoomView {
  const latestState = room.gameStates[0]?.state as GameRuntimeState | undefined;

  return {
    id: room.id,
    code: room.code,
    status: room.status,
    visibility: room.visibility,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    tickRate: room.tickRate,
    version: room.version,
    ownerPlayerId: room.ownerPlayerId ?? undefined,
    participants: room.participants.map<RoomParticipantView>((participant) => ({
      playerId: participant.playerId,
      displayName: participant.player.displayName,
      seatNumber: participant.seatNumber,
      teamNumber: participant.teamNumber ?? undefined,
      status: participant.status,
      isReady: participant.isReady,
      health: participant.health,
      energy: participant.energy,
      connected:
        participant.connectionId !== null &&
        participant.status !== RoomPlayerStatus.DISCONNECTED,
      lastProcessedSeq: participant.lastProcessedSeq
    })),
    latestState,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    startedAt: room.startedAt?.toISOString(),
    endedAt: room.endedAt?.toISOString()
  };
}

function nextSeat(participants: { seatNumber: number }[], maxPlayers: number): number {
  const usedSeats = new Set(participants.map((participant) => participant.seatNumber));

  for (let seatNumber = 1; seatNumber <= maxPlayers; seatNumber += 1) {
    if (!usedSeats.has(seatNumber)) {
      return seatNumber;
    }
  }

  throw new AppError("ROOM_FULL", "Room is already full", 409);
}

function gamePhaseFromRuntime(state: GameRuntimeState): GamePhase {
  switch (state.phase) {
    case "LOBBY":
      return GamePhase.LOBBY;
    case "COUNTDOWN":
      return GamePhase.COUNTDOWN;
    case "ACTIVE":
      return GamePhase.ACTIVE;
    case "FINISHED":
      return GamePhase.FINISHED;
  }
}

export class RoomRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async upsertPlayer(input: CreatePlayerRequest): Promise<PlayerView> {
    const player = await this.upsertPlayerInTx(this.prisma, {
      displayName: input.displayName,
      externalId: input.externalId
    });

    return toPlayerView(player);
  }

  public async createRoom(
    input: CreateRoomRequest,
    connectionId?: string
  ): Promise<RoomJoinResult> {
    if (input.minPlayers > input.maxPlayers) {
      throw new AppError(
        "INVALID_ROOM_SIZE",
        "minPlayers cannot be greater than maxPlayers",
        400
      );
    }

    const maxPlayers = Math.min(input.maxPlayers, env.MAX_ROOM_PLAYERS);
    const minPlayers = Math.max(input.minPlayers, env.MIN_ROOM_PLAYERS);

    if (minPlayers > maxPlayers) {
      throw new AppError(
        "INVALID_ROOM_SIZE",
        "Configured minimum room size is greater than requested maxPlayers",
        400
      );
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reconnectToken = generateReconnectToken();
      const reconnectTokenHash = hashReconnectToken(reconnectToken);
      const code = generateRoomCode();

      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const player = await this.upsertPlayerInTx(tx, input.player);
            const now = new Date();
            const room = await tx.room.create({
              data: {
                code,
                visibility: input.visibility as RoomVisibility,
                maxPlayers,
                minPlayers,
                tickRate: env.GAME_TICK_RATE,
                ownerPlayerId: player.id,
                expiresAt: new Date(now.getTime() + env.ROOM_STATE_TTL_MS)
              }
            });

            await tx.roomPlayer.create({
              data: {
                roomId: room.id,
                playerId: player.id,
                seatNumber: 1,
                status: RoomPlayerStatus.JOINED,
                connectionId,
                reconnectTokenHash,
                lastSeenAt: now
              }
            });

            await tx.player.update({
              where: { id: player.id },
              data: {
                currentRoomId: room.id,
                status: PlayerStatus.IN_ROOM,
                lastSeenAt: now
              }
            });

            await tx.gameState.create({
              data: {
                roomId: room.id,
                phase: GamePhase.LOBBY,
                version: 0,
                state: {
                  roomId: room.id,
                  phase: "LOBBY",
                  roundNumber: 0,
                  turnNumber: 0,
                  tick: 0,
                  version: 0,
                  tickRate: env.GAME_TICK_RATE,
                  turnDurationMs: env.TURN_DURATION_MS,
                  turnOrder: [],
                  players: {},
                  events: [],
                  processedActionIds: []
                }
              }
            });

            return { player };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        const room = await this.getRoomByCode(code);
        return {
          room,
          player: toPlayerView(result.player),
          reconnectToken
        };
      } catch (error) {
        if (isUniqueError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new AppError("ROOM_CODE_COLLISION", "Could not allocate a room code", 500);
  }

  public async joinRoom(
    input: JoinRoomRequest,
    connectionId?: string
  ): Promise<RoomJoinResult> {
    const reconnectToken = generateReconnectToken();
    const reconnectTokenHash = hashReconnectToken(reconnectToken);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const player = await this.upsertPlayerInTx(tx, input.player);
        const room = await tx.room.findFirst({
          where: input.roomId
            ? { id: input.roomId }
            : { code: input.roomCode },
          include: {
            participants: {
              where: {
                status: {
                  in: activeMembershipStatuses
                }
              }
            }
          }
        });

        if (room === null) {
          throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);
        }

        if (
          room.status !== RoomStatus.WAITING &&
          room.status !== RoomStatus.STARTING
        ) {
          throw new AppError(
            "ROOM_NOT_JOINABLE",
            "Late joiners are not allowed once a game is in progress",
            409
          );
        }

        const existingMembership = room.participants.find(
          (participant) => participant.playerId === player.id
        );

        if (existingMembership !== undefined) {
          await tx.roomPlayer.update({
            where: { id: existingMembership.id },
            data: {
              connectionId,
              reconnectTokenHash,
              status: existingMembership.isReady
                ? RoomPlayerStatus.READY
                : RoomPlayerStatus.JOINED,
              lastSeenAt: new Date(),
              disconnectedAt: null
            }
          });
        } else {
          if (room.participants.length >= room.maxPlayers) {
            throw new AppError("ROOM_FULL", "Room is already full", 409);
          }

          const seatNumber = nextSeat(room.participants, room.maxPlayers);
          await tx.roomPlayer.create({
            data: {
              roomId: room.id,
              playerId: player.id,
              seatNumber,
              status: RoomPlayerStatus.JOINED,
              connectionId,
              reconnectTokenHash,
              lastSeenAt: new Date()
            }
          });
        }

        await tx.player.update({
          where: { id: player.id },
          data: {
            currentRoomId: room.id,
            status: PlayerStatus.IN_ROOM,
            lastSeenAt: new Date()
          }
        });

        return { player, roomId: room.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const room = await this.getRoom(result.roomId);

    return {
      room,
      player: toPlayerView(result.player),
      reconnectToken
    };
  }

  public async findMatch(
    input: FindMatchRequest,
    connectionId?: string
  ): Promise<RoomJoinResult> {
    const rooms = await this.prisma.room.findMany({
      where: {
        status: RoomStatus.WAITING,
        visibility: RoomVisibility.PUBLIC,
        maxPlayers: {
          lte: input.maxPlayers
        }
      },
      include: {
        participants: {
          where: {
            status: {
              in: activeMembershipStatuses
            }
          }
        }
      },
      orderBy: [{ createdAt: "asc" }],
      take: 20
    });

    const availableRoom = rooms.find(
      (room) => room.participants.length < room.maxPlayers
    );

    if (availableRoom !== undefined) {
      return this.joinRoom(
        {
          roomId: availableRoom.id,
          player: input.player
        },
        connectionId
      );
    }

    return this.createRoom(
      {
        player: input.player,
        visibility: "PUBLIC",
        maxPlayers: input.maxPlayers,
        minPlayers: env.MIN_ROOM_PLAYERS
      },
      connectionId
    );
  }

  public async getRoom(roomId: string): Promise<RoomView> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: roomInclude
    });

    if (room === null) {
      throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);
    }

    return toRoomView(room);
  }

  public async getRoomByCode(code: string): Promise<RoomView> {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: roomInclude
    });

    if (room === null) {
      throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);
    }

    return toRoomView(room);
  }

  public async setReady(input: PlayerReadyRequest): Promise<RoomView> {
    const membership = await this.prisma.roomPlayer.findUnique({
      where: {
        roomId_playerId: {
          roomId: input.roomId,
          playerId: input.playerId
        }
      },
      include: {
        room: true
      }
    });

    if (membership === null) {
      throw new AppError("PLAYER_NOT_IN_ROOM", "Player is not in this room", 404);
    }

    if (membership.room.status !== RoomStatus.WAITING) {
      throw new AppError("ROOM_NOT_WAITING", "Ready state can only change in lobby", 409);
    }

    await this.prisma.roomPlayer.update({
      where: { id: membership.id },
      data: {
        isReady: input.isReady,
        status: input.isReady ? RoomPlayerStatus.READY : RoomPlayerStatus.JOINED
      }
    });

    return this.getRoom(input.roomId);
  }

  public async getStartParticipants(
    roomId: string,
    requesterPlayerId: string
  ): Promise<{ room: RoomView; participants: InitialGameParticipant[] }> {
    const room = await this.getRoom(roomId);

    if (room.status !== RoomStatus.WAITING) {
      throw new AppError("ROOM_NOT_WAITING", "Game can only start from waiting state", 409);
    }

    if (room.ownerPlayerId !== undefined && room.ownerPlayerId !== requesterPlayerId) {
      throw new AppError("NOT_ROOM_OWNER", "Only the room owner can start the game", 403);
    }

    const activeParticipants = room.participants.filter(
      (participant) => participant.status !== RoomPlayerStatus.LEFT
    );

    if (activeParticipants.length < room.minPlayers) {
      throw new AppError("NOT_ENOUGH_PLAYERS", "Not enough players to start", 409);
    }

    const notReady = activeParticipants.filter((participant) => !participant.isReady);
    if (notReady.length > 0) {
      throw new AppError("PLAYERS_NOT_READY", "All players must be ready", 409, {
        playerIds: notReady.map((participant) => participant.playerId)
      });
    }

    return {
      room,
      participants: activeParticipants.map((participant) => ({
        playerId: participant.playerId,
        displayName: participant.displayName,
        seatNumber: participant.seatNumber,
        health: participant.health,
        energy: participant.energy,
        connected: participant.connected,
        lastProcessedSeq: participant.lastProcessedSeq
      }))
    };
  }

  public async markRoomStarting(roomId: string): Promise<void> {
    const result = await this.prisma.room.updateMany({
      where: {
        id: roomId,
        status: RoomStatus.WAITING
      },
      data: {
        status: RoomStatus.STARTING
      }
    });

    if (result.count !== 1) {
      throw new AppError("ROOM_START_RACE", "Room is already starting or active", 409);
    }
  }

  public async persistGameStart(state: GameRuntimeState): Promise<RoomView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: state.roomId },
        data: {
          status: RoomStatus.IN_PROGRESS,
          startedAt: new Date(state.startedAt ?? new Date().toISOString()),
          version: state.version
        }
      });

      for (const playerId of state.turnOrder) {
        const player = state.players[playerId];
        if (player === undefined) {
          continue;
        }

        await tx.roomPlayer.update({
          where: {
            roomId_playerId: {
              roomId: state.roomId,
              playerId
            }
          },
          data: {
            status: RoomPlayerStatus.PLAYING,
            health: player.health,
            energy: player.energy
          }
        });

        await tx.player.update({
          where: { id: playerId },
          data: {
            status: PlayerStatus.IN_GAME,
            currentRoomId: state.roomId
          }
        });
      }

      await this.createGameStateInTx(tx, state);
    });

    return this.getRoom(state.roomId);
  }

  public async reserveAction(input: PlayerMoveRequest): Promise<ActionReservation> {
    try {
      await this.prisma.gameAction.create({
        data: {
          roomId: input.roomId,
          playerId: input.playerId,
          actionId: input.actionId,
          seq: input.seq,
          roundNumber: input.roundNumber,
          turnNumber: input.turnNumber,
          type: input.type as GameActionType,
          status: GameActionStatus.RECEIVED,
          payload: input as unknown as Prisma.InputJsonValue
        }
      });

      return { duplicate: false };
    } catch (error) {
      if (!isUniqueError(error)) {
        throw error;
      }

      const action = await this.prisma.gameAction.findFirst({
        where: {
          roomId: input.roomId,
          playerId: input.playerId,
          OR: [{ actionId: input.actionId }, { seq: input.seq }]
        }
      });

      return {
        duplicate: true,
        status: action?.status,
        serverVersion: action?.serverVersion ?? undefined,
        rejectionReason: action?.rejectionReason ?? undefined
      };
    }
  }

  public async updateActionStatus(input: {
    roomId: string;
    playerId: string;
    actionId: string;
    status: GameActionStatus;
    rejectionReason?: string;
    serverVersion?: number;
  }): Promise<void> {
    await this.prisma.gameAction.update({
      where: {
        roomId_playerId_actionId: {
          roomId: input.roomId,
          playerId: input.playerId,
          actionId: input.actionId
        }
      },
      data: {
        status: input.status,
        rejectionReason: input.rejectionReason,
        serverVersion: input.serverVersion,
        appliedAt:
          input.status === GameActionStatus.APPLIED ? new Date() : undefined
      }
    });
  }

  public async persistGameState(state: GameRuntimeState): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: state.roomId },
        select: {
          status: true
        }
      });

      await tx.room.update({
        where: { id: state.roomId },
        data: {
          status:
            state.phase === "FINISHED"
              ? RoomStatus.FINISHED
              : RoomStatus.IN_PROGRESS,
          version: state.version,
          endedAt: state.phase === "FINISHED" ? new Date() : undefined
        }
      });

      for (const playerId of state.turnOrder) {
        const player = state.players[playerId];
        if (player === undefined) {
          continue;
        }

        await tx.roomPlayer.update({
          where: {
            roomId_playerId: {
              roomId: state.roomId,
              playerId
            }
          },
          data: {
            health: player.health,
            energy: player.energy,
            lastProcessedSeq: player.lastProcessedSeq,
            status: player.alive
              ? RoomPlayerStatus.PLAYING
              : RoomPlayerStatus.ELIMINATED
          }
        });
      }

      if (state.phase === "FINISHED" && room?.status !== RoomStatus.FINISHED) {
        for (const playerId of state.turnOrder) {
          await tx.player.update({
            where: { id: playerId },
            data: {
              status: PlayerStatus.ONLINE,
              currentRoomId: null,
              wins: playerId === state.winnerPlayerId ? { increment: 1 } : undefined,
              losses:
                playerId !== state.winnerPlayerId ? { increment: 1 } : undefined
            }
          });
        }
      }

      await this.createGameStateInTx(tx, state);
    });
  }

  public async getLatestGameState(roomId: string): Promise<GameRuntimeState> {
    const state = await this.prisma.gameState.findFirst({
      where: { roomId },
      orderBy: { version: "desc" }
    });

    if (state === null) {
      throw new AppError("GAME_STATE_NOT_FOUND", "Game state not found", 404);
    }

    return state.state as unknown as GameRuntimeState;
  }

  public async leaveRoom(input: LeaveRoomRequest): Promise<RoomView> {
    const membership = await this.prisma.roomPlayer.findUnique({
      where: {
        roomId_playerId: {
          roomId: input.roomId,
          playerId: input.playerId
        }
      },
      include: {
        room: true
      }
    });

    if (membership === null) {
      throw new AppError("PLAYER_NOT_IN_ROOM", "Player is not in this room", 404);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.roomPlayer.update({
        where: { id: membership.id },
        data: {
          status: RoomPlayerStatus.LEFT,
          isReady: false,
          connectionId: null,
          leftAt: new Date()
        }
      });

      await tx.player.update({
        where: { id: input.playerId },
        data: {
          status: PlayerStatus.ONLINE,
          currentRoomId: null,
          lastSeenAt: new Date()
        }
      });

      const remaining = await tx.roomPlayer.count({
        where: {
          roomId: input.roomId,
          status: {
            in: [
              RoomPlayerStatus.JOINED,
              RoomPlayerStatus.READY,
              RoomPlayerStatus.PLAYING,
              RoomPlayerStatus.DISCONNECTED
            ]
          }
        }
      });

      if (remaining === 0 && membership.room.status === RoomStatus.WAITING) {
        await tx.room.update({
          where: { id: input.roomId },
          data: {
            status: RoomStatus.CANCELLED,
            endedAt: new Date()
          }
        });
      }
    });

    return this.getRoom(input.roomId);
  }

  public async markSocketDisconnected(
    connectionId: string
  ): Promise<DisconnectedMembership | undefined> {
    const membership = await this.prisma.roomPlayer.findFirst({
      where: {
        connectionId,
        status: {
          in: [
            RoomPlayerStatus.JOINED,
            RoomPlayerStatus.READY,
            RoomPlayerStatus.PLAYING
          ]
        }
      },
      include: {
        room: true
      }
    });

    if (membership === null) {
      return undefined;
    }

    await this.prisma.$transaction([
      this.prisma.roomPlayer.update({
        where: { id: membership.id },
        data: {
          status: RoomPlayerStatus.DISCONNECTED,
          connectionId: null,
          disconnectedAt: new Date(),
          lastSeenAt: new Date()
        }
      }),
      this.prisma.player.update({
        where: { id: membership.playerId },
        data: {
          status: PlayerStatus.OFFLINE,
          lastSeenAt: new Date()
        }
      })
    ]);

    return {
      roomId: membership.roomId,
      playerId: membership.playerId,
      roomStatus: membership.room.status
    };
  }

  public async reconnectPlayer(input: {
    roomId: string;
    playerId: string;
    reconnectToken: string;
    connectionId?: string;
  }): Promise<RoomView> {
    const tokenHash = hashReconnectToken(input.reconnectToken);
    const membership = await this.prisma.roomPlayer.findFirst({
      where: {
        roomId: input.roomId,
        playerId: input.playerId,
        reconnectTokenHash: tokenHash
      },
      include: {
        room: true
      }
    });

    if (membership === null) {
      throw new AppError("INVALID_RECONNECT_TOKEN", "Reconnect token is invalid", 401);
    }

    if (
      membership.room.status === RoomStatus.FINISHED ||
      membership.room.status === RoomStatus.CANCELLED
    ) {
      throw new AppError("ROOM_CLOSED", "Room is already closed", 409);
    }

    const newStatus =
      membership.room.status === RoomStatus.IN_PROGRESS
        ? RoomPlayerStatus.PLAYING
        : membership.isReady
          ? RoomPlayerStatus.READY
          : RoomPlayerStatus.JOINED;

    await this.prisma.$transaction([
      this.prisma.roomPlayer.update({
        where: { id: membership.id },
        data: {
          status: newStatus,
          connectionId: input.connectionId,
          disconnectedAt: null,
          lastSeenAt: new Date()
        }
      }),
      this.prisma.player.update({
        where: { id: input.playerId },
        data: {
          status:
            membership.room.status === RoomStatus.IN_PROGRESS
              ? PlayerStatus.IN_GAME
              : PlayerStatus.IN_ROOM,
          currentRoomId: input.roomId,
          lastSeenAt: new Date()
        }
      })
    ]);

    return this.getRoom(input.roomId);
  }

  public async listRecoverableRooms(): Promise<RecoverableRoom[]> {
    const rooms = await this.prisma.room.findMany({
      where: {
        status: {
          in: [RoomStatus.STARTING, RoomStatus.IN_PROGRESS]
        }
      },
      include: roomInclude
    });

    return rooms
      .map(toRoomView)
      .filter((room): room is RoomView & { latestState: GameRuntimeState } =>
        room.latestState !== undefined
      )
      .map((room) => ({
        room,
        state: room.latestState
      }));
  }

  private async upsertPlayerInTx(
    tx: PrismaTx | PrismaClient,
    input: {
      playerId?: string;
      externalId?: string;
      displayName: string;
    }
  ) {
    const now = new Date();

    if (input.playerId !== undefined) {
      return tx.player.update({
        where: { id: input.playerId },
        data: {
          displayName: input.displayName,
          externalId: input.externalId,
          status: PlayerStatus.ONLINE,
          lastSeenAt: now
        }
      });
    }

    if (input.externalId !== undefined) {
      return tx.player.upsert({
        where: { externalId: input.externalId },
        update: {
          displayName: input.displayName,
          status: PlayerStatus.ONLINE,
          lastSeenAt: now
        },
        create: {
          externalId: input.externalId,
          displayName: input.displayName,
          status: PlayerStatus.ONLINE,
          lastSeenAt: now
        }
      });
    }

    return tx.player.create({
      data: {
        displayName: input.displayName,
        status: PlayerStatus.ONLINE,
        lastSeenAt: now
      }
    });
  }

  private async createGameStateInTx(
    tx: PrismaTx,
    state: GameRuntimeState
  ): Promise<void> {
    await tx.gameState.upsert({
      where: {
        roomId_version: {
          roomId: state.roomId,
          version: state.version
        }
      },
      update: {
        phase: gamePhaseFromRuntime(state),
        roundNumber: state.roundNumber,
        turnNumber: state.turnNumber,
        tick: state.tick,
        state: state as unknown as Prisma.InputJsonValue
      },
      create: {
        roomId: state.roomId,
        phase: gamePhaseFromRuntime(state),
        roundNumber: state.roundNumber,
        turnNumber: state.turnNumber,
        tick: state.tick,
        version: state.version,
        state: state as unknown as Prisma.InputJsonValue
      }
    });
  }
}
