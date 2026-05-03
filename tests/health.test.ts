import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";

describe("health endpoint", () => {
  it("returns service status", async () => {
    const response = await request(createApp()).get("/health").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "battle-game-backend"
    });
    expect(response.body.time).toEqual(expect.any(String));
  });
});
