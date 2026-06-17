import type { FastifyInstance, FastifyRequest } from 'fastify';
import { clearOAuthStateCookie, setOAuthStateCookie, setSessionCookie } from '../../shared/http/cookies.js';
import { securityConfig } from '../../config/security.js';
import { forbidden } from '../../shared/errors/httpErrors.js';
import { requireAuth } from '../authorization/requireAuth.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { OAuthService } from './oauth.service.js';

function getUserAgent(header: string | string[] | undefined): string | null {
  if (!header) return null;
  return Array.isArray(header) ? header.join(', ') : header;
}

function toPublicResult(result: Awaited<ReturnType<OAuthService['completeFortyTwoCallback']>>) {
  if (result.status === 'requires_2fa') return result;
  return {
    status: result.status,
    user: result.user,
    sessionExpiresAt: result.sessionExpiresAt
  };
}

function assertRecentReauthentication(request: FastifyRequest): void {
  const reauthenticatedAt = request.currentSession!.reauthenticatedAt;
  if (!reauthenticatedAt || Date.now() - reauthenticatedAt.getTime() > securityConfig.sensitiveActionTtlMs) {
    throw forbidden('Recent reauthentication required', 'REAUTHENTICATION_REQUIRED');
  }
}

function prefersHtml(request: FastifyRequest): boolean {
  return String(request.headers.accept ?? '').includes('text/html');
}

export async function registerOAuthRoutes(
  app: FastifyInstance,
  oauthService: OAuthService,
  sessionsService: SessionsService
) {
  app.get('/auth/oauth/42', async (_request, reply) => {
    const { authorizationUrl, state } = await oauthService.startFortyTwoLogin();
    setOAuthStateCookie(reply, state);
    return reply.redirect(authorizationUrl);
  });

  app.get('/auth/oauth/42/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };

    try {
      const result = await oauthService.completeFortyTwoCallback({
        code: query.code,
        state: query.state,
        browserState: request.cookies[securityConfig.oauthCookieName] ?? null,
        ipAddress: request.ip,
        userAgent: getUserAgent(request.headers['user-agent'])
      });

      clearOAuthStateCookie(reply);
      if (result.status === 'authenticated') {
        setSessionCookie(reply, result.sessionToken, result.sessionExpiresAt);
        if (prefersHtml(request)) return reply.redirect('/?oauth=login');
      }
      return toPublicResult(result);
    } catch (error) {
      clearOAuthStateCookie(reply);
      throw error;
    }
  });

  app.post('/auth/oauth/42/link/start', { preHandler: requireAuth(sessionsService) }, async (request, reply) => {
    assertRecentReauthentication(request);
    const { authorizationUrl, state } = await oauthService.startFortyTwoLink({ userId: request.currentUser!.id });
    setOAuthStateCookie(reply, state);
    return reply.redirect(authorizationUrl);
  });

  app.get('/auth/oauth/42/link/callback', { preHandler: requireAuth(sessionsService) }, async (request, reply) => {
    const query = request.query as { code?: string; state?: string };

    try {
      const result = await oauthService.completeFortyTwoLinkCallback({
        code: query.code,
        state: query.state,
        browserState: request.cookies[securityConfig.oauthCookieName] ?? null,
        currentUserId: request.currentUser!.id
      });
      clearOAuthStateCookie(reply);
      if (prefersHtml(request)) return reply.redirect('/?oauth=linked');
      return result;
    } catch (error) {
      clearOAuthStateCookie(reply);
      throw error;
    }
  });

  app.delete('/auth/oauth/42/link', { preHandler: requireAuth(sessionsService) }, async (request) => {
    assertRecentReauthentication(request);
    return oauthService.unlinkFortyTwo({ userId: request.currentUser!.id });
  });
}
