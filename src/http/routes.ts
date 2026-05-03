import type { Express } from "express";
import type { z } from "zod";
import type { AppDependencies } from "../bootstrap/dependencies.js";
import {
  createPlayerRequestSchema,
  createRoomRequestSchema,
  findMatchRequestSchema,
  joinRoomRequestSchema,
  leaveRoomRequestSchema,
  playerReadyRequestSchema,
  startGameRequestSchema
} from "../shared/contracts.js";
import { AppError } from "../shared/errors.js";
import { asyncHandler } from "./asyncHandler.js";

function routeParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string") {
    throw new AppError("ROUTE_PARAM_REQUIRED", `${name} is required`, 400);
  }

  return value;
}

function parseBody<TSchema extends z.ZodType>(
  schema: TSchema,
  body: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request body", 400, {
      issues: result.error.issues
    });
  }

  return result.data;
}

export function registerRoutes(app: Express, deps: AppDependencies): void {
  app.post(
    "/players",
    asyncHandler(async (req, res) => {
      const body = parseBody(createPlayerRequestSchema, req.body);
      const player = await deps.roomManager.createPlayer(body);
      res.status(201).json({ player });
    })
  );

  app.post(
    "/rooms",
    asyncHandler(async (req, res) => {
      const body = parseBody(createRoomRequestSchema, req.body);
      const result = await deps.roomManager.createRoom(body);
      res.status(201).json(result);
    })
  );

  app.get(
    "/rooms/:roomId",
    asyncHandler(async (req, res) => {
      const roomId = routeParam(req.params.roomId, "roomId");
      const room = await deps.roomManager.getRoom(roomId);
      res.status(200).json({ room });
    })
  );

  app.post(
    "/rooms/join",
    asyncHandler(async (req, res) => {
      const body = parseBody(joinRoomRequestSchema, req.body);
      const result = await deps.roomManager.joinRoom(body);
      res.status(200).json(result);
    })
  );

  app.post(
    "/matchmaking/find",
    asyncHandler(async (req, res) => {
      const body = parseBody(findMatchRequestSchema, req.body);
      const result = await deps.roomManager.findMatch(body);
      res.status(200).json(result);
    })
  );

  app.post(
    "/rooms/:roomId/ready",
    asyncHandler(async (req, res) => {
      const body = parseBody(playerReadyRequestSchema, {
        ...req.body,
        roomId: routeParam(req.params.roomId, "roomId")
      });
      const room = await deps.roomManager.setReady(body);
      res.status(200).json({ room });
    })
  );

  app.post(
    "/rooms/:roomId/start",
    asyncHandler(async (req, res) => {
      const body = parseBody(startGameRequestSchema, {
        ...req.body,
        roomId: routeParam(req.params.roomId, "roomId")
      });
      const result = await deps.roomManager.startGame(body);
      res.status(200).json(result);
    })
  );

  app.post(
    "/rooms/:roomId/leave",
    asyncHandler(async (req, res) => {
      const body = parseBody(leaveRoomRequestSchema, {
        ...req.body,
        roomId: routeParam(req.params.roomId, "roomId")
      });
      const room = await deps.roomManager.leaveRoom(body);
      res.status(200).json({ room });
    })
  );
}
