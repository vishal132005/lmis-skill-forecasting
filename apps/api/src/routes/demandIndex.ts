import { Request, Response, Router } from 'express';
import { getDb } from '../database';
import { DemandIndexFilters, getDemandIndex } from '../services/demandIndexService';

export const demandIndexRouter = Router();

const FILTER_NAMES = ['state', 'district', 'sector', 'trade', 'period', 'from', 'to'] as const;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseFilters(query: Request['query']): DemandIndexFilters | null {
  const filters: DemandIndexFilters = {};
  for (const name of FILTER_NAMES) {
    const value = query[name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    filters[name] = value.trim();
  }

  for (const name of ['period', 'from', 'to'] as const) {
    const value = filters[name];
    if (value && !MONTH_PATTERN.test(value)) return null;
  }
  if (filters.from && filters.to && filters.from > filters.to) return null;
  return filters;
}

demandIndexRouter.get('/', async (req: Request, res: Response) => {
  const filters = parseFilters(req.query);
  if (!filters) {
    res.status(400).json({
      error: {
        code: 'INVALID_FILTER',
        message:
          'Filters must be single non-empty values; period, from, and to must use YYYY-MM, and from must not be after to.',
      },
    });
    return;
  }

  const result = await getDemandIndex(await getDb(), filters);
  res.json(result);
});
