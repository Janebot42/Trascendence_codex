import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { securityConfig } from './config/security.js';
import { configureSqliteForConcurrency, createPrismaClient } from './db/prisma.js';
import { AppError } from './shared/errors/AppError.js';
import { SecretBox } from './shared/crypto/encryption.js';
import { ScryptPasswordHasher } from './shared/crypto/passwordHasher.js';
import { InMemoryUsersRepository } from './modules/users/users.repository.js';
import { PrismaUsersRepository } from './modules/users/users.prismaRepository.js';
import { UsersService } from './modules/users/users.service.js';
import { InMemorySessionsRepository } from './modules/sessions/sessions.repository.js';
import { PrismaSessionsRepository } from './modules/sessions/sessions.prismaRepository.js';
import { SessionsService } from './modules/sessions/sessions.service.js';
import { InMemoryAuthRepository } from './modules/auth/auth.repository.js';
import { PrismaAuthRepository } from './modules/auth/auth.prismaRepository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { InMemoryTwoFactorRepository } from './modules/two_factor/twoFactor.repository.js';
import { PrismaTwoFactorRepository } from './modules/two_factor/twoFactor.prismaRepository.js';
import { TotpService } from './modules/two_factor/totp.service.js';
import { RecoveryCodesService } from './modules/two_factor/recoveryCodes.service.js';
import { TwoFactorService } from './modules/two_factor/twoFactor.service.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerTwoFactorRoutes } from './modules/two_factor/twoFactor.routes.js';
import { registerUserRoutes } from './modules/users/users.routes.js';
import { registerUiRoutes } from './ui/ui.routes.js';
import { InMemoryOAuthRepository } from './modules/oauth/oauth.repository.js';
import { PrismaOAuthRepository } from './modules/oauth/oauth.prismaRepository.js';
import { OAuthService } from './modules/oauth/oauth.service.js';
import { registerOAuthRoutes } from './modules/oauth/oauth.routes.js';
import { InMemoryMatchesRepository } from './modules/matches/matches.repository.js';
import { PrismaMatchesRepository } from './modules/matches/matches.prismaRepository.js';
import { MatchesService } from './modules/matches/matches.service.js';
import { registerMatchRoutes } from './modules/matches/matches.routes.js';
import { InMemoryChatRepository } from './modules/chat/chat.repository.js';
import { PrismaChatRepository } from './modules/chat/chat.prismaRepository.js';
import { ChatService } from './modules/chat/chat.service.js';
import { registerChatRoutes } from './modules/chat/chat.routes.js';
import { LiveHub } from './modules/live/live.routes.js';

export async function buildApp() {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const rawBody = body.toString();
    if (!rawBody.trim()) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error);
    }
  });

  await app.register(cookie);

  const prisma = createPrismaClient();
  if (prisma) {
    await configureSqliteForConcurrency(prisma);
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }

  const usersRepository = prisma ? new PrismaUsersRepository(prisma) : new InMemoryUsersRepository();
  const usersService = new UsersService(usersRepository);
  const sessionsRepository = prisma ? new PrismaSessionsRepository(prisma) : new InMemorySessionsRepository();
  const authRepository = prisma ? new PrismaAuthRepository(prisma) : new InMemoryAuthRepository();
  const twoFactorRepository = prisma ? new PrismaTwoFactorRepository(prisma) : new InMemoryTwoFactorRepository();
  const oauthRepository = prisma ? new PrismaOAuthRepository(prisma) : new InMemoryOAuthRepository();
  const matchesRepository = prisma ? new PrismaMatchesRepository(prisma) : new InMemoryMatchesRepository();
  const chatRepository = prisma ? new PrismaChatRepository(prisma) : new InMemoryChatRepository();
  const sessionsService = new SessionsService(sessionsRepository, usersService);
  const totpService = new TotpService(new SecretBox(securityConfig.totpEncryptionKeyBase64));
  const recoveryCodesService = new RecoveryCodesService(twoFactorRepository);
  const twoFactorService = new TwoFactorService(
    twoFactorRepository,
    usersService,
    totpService,
    recoveryCodesService
  );
  const authService = new AuthService(
    usersService,
    authRepository,
    new ScryptPasswordHasher(),
    sessionsService,
    twoFactorService
  );
  const oauthService = new OAuthService(oauthRepository, usersService, authService, authRepository);
  const matchesService = new MatchesService(matchesRepository, usersService);
  const chatService = new ChatService(chatRepository, usersService);
  const liveHub = new LiveHub(sessionsService, usersService, matchesService, chatService);

  if (env.NODE_ENV === 'test') {
    app.decorate('testContext', {
      oauthRepository,
      usersService,
      authService,
      authRepository,
      twoFactorService,
      sessionsService,
      matchesService,
      chatService,
      liveHub
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Invalid request body' });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  app.get('/health', async () => ({ ok: true }));
  await registerUiRoutes(app);
  await liveHub.register(app);
  await registerAuthRoutes(app, authService, sessionsService);
  await registerOAuthRoutes(app, oauthService, sessionsService);
  await registerTwoFactorRoutes(app, twoFactorService, sessionsService);
  await registerUserRoutes(app, sessionsService, usersService, () => liveHub.getOnlineUserIds());
  await registerMatchRoutes(app, sessionsService, matchesService);
  await registerChatRoutes(app, sessionsService, chatService);

  return app;
}
