# Database Design

## Default Room Size

The default room size is 8 players, with a minimum of 2. Eight keeps real-time broadcast fanout predictable while still supporting free-for-all and team battle modes. At a 10 Hz authoritative tick rate, one room broadcasts a small, bounded state stream to at most 8 sockets, which is easier to shard and recover than very large rooms.

## Persistence Strategy

PostgreSQL stores durable identity, room membership, authoritative snapshots, and action history. Redis will be added later for hot room state, matchmaking queues, pub/sub, and reconnect/session TTLs.

## Main Tables

- `players`: durable player identity, status, rating, stats, and current room pointer.
- `rooms`: room metadata, direct join code, lifecycle status, capacity, tick rate, and optimistic version.
- `room_players`: membership, seat assignment, ready/disconnect state, combat health, and reconnect token hash.
- `game_states`: versioned room snapshots for recovery and late reconnect synchronization.
- `game_actions`: idempotent player action log keyed by room, player, action id, and sequence.

## Recovery Notes

`game_states.version` and `game_actions.seq` let a recovering server rebuild or validate state after a crash. `room_players.reconnectTokenHash` supports secure reconnect without trusting socket ids.
