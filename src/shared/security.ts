import { createHash, randomBytes } from "node:crypto";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    const byte = randomBytes(1).at(0) ?? 0;
    const randomIndex = byte % ROOM_CODE_ALPHABET.length;
    code += ROOM_CODE_ALPHABET[randomIndex];
  }

  return code;
}

export function generateReconnectToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashReconnectToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
