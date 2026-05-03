import { prisma } from "../db/prisma.js";
import { GameCoordinator } from "../game/gameCoordinator.js";
import { RealtimeGateway } from "../realtime/gateway.js";
import { RoomManager } from "../rooms/roomManager.js";
import { RoomRepository } from "../rooms/roomRepository.js";
import { GameStateStore } from "../state/gameStateStore.js";
import { RedisService } from "../state/redisService.js";

export interface AppDependencies {
  redis: RedisService;
  realtimeGateway: RealtimeGateway;
  roomRepository: RoomRepository;
  roomManager: RoomManager;
  gameCoordinator: GameCoordinator;
  close: () => Promise<void>;
}

export async function createDependencies(): Promise<AppDependencies> {
  const redis = new RedisService();
  await redis.connect();

  const realtimeGateway = new RealtimeGateway();
  const roomRepository = new RoomRepository(prisma);
  const gameStateStore = new GameStateStore(redis);
  const gameCoordinator = new GameCoordinator(
    roomRepository,
    gameStateStore,
    realtimeGateway
  );
  const roomManager = new RoomManager(
    roomRepository,
    gameCoordinator,
    realtimeGateway
  );

  return {
    redis,
    realtimeGateway,
    roomRepository,
    roomManager,
    gameCoordinator,
    close: async () => {
      gameCoordinator.stopAll();
      await redis.close();
      await prisma.$disconnect();
    }
  };
}
