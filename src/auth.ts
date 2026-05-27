import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { env, isProduction } from './env.js';
import type { AuthedUser } from './types.js';

const COOKIE_NAME = 'drive_session';

export type AuthTokenPayload = {
  userId: string;
  email: string;
};

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d' });
}

export function setSessionCookie(response: Response, token: string) {
  const sameSite = isProduction ? 'none' : 'lax';
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite,
    secure: isProduction,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(COOKIE_NAME, {
    path: '/',
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction
  });
}

export function readSessionToken(request: Request) {
  return request.cookies?.[COOKIE_NAME] as string | undefined;
}

export function requireUser(request: Request, response: Response, next: NextFunction) {
  const token = readSessionToken(request);

  if (!token) {
    response.status(401).json({ error: 'Not signed in' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
    request.user = { id: payload.userId, email: payload.email } as AuthedUser;
    next();
  } catch {
    response.status(401).json({ error: 'Session expired' });
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}
