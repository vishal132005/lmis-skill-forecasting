/**
 * Recommendation routes – REC-v1
 */
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getDb } from '../database';
import { generateRecommendations } from '../services/recommendationService';

export const recommendationRouter = Router();

const filtersSchema = z.object({
  state: z.string().trim().min(1).optional(),
  district_id: z.string().trim().min(1).optional(),
  sector: z.string().trim().min(1).optional(),
  trade_id: z.string().trim().min(1).optional(),
}).strict();

/**
 * @openapi
 * /recommendations:
 *   get:
 *     summary: Get AI-powered training recommendations
 *     tags: [Recommendations]
 *     parameters:
 *       - { in: query, name: state, schema: { type: string } }
 *       - { in: query, name: district_id, schema: { type: string } }
 *       - { in: query, name: sector, schema: { type: string } }
 *       - { in: query, name: trade_id, schema: { type: string } }
 *     responses:
 *       200:
 *         description: List of training recommendations with priorities and rationale
 *       400: { description: Invalid filters }
 */
recommendationRouter.get('/', async (req: Request, res: Response) => {
  const parsed = filtersSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_FILTERS', message: 'Filters must be non-empty strings.' },
    });
    return;
  }
  const db = await getDb();
  const result = await generateRecommendations(db, parsed.data);
  res.json(result);
});

/**
 * @openapi
 * /recommendations/generate:
 *   post:
 *     summary: Regenerate recommendations for a scope
 *     tags: [Recommendations]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               state: { type: string }
 *               district_id: { type: string }
 *               sector: { type: string }
 *               trade_id: { type: string }
 *     responses:
 *       200: { description: Regenerated recommendations }
 */
recommendationRouter.post('/generate', async (req: Request, res: Response) => {
  const parsed = filtersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_FILTERS', message: parsed.error.message },
    });
    return;
  }
  const db = await getDb();
  const result = await generateRecommendations(db, parsed.data);
  res.json(result);
});
