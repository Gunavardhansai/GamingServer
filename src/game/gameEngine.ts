import { randomUUID } from "node:crypto";
import type {
  EngineAction,
  EngineActionResult,
  EngineTickResult,
  GameEvent,
  GamePlayerState,
  GameRuntimeState,
  InitialGameParticipant
} from "./types.js";

const MAX_HEALTH = 100;
const MAX_ENERGY = 100;
const ACTION_HISTORY_LIMIT = 200;

function cloneState(state: GameRuntimeState): GameRuntimeState {
  return structuredClone(state) as GameRuntimeState;
}

function isoNow(now = new Date()): string {
  return now.toISOString();
}

function eventOf(
  type: GameEvent["type"],
  message: string,
  now: Date,
  extras: Omit<GameEvent, "id" | "type" | "message" | "at"> = {}
): GameEvent {
  return {
    id: randomUUID(),
    type,
    message,
    at: isoNow(now),
    ...extras
  };
}

function getAlivePlayerIds(state: GameRuntimeState): string[] {
  return state.turnOrder.filter((playerId) => state.players[playerId]?.alive);
}

function appendEvent(state: GameRuntimeState, event: GameEvent): void {
  state.events = [...state.events, event].slice(-50);
}

function rememberAction(state: GameRuntimeState, actionId: string): void {
  state.processedActionIds = [...state.processedActionIds, actionId].slice(
    -ACTION_HISTORY_LIMIT
  );
}

function getPlayerOrReject(
  state: GameRuntimeState,
  playerId: string
): GamePlayerState | undefined {
  return state.players[playerId];
}

function finishIfNeeded(state: GameRuntimeState, now: Date): GameEvent | undefined {
  const alivePlayerIds = getAlivePlayerIds(state);

  if (alivePlayerIds.length > 1 || state.phase === "FINISHED") {
    return undefined;
  }

  const winnerPlayerId = alivePlayerIds[0];
  state.phase = "FINISHED";
  state.winnerPlayerId = winnerPlayerId;
  state.currentTurnPlayerId = undefined;
  state.turnStartedAt = undefined;
  state.turnDeadlineAt = undefined;
  state.endedAt = isoNow(now);
  state.version += 1;

  const event = eventOf(
    "game_over",
    winnerPlayerId === undefined
      ? "Game ended with no surviving players"
      : `${state.players[winnerPlayerId]?.displayName ?? "A player"} won the game`,
    now,
    { targetPlayerId: winnerPlayerId }
  );
  appendEvent(state, event);
  return event;
}

function advanceTurn(state: GameRuntimeState, now: Date): void {
  const alivePlayerIds = getAlivePlayerIds(state);

  if (alivePlayerIds.length <= 1) {
    finishIfNeeded(state, now);
    return;
  }

  const currentPlayerId = state.currentTurnPlayerId;
  const currentIndex =
    currentPlayerId === undefined ? -1 : state.turnOrder.indexOf(currentPlayerId);

  let nextIndex = currentIndex;
  for (let attempts = 0; attempts < state.turnOrder.length; attempts += 1) {
    nextIndex = (nextIndex + 1) % state.turnOrder.length;
    const candidatePlayerId = state.turnOrder[nextIndex];
    if (candidatePlayerId !== undefined && state.players[candidatePlayerId]?.alive) {
      state.currentTurnPlayerId = candidatePlayerId;
      break;
    }
  }

  if (nextIndex <= currentIndex) {
    state.roundNumber += 1;
  }

  state.turnNumber += 1;
  state.turnStartedAt = isoNow(now);
  state.turnDeadlineAt = new Date(now.getTime() + state.turnDurationMs).toISOString();
}

function applyDamage(
  state: GameRuntimeState,
  actor: GamePlayerState,
  target: GamePlayerState,
  amount: number
): number {
  const finalAmount = target.shield ? Math.ceil(amount / 2) : amount;
  target.shield = false;
  target.health = Math.max(0, target.health - finalAmount);

  if (target.health <= 0) {
    target.alive = false;
  }

  actor.energy = Math.min(MAX_ENERGY, actor.energy + 10);
  return finalAmount;
}

function reject(
  state: GameRuntimeState,
  code: string,
  message: string
): EngineActionResult {
  return { accepted: false, state, code, message };
}

export class GameEngine {
  public createInitialState(input: {
    roomId: string;
    tickRate: number;
    turnDurationMs: number;
    participants: InitialGameParticipant[];
    now?: Date;
  }): GameRuntimeState {
    const now = input.now ?? new Date();
    const participants = [...input.participants].sort(
      (left, right) => left.seatNumber - right.seatNumber
    );
    const players: Record<string, GamePlayerState> = {};

    for (const participant of participants) {
      players[participant.playerId] = {
        playerId: participant.playerId,
        displayName: participant.displayName,
        seatNumber: participant.seatNumber,
        health: participant.health ?? MAX_HEALTH,
        energy: participant.energy ?? 0,
        shield: false,
        alive: true,
        connected: participant.connected ?? true,
        lastProcessedSeq: participant.lastProcessedSeq ?? 0
      };
    }

    const firstPlayerId = participants[0]?.playerId;
    const state: GameRuntimeState = {
      roomId: input.roomId,
      phase: "ACTIVE",
      roundNumber: 1,
      turnNumber: 1,
      tick: 0,
      version: 1,
      tickRate: input.tickRate,
      turnDurationMs: input.turnDurationMs,
      turnStartedAt: isoNow(now),
      turnDeadlineAt: new Date(now.getTime() + input.turnDurationMs).toISOString(),
      currentTurnPlayerId: firstPlayerId,
      turnOrder: participants.map((participant) => participant.playerId),
      players,
      events: [],
      processedActionIds: [],
      startedAt: isoNow(now)
    };

    appendEvent(
      state,
      eventOf("game_started", "Game started", now, {
        actorPlayerId: firstPlayerId
      })
    );

    return state;
  }

  public applyAction(
    currentState: GameRuntimeState,
    action: EngineAction,
    now = new Date()
  ): EngineActionResult {
    const state = cloneState(currentState);
    const actor = getPlayerOrReject(state, action.playerId);

    if (state.phase !== "ACTIVE") {
      return reject(state, "GAME_NOT_ACTIVE", "The game is not active");
    }

    if (actor === undefined) {
      return reject(state, "PLAYER_NOT_IN_GAME", "Player is not in this game");
    }

    if (!actor.alive) {
      return reject(state, "PLAYER_ELIMINATED", "Eliminated players cannot act");
    }

    if (state.processedActionIds.includes(action.actionId)) {
      return reject(state, "DUPLICATE_ACTION", "Action was already processed");
    }

    if (action.seq <= actor.lastProcessedSeq) {
      return reject(state, "DUPLICATE_SEQUENCE", "Action sequence was already processed");
    }

    if (state.currentTurnPlayerId !== action.playerId) {
      return reject(state, "NOT_PLAYER_TURN", "It is not this player's turn");
    }

    if (
      action.roundNumber !== state.roundNumber ||
      action.turnNumber !== state.turnNumber
    ) {
      return reject(state, "STALE_TURN", "Action does not match the current turn");
    }

    if (
      state.turnDeadlineAt !== undefined &&
      now.getTime() > new Date(state.turnDeadlineAt).getTime()
    ) {
      return reject(state, "TURN_EXPIRED", "The turn deadline has passed");
    }

    let event: GameEvent;

    switch (action.type) {
      case "ATTACK": {
        if (action.targetPlayerId === undefined) {
          return reject(state, "TARGET_REQUIRED", "Attack requires a target");
        }

        const target = getPlayerOrReject(state, action.targetPlayerId);

        if (target === undefined || !target.alive) {
          return reject(state, "INVALID_TARGET", "Target is not alive in this game");
        }

        if (target.playerId === actor.playerId) {
          return reject(state, "INVALID_TARGET", "Players cannot attack themselves");
        }

        const requestedDamage = 12 + action.power * 6;
        const damage = applyDamage(state, actor, target, requestedDamage);
        event = eventOf(
          "damage",
          `${actor.displayName} dealt ${damage} damage to ${target.displayName}`,
          now,
          {
            actorPlayerId: actor.playerId,
            targetPlayerId: target.playerId,
            amount: damage
          }
        );
        break;
      }

      case "SPECIAL": {
        if (action.targetPlayerId === undefined) {
          return reject(state, "TARGET_REQUIRED", "Special attack requires a target");
        }

        const target = getPlayerOrReject(state, action.targetPlayerId);

        if (target === undefined || !target.alive) {
          return reject(state, "INVALID_TARGET", "Target is not alive in this game");
        }

        if (target.playerId === actor.playerId) {
          return reject(state, "INVALID_TARGET", "Players cannot target themselves");
        }

        if (actor.energy < 40) {
          return reject(state, "NOT_ENOUGH_ENERGY", "Special attack requires 40 energy");
        }

        actor.energy -= 40;
        const damage = applyDamage(state, actor, target, 35);
        event = eventOf(
          "damage",
          `${actor.displayName} used a special attack on ${target.displayName}`,
          now,
          {
            actorPlayerId: actor.playerId,
            targetPlayerId: target.playerId,
            amount: damage
          }
        );
        break;
      }

      case "DEFEND": {
        actor.shield = true;
        actor.energy = Math.min(MAX_ENERGY, actor.energy + 8);
        event = eventOf("defend", `${actor.displayName} is defending`, now, {
          actorPlayerId: actor.playerId
        });
        break;
      }

      case "HEAL": {
        if (actor.energy < 20) {
          return reject(state, "NOT_ENOUGH_ENERGY", "Heal requires 20 energy");
        }

        actor.energy -= 20;
        const before = actor.health;
        actor.health = Math.min(MAX_HEALTH, actor.health + 22);
        event = eventOf("heal", `${actor.displayName} healed`, now, {
          actorPlayerId: actor.playerId,
          amount: actor.health - before
        });
        break;
      }

      case "PASS": {
        actor.energy = Math.min(MAX_ENERGY, actor.energy + 12);
        event = eventOf("pass", `${actor.displayName} passed`, now, {
          actorPlayerId: actor.playerId
        });
        break;
      }
    }

    actor.lastProcessedSeq = action.seq;
    rememberAction(state, action.actionId);
    state.version += 1;
    state.tick += 1;
    appendEvent(state, event);

    const gameOverEvent = finishIfNeeded(state, now);
    if (gameOverEvent === undefined) {
      advanceTurn(state, now);
    }

    return { accepted: true, state, event };
  }

  public processTick(currentState: GameRuntimeState, now = new Date()): EngineTickResult {
    const state = cloneState(currentState);

    if (state.phase !== "ACTIVE") {
      return { changed: false, state };
    }

    state.tick += 1;

    if (
      state.turnDeadlineAt === undefined ||
      now.getTime() < new Date(state.turnDeadlineAt).getTime()
    ) {
      return { changed: false, state };
    }

    const actor =
      state.currentTurnPlayerId === undefined
        ? undefined
        : state.players[state.currentTurnPlayerId];

    if (actor === undefined || !actor.alive) {
      advanceTurn(state, now);
      state.version += 1;
      return { changed: true, state };
    }

    actor.energy = Math.min(MAX_ENERGY, actor.energy + 8);
    const event = eventOf(
      "turn_timeout",
      `${actor.displayName} timed out and passed`,
      now,
      { actorPlayerId: actor.playerId }
    );
    appendEvent(state, event);
    state.version += 1;
    advanceTurn(state, now);

    return { changed: true, state, event };
  }

  public markConnection(
    currentState: GameRuntimeState,
    playerId: string,
    connected: boolean,
    now = new Date()
  ): GameRuntimeState {
    const state = cloneState(currentState);
    const player = state.players[playerId];

    if (player === undefined) {
      return state;
    }

    player.connected = connected;
    player.disconnectedAt = connected ? undefined : isoNow(now);
    state.version += 1;

    appendEvent(
      state,
      eventOf(
        connected ? "player_reconnected" : "player_disconnected",
        `${player.displayName} ${connected ? "reconnected" : "disconnected"}`,
        now,
        { actorPlayerId: playerId }
      )
    );

    return state;
  }

  public markLeft(
    currentState: GameRuntimeState,
    playerId: string,
    now = new Date()
  ): GameRuntimeState {
    const state = cloneState(currentState);
    const player = state.players[playerId];

    if (player === undefined) {
      return state;
    }

    player.connected = false;
    player.alive = false;
    player.health = 0;
    state.version += 1;

    appendEvent(
      state,
      eventOf("player_left", `${player.displayName} left the game`, now, {
        actorPlayerId: playerId
      })
    );

    const gameOverEvent = finishIfNeeded(state, now);
    if (gameOverEvent === undefined && state.currentTurnPlayerId === playerId) {
      advanceTurn(state, now);
    }

    return state;
  }
}
