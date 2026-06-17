import type { FastifyReply } from 'fastify';
import { securityConfig } from '../../config/security.js';

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(securityConfig.cookieName, token, {
    httpOnly: true,
    secure: securityConfig.cookieSecure,
    sameSite: securityConfig.cookieSameSite,
    path: '/',
    expires: expiresAt
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(securityConfig.cookieName, { path: '/' });
}

export function setOAuthStateCookie(reply: FastifyReply, state: string): void {
  reply.setCookie(securityConfig.oauthCookieName, state, {
    httpOnly: true,
    secure: securityConfig.cookieSecure,
    sameSite: securityConfig.cookieSameSite,
    path: '/',
    expires: new Date(Date.now() + securityConfig.oauthStateTtlMs)
  });
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(securityConfig.oauthCookieName, { path: '/' });
}
