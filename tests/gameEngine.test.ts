import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/game/gameEngine.js";

const roomId = "00000000-0000-4000-8000-000000000001";
const playerOne = "00000000-0000-4000-8000-000000000101";
const playerTwo = "00000000-0000-4000-8000-000000000102";

function createState() {
  return new GameEngine().createInitialState({
    roomId,
    tickRate: 10,
    turnDurationMs: 10000,
    now: new Date("2026-05-02T17:00:00.000Z"),
    participants: [
      {
        playerId: playerOne,
        displayName: "One",
        seatNumber: 1
      },
      {
        playerId: playerTwo,
        displayName: "Two",
        seatNumber: 2
      }
    ]
  });
}

describe("GameEngine", () => {
  it("applies a valid attack and advances the turn", () => {
    const engine = new GameEngine();
    const result = engine.applyAction(
      createState(),
      {
        actionId: "attack-0001",
        playerId: playerOne,
        seq: 1,
        roundNumber: 1,
        turnNumber: 1,
        type: "ATTACK",
        targetPlayerId: playerTwo,
        power: 1
      },
      new Date("2026-05-02T17:00:01.000Z")
    );

    expect(result.accepted).toBe(true);
    expect(result.state.players[playerTwo]?.health).toBe(82);
    expect(result.state.currentTurnPlayerId).toBe(playerTwo);
    expect(result.state.turnNumber).toBe(2);
  });

  it("rejects duplicate action ids", () => {
    const engine = new GameEngine();
    const first = engine.applyAction(
      createState(),
      {
        actionId: "attack-0001",
        playerId: playerOne,
        seq: 1,
        roundNumber: 1,
        turnNumber: 1,
        type: "ATTACK",
        targetPlayerId: playerTwo,
        power: 1
      },
      new Date("2026-05-02T17:00:01.000Z")
    );

    expect(first.accepted).toBe(true);

    const second = engine.applyAction(
      first.state,
      {
        actionId: "attack-0001",
        playerId: playerTwo,
        seq: 1,
        roundNumber: 1,
        turnNumber: 2,
        type: "ATTACK",
        targetPlayerId: playerOne,
        power: 1
      },
      new Date("2026-05-02T17:00:02.000Z")
    );

    expect(second.accepted).toBe(false);
    expect(second.accepted ? undefined : second.code).toBe("DUPLICATE_ACTION");
  });

  it("passes the turn on timeout", () => {
    const engine = new GameEngine();
    const result = engine.processTick(
      createState(),
      new Date("2026-05-02T17:00:11.000Z")
    );

    expect(result.changed).toBe(true);
    expect(result.state.currentTurnPlayerId).toBe(playerTwo);
    expect(result.event?.type).toBe("turn_timeout");
  });
});
