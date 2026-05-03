import type { Server } from "socket.io";

export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

export class RealtimeGateway {
  private io?: Server;

  public setServer(io: Server): void {
    this.io = io;
  }

  public emitToRoom(roomId: string, event: string, payload: unknown): void {
    this.io?.to(roomChannel(roomId)).emit(event, payload);
  }

  public emitToSocket(socketId: string, event: string, payload: unknown): void {
    this.io?.to(socketId).emit(event, payload);
  }
}
