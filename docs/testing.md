# Testing

## Automated Tests

```powershell
npm run typecheck
npm run build
npm run test
```

## Manual REST Check

```powershell
Invoke-RestMethod http://localhost:3000/health
```

## Manual Socket.IO Check

Start the server, then run:

```powershell
node --input-type=module -e "import { io } from 'socket.io-client'; const s = io('http://localhost:3000'); s.on('SERVER_READY', (msg) => { console.log(msg); s.emit('PING', {}, (ack) => { console.log(ack); s.close(); process.exit(0); }); });"
```

## End-to-End Room Flow

With Docker running:

1. `CREATE_ROOM` for player one.
2. Save `room.id`, `room.code`, `player.id`, and `reconnectToken`.
3. `JOIN_ROOM` from player two with the room code.
4. Send `PLAYER_READY` for both players.
5. Send `START_GAME` from the owner.
6. Use `GAME_STATE_UPDATE.currentTurnPlayerId` to decide who sends `PLAYER_MOVE`.
