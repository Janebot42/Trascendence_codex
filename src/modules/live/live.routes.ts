import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { securityConfig } from '../../config/security.js';
import type { ChatService } from '../chat/chat.service.js';
import type { MatchesService } from '../matches/matches.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { UsersService } from '../users/users.service.js';
import type { User } from '../users/users.types.js';

type LiveSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'message', listener: (message: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
};

type PlayerInput = {
  up: boolean;
  down: boolean;
};

type GameRoom = {
  id: string;
  players: [string, string];
  botUserId: string | null;
  botDifficulty: number;
  inputs: Record<string, PlayerInput>;
  paddleY: Record<string, number>;
  scores: Record<string, number>;
  ball: { x: number; y: number; vx: number; vy: number };
  status: 'playing' | 'finished';
  startedAt: number;
  disconnectedAt: Record<string, number | null>;
  timer: NodeJS.Timeout;
};

const OPEN = 1;
const TARGET_SCORE = 5;
const BOARD_HALF_WIDTH = 6;
const BOARD_HALF_HEIGHT = 3.5;
const PADDLE_HALF_HEIGHT = 0.8;
const PADDLE_SPEED = 6;
const BALL_RADIUS = 0.15;
const TICK_MS = 33;
const BOT_FALLBACK_MS = 2500;
const BOT_USERNAME = 'pongbot';
const BOT_SETTINGS: Record<number, { speed: number; error: number; deadZone: number; reactionMs: number }> = {
  1: { speed: 2.4, error: 1.15, deadZone: 0.48, reactionMs: 360 },
  2: { speed: 3.1, error: 0.85, deadZone: 0.38, reactionMs: 280 },
  3: { speed: 3.8, error: 0.58, deadZone: 0.3, reactionMs: 210 },
  4: { speed: 4.7, error: 0.34, deadZone: 0.23, reactionMs: 150 },
  5: { speed: 5.4, error: 0.2, deadZone: 0.17, reactionMs: 100 }
};

export class LiveHub {
  private readonly socketsByUser = new Map<string, Set<LiveSocket>>();
  private readonly queue: string[] = [];
  private readonly queueTimers = new Map<string, NodeJS.Timeout>();
  private readonly botDifficultyByUser = new Map<string, number>();
  private readonly rooms = new Map<string, GameRoom>();
  private readonly roomByUser = new Map<string, string>();
  private botUserId: string | null = null;

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly usersService: UsersService,
    private readonly matchesService: MatchesService,
    private readonly chatService: ChatService
  ) {}

  getOnlineUserIds(): Set<string> {
    return new Set(this.socketsByUser.keys());
  }

  async register(app: FastifyInstance): Promise<void> {
    await app.register(websocket);

    app.get('/ws', { websocket: true }, async (socket: LiveSocket, request: FastifyRequest) => {
      const user = await this.authenticate(request);
      if (!user) {
        socket.close();
        return;
      }

      this.addSocket(user.id, socket);
      this.send(socket, 'session:ready', {
        user,
        onlineUserIds: [...this.getOnlineUserIds()],
        room: this.getUserRoomSnapshot(user.id)
      });
      this.broadcast('presence:update', { onlineUserIds: [...this.getOnlineUserIds()] });

      socket.on('message', (message) => {
        void this.handleMessage(user, socket, message.toString());
      });
      socket.on('close', () => {
        this.removeSocket(user.id, socket);
      });
    });
  }

  private async authenticate(request: FastifyRequest): Promise<User | null> {
    const token = request.cookies[securityConfig.cookieName];
    if (!token) return null;
    const session = await this.sessionsService.getSessionFromToken(token);
    return session?.user ?? null;
  }

  private addSocket(userId: string, socket: LiveSocket): void {
    const sockets = this.socketsByUser.get(userId) ?? new Set<LiveSocket>();
    sockets.add(socket);
    this.socketsByUser.set(userId, sockets);
    const room = this.getUserRoom(userId);
    if (room) {
      room.disconnectedAt[userId] = null;
      this.broadcastRoom(room, 'game:resume', { userId });
    }
  }

  private removeSocket(userId: string, socket: LiveSocket): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size > 0) return;

    this.socketsByUser.delete(userId);
    this.leaveQueue(userId);
    const room = this.getUserRoom(userId);
    if (room && room.status === 'playing') {
      room.disconnectedAt[userId] = Date.now();
      this.broadcastRoom(room, 'game:pause', { userId, reconnectSeconds: 15 });
    }
    this.broadcast('presence:update', { onlineUserIds: [...this.getOnlineUserIds()] });
  }

  private async handleMessage(user: User, socket: LiveSocket, raw: string): Promise<void> {
    let message: { type?: string; payload?: Record<string, unknown> };
    try {
      message = JSON.parse(raw);
    } catch {
      this.send(socket, 'error', { message: 'Invalid message' });
      return;
    }

    const payload = message.payload ?? {};
    if (message.type === 'chat:send') {
      const body = String(payload.body ?? '').trim();
      if (!body) return;
      const chatMessage = await this.chatService.postLobbyMessage(user.id, body.slice(0, 1000));
      this.broadcast('chat:message', { message: chatMessage });
      return;
    }

    if (message.type === 'chat:typing') {
      this.broadcastExcept(user.id, 'chat:typing', { userId: user.id });
      return;
    }

    if (message.type === 'chat:invite') {
      const toUserId = String(payload.toUserId ?? '');
      if (!toUserId || (await this.usersService.isBlockedBetween(user.id, toUserId))) return;
      this.sendToUser(toUserId, 'chat:invite', { fromUserId: user.id });
      return;
    }

    if (message.type === 'queue:join') {
      this.botDifficultyByUser.set(user.id, normalizeDifficulty(payload.botDifficulty));
      await this.joinQueue(user.id);
      return;
    }

    if (message.type === 'queue:leave') {
      this.leaveQueue(user.id);
      this.send(socket, 'queue:update', { queued: false });
      return;
    }

    if (message.type === 'game:input') {
      const room = this.getUserRoom(user.id);
      if (!room || room.status !== 'playing') return;
      room.inputs[user.id] = { up: Boolean(payload.up), down: Boolean(payload.down) };
      return;
    }
  }

  private async joinQueue(userId: string): Promise<void> {
    if (this.roomByUser.has(userId)) return;
    if (!this.queue.includes(userId)) this.queue.push(userId);
    this.sendToUser(userId, 'queue:update', { queued: true, botFallbackSeconds: Math.ceil(BOT_FALLBACK_MS / 1000) });

    while (this.queue.length >= 2) {
      const left = this.queue.shift()!;
      const right = this.queue.shift()!;
      if (left === right || this.roomByUser.has(left) || this.roomByUser.has(right)) continue;
      this.clearQueueTimer(left);
      this.clearQueueTimer(right);
      this.botDifficultyByUser.delete(left);
      this.botDifficultyByUser.delete(right);
      this.startRoom(left, right);
      return;
    }

    if (!this.queueTimers.has(userId)) {
      const timer = setTimeout(() => {
        void this.startBotMatch(userId);
      }, BOT_FALLBACK_MS);
      this.queueTimers.set(userId, timer);
    }
  }

  private leaveQueue(userId: string): void {
    const index = this.queue.indexOf(userId);
    if (index >= 0) this.queue.splice(index, 1);
    this.clearQueueTimer(userId);
    this.botDifficultyByUser.delete(userId);
  }

  private clearQueueTimer(userId: string): void {
    const timer = this.queueTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.queueTimers.delete(userId);
  }

  private async startBotMatch(userId: string): Promise<void> {
    if (!this.queue.includes(userId) || this.roomByUser.has(userId)) return;
    const botDifficulty = this.botDifficultyByUser.get(userId) ?? 3;
    this.leaveQueue(userId);
    const botUserId = await this.ensureBotUser();
    this.startRoom(userId, botUserId, botUserId, botDifficulty);
  }

  private async ensureBotUser(): Promise<string> {
    if (this.botUserId) return this.botUserId;
    const existing = await this.usersService.findByUsername(BOT_USERNAME);
    if (existing) {
      this.botUserId = existing.id;
      return existing.id;
    }
    const bot = await this.usersService.createUser({
      username: BOT_USERNAME,
      email: null,
      displayName: 'Pong Bot'
    });
    this.botUserId = bot.id;
    return bot.id;
  }

  private startRoom(leftUserId: string, rightUserId: string, botUserId: string | null = null, botDifficulty = 3): void {
    const roomId = `match_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const room: GameRoom = {
      id: roomId,
      players: [leftUserId, rightUserId],
      botUserId,
      botDifficulty,
      inputs: {
        [leftUserId]: { up: false, down: false },
        [rightUserId]: { up: false, down: false }
      },
      paddleY: { [leftUserId]: 0, [rightUserId]: 0 },
      scores: { [leftUserId]: 0, [rightUserId]: 0 },
      ball: { x: 0, y: 0, vx: 4.3, vy: 2.1 },
      status: 'playing',
      startedAt: Date.now(),
      disconnectedAt: { [leftUserId]: null, [rightUserId]: null },
      timer: setInterval(() => {
        void this.tick(roomId);
      }, TICK_MS)
    };
    this.rooms.set(roomId, room);
    this.roomByUser.set(leftUserId, roomId);
    this.roomByUser.set(rightUserId, roomId);
    this.broadcastRoom(room, 'game:start', this.snapshot(room));
  }

  private async tick(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    const now = Date.now();
    for (const playerId of room.players) {
      if (playerId === room.botUserId) continue;
      const disconnectedAt = room.disconnectedAt[playerId];
      if (disconnectedAt && now - disconnectedAt > 15000) {
        const winnerId = room.players.find((id) => id !== playerId)!;
        room.scores[winnerId] = TARGET_SCORE;
        await this.finishRoom(room);
        return;
      }
    }

    if (room.players.some((playerId) => room.disconnectedAt[playerId])) return;

    const dt = TICK_MS / 1000;
    this.updateBotInput(room);
    for (const playerId of room.players) {
      const input = room.inputs[playerId];
      const direction = input.up ? 1 : input.down ? -1 : 0;
      const speed = playerId === room.botUserId ? BOT_SETTINGS[room.botDifficulty].speed : PADDLE_SPEED;
      room.paddleY[playerId] = clamp(
        room.paddleY[playerId] + direction * speed * dt,
        -BOARD_HALF_HEIGHT + PADDLE_HALF_HEIGHT,
        BOARD_HALF_HEIGHT - PADDLE_HALF_HEIGHT
      );
    }

    room.ball.x += room.ball.vx * dt;
    room.ball.y += room.ball.vy * dt;

    if (room.ball.y > BOARD_HALF_HEIGHT - BALL_RADIUS || room.ball.y < -BOARD_HALF_HEIGHT + BALL_RADIUS) {
      room.ball.vy *= -1;
      room.ball.y = clamp(room.ball.y, -BOARD_HALF_HEIGHT + BALL_RADIUS, BOARD_HALF_HEIGHT - BALL_RADIUS);
    }

    this.handlePaddleCollision(room, room.players[0], -BOARD_HALF_WIDTH + 0.5, 1);
    this.handlePaddleCollision(room, room.players[1], BOARD_HALF_WIDTH - 0.5, -1);

    if (room.ball.x < -BOARD_HALF_WIDTH) this.score(room, room.players[1]);
    if (room.ball.x > BOARD_HALF_WIDTH) this.score(room, room.players[0]);

    if (Object.values(room.scores).some((score) => score >= TARGET_SCORE)) {
      await this.finishRoom(room);
      return;
    }

    this.broadcastRoom(room, 'game:state', this.snapshot(room));
  }

  private handlePaddleCollision(room: GameRoom, playerId: string, paddleX: number, direction: number): void {
    const ball = room.ball;
    const isNearPaddle = Math.abs(ball.x - paddleX) < 0.25;
    const isInsidePaddle = Math.abs(ball.y - room.paddleY[playerId]) < PADDLE_HALF_HEIGHT + BALL_RADIUS;
    const movingTowardPaddle = Math.sign(ball.vx) === -direction;
    if (!isNearPaddle || !isInsidePaddle || !movingTowardPaddle) return;

    const offset = (ball.y - room.paddleY[playerId]) / PADDLE_HALF_HEIGHT;
    ball.vx = direction * Math.min(7.5, Math.abs(ball.vx) + 0.25);
    ball.vy = offset * 4.2;
    ball.x = paddleX + direction * 0.25;
  }

  private score(room: GameRoom, scorerId: string): void {
    room.scores[scorerId] += 1;
    const direction = scorerId === room.players[0] ? -1 : 1;
    room.ball = { x: 0, y: 0, vx: direction * 4.2, vy: (Math.random() > 0.5 ? 1 : -1) * 2 };
    room.paddleY[room.players[0]] = 0;
    room.paddleY[room.players[1]] = 0;
  }

  private updateBotInput(room: GameRoom): void {
    if (!room.botUserId) return;
    const settings = BOT_SETTINGS[room.botDifficulty];
    const laggedTime = Date.now() - settings.reactionMs;
    const botTarget =
      room.ball.y +
      Math.sin(laggedTime / 240) * settings.error +
      (room.ball.vx < 0 ? Math.sin(laggedTime / 510) * settings.error * 0.45 : 0);
    const current = room.paddleY[room.botUserId];
    room.inputs[room.botUserId] = {
      up: botTarget > current + settings.deadZone,
      down: botTarget < current - settings.deadZone
    };
  }

  private async finishRoom(room: GameRoom): Promise<void> {
    room.status = 'finished';
    clearInterval(room.timer);
    const match = await this.matchesService.createFinishedMatch({
      players: room.players.map((userId) => ({ userId, score: room.scores[userId] }))
    });
    this.broadcastRoom(room, 'game:finished', { ...this.snapshot(room), match });
    for (const playerId of room.players) this.roomByUser.delete(playerId);
    this.rooms.delete(room.id);
  }

  private getUserRoom(userId: string): GameRoom | null {
    const roomId = this.roomByUser.get(userId);
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  private getUserRoomSnapshot(userId: string) {
    const room = this.getUserRoom(userId);
    return room ? this.snapshot(room) : null;
  }

  private snapshot(room: GameRoom) {
    return {
      id: room.id,
      players: room.players,
      scores: room.scores,
      paddleY: room.paddleY,
      ball: room.ball,
      status: room.status,
      botUserId: room.botUserId,
      botDifficulty: room.botDifficulty,
      targetScore: TARGET_SCORE,
      board: { halfWidth: BOARD_HALF_WIDTH, halfHeight: BOARD_HALF_HEIGHT }
    };
  }

  private broadcastRoom(room: GameRoom, type: string, payload: unknown): void {
    for (const playerId of room.players) this.sendToUser(playerId, type, payload);
  }

  private broadcast(type: string, payload: unknown): void {
    for (const sockets of this.socketsByUser.values()) {
      for (const socket of sockets) this.send(socket, type, payload);
    }
  }

  private broadcastExcept(userId: string, type: string, payload: unknown): void {
    for (const [targetUserId, sockets] of this.socketsByUser.entries()) {
      if (targetUserId === userId) continue;
      for (const socket of sockets) this.send(socket, type, payload);
    }
  }

  private sendToUser(userId: string, type: string, payload: unknown): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    for (const socket of sockets) this.send(socket, type, payload);
  }

  private send(socket: LiveSocket, type: string, payload: unknown): void {
    if (socket.readyState !== OPEN) return;
    socket.send(JSON.stringify({ type, payload }));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDifficulty(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 3;
  return clamp(parsed, 1, 5);
}
