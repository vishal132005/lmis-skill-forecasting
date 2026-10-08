/**
 * Auth routes – mock JWT authentication.
 */
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getDb } from '../database';

export const authRouter = Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with email (mock auth)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [MSDE, NCVET, SSC, STATE_PLANNER]
 *     responses:
 *       200:
 *         description: JWT token returned
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, role } = req.body;
  const db = await getDb();

  // Find user or create mock one
  let user = await db.get('SELECT * FROM users WHERE email = ?', [email]) as Record<string, unknown> | undefined;
  if (!user) {
    user = { id: 'USR-DEMO', name: 'Demo User', email: email || 'demo@lmis.gov.in', role: role || 'MSDE', state_scope: null };
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, state_scope: user.state_scope },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as any }
  );

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, state_scope: user.state_scope } });
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user info
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRouter.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    return;
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), config.jwt.secret);
    res.json({ user: decoded });
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
});
