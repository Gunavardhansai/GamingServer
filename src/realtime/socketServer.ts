import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { z } from "zod";
import type { AppDependencies } from "../bootstrap/dependencies.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  ackFail,
  ackOk,
  CLIENT_EVENTS,
  createRoomRequestSchema,
  findMatchRequestSchema,
  joinRoomRequestSchema,
  leaveRoomRequestSchema,
  pingRequestSchema,
  playerMoveRequestSchema,
  playerReadyRequestSchema,
  reconnectPlayerRequestSchema,
  SERVER_EVENTS,
  startGameRequestSchema,
  syncStateRequestSchema,
  type AckResponse
} from "../shared/contracts.js";
import { AppError, toErrorPayload } from "../shared/errors.js";
import { roomChannel } from "./gateway.js";

function parseCorsOrigin(origin: string): string | string[] {
  if (origin === "*") {
    return "*";
  }

  return origin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

type AckCallback<T> = (response: AckResponse<T>) => void;

function parsePayload<TSchema extends z.ZodType>(
  schema: TSchema,
  payload: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid event payload", 400, {
      issues: result.error.issues
    });
  }

  return result.data;
}

function respond<T>(ack: AckCallback<T> | undefined, response: AckResponse<T>): void {
  if (ack !== undefined) {
    ack(response);
  }
}

export function createSocketServer(
  httpServer: HttpServer,
  deps?: AppDependencies
): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: parseCorsOrigin(env.CORS_ORIGIN)
    },
    transports: ["websocket", "polling"]
  });

  deps?.redis.attachSocketAdapter(io);
  deps?.realtimeGateway.setServer(io);

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket connected");

    socket.emit(SERVER_EVENTS.SERVER_READY, {
      socketId: socket.id,
      serverId: env.SERVER_ID,
      serverTime: new Date().toISOString()
    });

    socket.on(
      CLIENT_EVENTS.CREATE_ROOM,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(createRoomRequestSchema, payload);
          const result = await deps.roomManager.createRoom(body, socket.id);
          await socket.join(roomChannel(result.room.id));
          socket.emit(SERVER_EVENTS.ROOM_JOINED, result);
          respond(ack, ackOk(result));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.JOIN_ROOM,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(joinRoomRequestSchema, payload);
          const result = await deps.roomManager.joinRoom(body, socket.id);
          await socket.join(roomChannel(result.room.id));
          socket.emit(SERVER_EVENTS.ROOM_JOINED, result);
          respond(ack, ackOk(result));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.FIND_MATCH,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(findMatchRequestSchema, payload);
          const result = await deps.roomManager.findMatch(body, socket.id);
          await socket.join(roomChannel(result.room.id));
          socket.emit(SERVER_EVENTS.ROOM_JOINED, result);
          respond(ack, ackOk(result));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.PLAYER_READY,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(playerReadyRequestSchema, payload);
          const room = await deps.roomManager.setReady(body);
          await socket.join(roomChannel(room.id));
          respond(ack, ackOk({ room }));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.START_GAME,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(startGameRequestSchema, payload);
          const result = await deps.roomManager.startGame(body);
          respond(ack, ackOk(result));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.PLAYER_MOVE,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Game service is unavailable", 503);
          }

          const body = parsePayload(playerMoveRequestSchema, payload);
          const result = await deps.gameCoordinator.applyPlayerMove(body);

          if (!result.accepted) {
            socket.emit(SERVER_EVENTS.ACTION_REJECTED, {
              actionId: body.actionId,
              code: result.code,
              message: result.message,
              duplicate: result.duplicate ?? false,
              stateVersion: result.state.version
            });
          }

          respond(ack, ackOk(result));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.LEAVE_ROOM,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(leaveRoomRequestSchema, payload);
          const room = await deps.roomManager.leaveRoom(body);
          await socket.leave(roomChannel(body.roomId));
          respond(ack, ackOk({ room }));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.RECONNECT_PLAYER,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(reconnectPlayerRequestSchema, payload);
          const result = await deps.roomManager.reconnectPlayer(body, socket.id);
          await socket.join(roomChannel(body.roomId));
          socket.emit(SERVER_EVENTS.ROOM_JOINED, result);
          socket.emit(SERVER_EVENTS.GAME_STATE_UPDATE, {
            state: result.state
          });
          respond(ack, ackOk(result));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(
      CLIENT_EVENTS.SYNC_STATE,
      async (payload: unknown, ack?: AckCallback<unknown>) => {
        try {
          if (deps === undefined) {
            throw new AppError("SERVICE_UNAVAILABLE", "Room service is unavailable", 503);
          }

          const body = parsePayload(syncStateRequestSchema, payload);
          const result = await deps.roomManager.syncState(body);
          respond(ack, ackOk(result));
        } catch (error) {
          const payload = toErrorPayload(error);
          socket.emit(SERVER_EVENTS.ERROR, payload);
          respond(ack, ackFail(payload));
        }
      }
    );

    socket.on(CLIENT_EVENTS.PING, (payload: unknown, ack?: AckCallback<unknown>) => {
      try {
        const body = parsePayload(pingRequestSchema, payload ?? {});
        const data = {
          clientTime: body.clientTime,
          serverTime: new Date().toISOString()
        };
        socket.emit(SERVER_EVENTS.PONG, data);
        respond(ack, ackOk(data));
      } catch (error) {
        const payload = toErrorPayload(error);
        socket.emit(SERVER_EVENTS.ERROR, payload);
        respond(ack, ackFail(payload));
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "Socket disconnected");
      void deps?.roomManager.handleSocketDisconnect(socket.id).catch((error: unknown) => {
        logger.error({ err: error, socketId: socket.id }, "Disconnect handling failed");
      });
    });
  });

  return io;
}
