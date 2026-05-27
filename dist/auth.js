import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env, isProduction } from './env.js';
const COOKIE_NAME = 'drive_session';
export function hashPassword(password) {
    return bcrypt.hash(password, 10);
}
export function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
export function signSession(payload) {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d' });
}
export function setSessionCookie(response, token) {
    const sameSite = isProduction ? 'none' : 'lax';
    response.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite,
        secure: isProduction,
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 30
    });
}
export function clearSessionCookie(response) {
    response.clearCookie(COOKIE_NAME, {
        path: '/',
        sameSite: isProduction ? 'none' : 'lax',
        secure: isProduction
    });
}
export function readSessionToken(request) {
    return request.cookies?.[COOKIE_NAME];
}
export function requireUser(request, response, next) {
    const token = readSessionToken(request);
    if (!token) {
        response.status(401).json({ error: 'Not signed in' });
        return;
    }
    try {
        const payload = jwt.verify(token, env.JWT_SECRET);
        request.user = { id: payload.userId, email: payload.email };
        next();
    }
    catch {
        response.status(401).json({ error: 'Session expired' });
    }
}
