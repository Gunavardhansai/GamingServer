import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { io as createClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { createSocketServer } from "../src/realtime/socketServer.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../src/shared/contracts.js";

describe("Socket.IO server", () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it("emits SERVER_READY and responds to PING", async () => {
    const httpServer = createServer(createApp());
    const io = createSocketServer(httpServer);
    servers.push(io, httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });

    const address = httpServer.address() as AddressInfo;
    const client = createClientSocket(`http://127.0.0.1:${address.port}`, {
      transports: ["websocket"]
    });
    servers.push(client);

    const ready = await new Promise<Record<string, unknown>>((resolve) => {
      client.on(SERVER_EVENTS.SERVER_READY, resolve);
    });

    expect(ready.socketId).toEqual(expect.any(String));

    const pong = await new Promise<unknown>((resolve) => {
      client.emit(CLIENT_EVENTS.PING, {}, resolve);
    });

    expect(pong).toMatchObject({
      ok: true,
      data: {
        serverTime: expect.any(String)
      }
    });
  });
});
