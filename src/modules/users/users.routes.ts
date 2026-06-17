import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../authorization/requireAuth.js';
import { requireRole } from '../authorization/requireRole.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { UsersService } from './users.service.js';

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  avatarUrl: z
    .string()
    .trim()
    .max(360000)
    .refine(
      (value) => value === '' || value.startsWith('data:image/png;base64,') || value.startsWith('data:image/jpeg;base64,') || value.startsWith('data:image/gif;base64,') || z.string().url().safeParse(value).success,
      'Avatar must be a PNG, JPG, GIF data URL or a valid URL'
    )
    .nullable()
    .optional(),
  bio: z.string().trim().max(280).nullable().optional()
});

const userIdParamSchema = z.object({ userId: z.string().min(1) });

export async function registerUserRoutes(
  app: FastifyInstance,
  sessionsService: SessionsService,
  usersService: UsersService,
  getOnlineUserIds: () => Set<string> = () => new Set()
) {
  app.get('/me', { preHandler: requireAuth(sessionsService) }, async (request) => ({
    user: request.currentUser
  }));

  app.patch('/me/profile', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const body = updateProfileSchema.parse(request.body);
    const user = await usersService.updateProfile(request.currentUser!.id, body);
    return { user };
  });

  app.get('/users', { preHandler: requireAuth(sessionsService) }, async () => ({
    users: await usersService.listPublicProfiles(getOnlineUserIds())
  }));

  app.get('/users/:userId/profile', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = userIdParamSchema.parse(request.params);
    return { user: await usersService.getPublicProfile(params.userId, getOnlineUserIds()) };
  });

  app.post('/users/:userId/friends', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = userIdParamSchema.parse(request.params);
    const friendship = await usersService.sendFriendRequest(request.currentUser!.id, params.userId);
    return { friendship };
  });

  app.post('/users/:userId/friends/accept', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = userIdParamSchema.parse(request.params);
    const friendship = await usersService.acceptFriendRequest(request.currentUser!.id, params.userId);
    return { friendship };
  });

  app.delete('/users/:userId/friends', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = userIdParamSchema.parse(request.params);
    await usersService.removeFriendship(request.currentUser!.id, params.userId);
    return { ok: true };
  });

  app.get('/me/friends', { preHandler: requireAuth(sessionsService) }, async (request) => ({
    friendships: await usersService.listFriendships(request.currentUser!.id)
  }));

  app.post('/users/:userId/block', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = userIdParamSchema.parse(request.params);
    await usersService.blockUser(request.currentUser!.id, params.userId);
    return { ok: true };
  });

  app.delete('/users/:userId/block', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = userIdParamSchema.parse(request.params);
    await usersService.unblockUser(request.currentUser!.id, params.userId);
    return { ok: true };
  });

  app.get(
    '/admin/users',
    { preHandler: [requireAuth(sessionsService), requireRole('admin')] },
    async () => ({ users: await usersService.listUsers() })
  );
}
