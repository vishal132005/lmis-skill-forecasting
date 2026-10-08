/**
 * Geo routes – states, districts, GeoJSON references.
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../database';

export const geoRouter = Router();

geoRouter.get('/states', async (_req: Request, res: Response) => {
  const db = await getDb();
  const states = await db.all('SELECT * FROM states ORDER BY name');
  res.json({ data: states });
});

geoRouter.get('/states/:id/districts', async (req: Request, res: Response) => {
  const db = await getDb();
  const districts = await db.all('SELECT * FROM districts WHERE state_id = ? ORDER BY name', [req.params.id]);
  res.json({ data: districts });
});

geoRouter.get('/districts', async (_req: Request, res: Response) => {
  const db = await getDb();
  const districts = await db.all(`
    SELECT d.*, s.name as state_name FROM districts d
    JOIN states s ON d.state_id = s.id
    ORDER BY s.name, d.name
  `);
  res.json({ data: districts });
});
