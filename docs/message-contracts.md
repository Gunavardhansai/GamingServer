# Message Contracts

All command events support a Socket.IO acknowledgement:

```json
{ "ok": true, "data": {} }
```

or:

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid event payload" } }
```

## Client Events

### CREATE_ROOM

```json
{
  "player": {
    "externalId": "auth-provider-id",
    "displayName": "Sai"
  },
  "visibility": "PUBLIC",
  "maxPlayers": 8,
  "minPlayers": 2
}
```

### JOIN_ROOM

```json
{
  "roomCode": "AB12CD",
  "player": {
    "externalId": "player-2",
    "displayName": "Rival"
  }
}
```

`roomId` may be used instead of `roomCode`.

### FIND_MATCH

```json
{
  "player": {
    "externalId": "player-3",
    "displayName": "Matcher"
  },
  "maxPlayers": 8
}
```

### PLAYER_READY

```json
{
  "roomId": "2b1adf0d-1d57-48c8-86b2-cd1f9de75001",
  "playerId": "14dd5caf-daa0-49d0-a045-9b12f72112dd",
  "isReady": true
}
```

### START_GAME

```json
{
  "roomId": "2b1adf0d-1d57-48c8-86b2-cd1f9de75001",
  "playerId": "14dd5caf-daa0-49d0-a045-9b12f72112dd"
}
```

### PLAYER_MOVE

```json
{
  "roomId": "2b1adf0d-1d57-48c8-86b2-cd1f9de75001",
  "playerId": "14dd5caf-daa0-49d0-a045-9b12f72112dd",
  "actionId": "client-uuid-or-ulid-0001",
  "seq": 1,
  "roundNumber": 1,
  "turnNumber": 1,
  "type": "ATTACK",
  "targetPlayerId": "0498e44d-7e98-4a89-a05d-268d50e90b31",
  "power": 1,
  "clientTime": "2026-05-02T17:30:00.000Z"
}
```

Valid move types: `ATTACK`, `DEFEND`, `SPECIAL`, `HEAL`, `PASS`.

### LEAVE_ROOM

```json
{
  "roomId": "2b1adf0d-1d57-48c8-86b2-cd1f9de75001",
  "playerId": "14dd5caf-daa0-49d0-a045-9b12f72112dd",
  "reason": "client_exit"
}
```

### RECONNECT_PLAYER

```json
{
  "roomId": "2b1adf0d-1d57-48c8-86b2-cd1f9de75001",
  "playerId": "14dd5caf-daa0-49d0-a045-9b12f72112dd",
  "reconnectToken": "token-returned-by-create-or-join",
  "lastSeenVersion": 8
}
```

### SYNC_STATE

```json
{
  "roomId": "2b1adf0d-1d57-48c8-86b2-cd1f9de75001",
  "playerId": "14dd5caf-daa0-49d0-a045-9b12f72112dd",
  "lastSeenVersion": 8
}
```

## Server Events

- `SERVER_READY`: emitted after socket connection.
- `ROOM_JOINED`: sent to the joining socket with room, player, and reconnect token.
- `ROOM_UPDATED`: broadcast to room when membership changes.
- `GAME_STARTING`: broadcast before countdown.
- `GAME_STARTED`: broadcast with initial authoritative state.
- `GAME_STATE_UPDATE`: broadcast with latest authoritative state.
- `ACTION_ACCEPTED`: broadcast when a move is applied.
- `ACTION_REJECTED`: sent when a move fails validation or turn rules.
- `PLAYER_LEFT`: broadcast when a player leaves.
- `PLAYER_DISCONNECTED`: broadcast when a socket drops.
- `PLAYER_RECONNECTED`: broadcast after reconnect token verification.
- `GAME_OVER`: broadcast with winner and final state.
- `ERROR`: command or validation error.
- `PONG`: response to `PING`.

## Edge Case Behavior

- Duplicate actions are rejected or replay-acknowledged using `actionId` and `seq`.
- Late joiners are rejected after room status leaves `WAITING` or `STARTING`.
- Network-delayed moves are rejected when `roundNumber` or `turnNumber` is stale.
- Disconnected players remain recoverable during the reconnect grace window.
- A crashed server recovers the latest state snapshot and resumes active loops.
