import { Request, Response, Router } from 'express';
import { getDb } from '../database';
import {
  calculateCapacityScenario,
  getCapacity,
  listCapacityOptions,
  listPlanningTargets,
  MAX_PLANNING_SEATS,
  PlanningServiceError,
  savePlanningTarget,
  validatePlanningYear,
  validateSeatTarget,
} from '../services/planningService';

export const planningRouter = Router();

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100;
}

function sendPlanningError(res: Response, error: unknown): void {
  if (error instanceof PlanningServiceError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  throw error;
}

planningRouter.get('/planning/options', async (_req: Request, res: Response) => {
  const db = await getDb();
  res.json({ data: await listCapacityOptions(db) });
});

planningRouter.get('/planning/targets', async (req: Request, res: Response) => {
  const { district_id: districtId, trade_id: tradeId, year: rawYear } = req.query;
  if (
    (districtId !== undefined && !isNonEmptyId(districtId)) ||
    (tradeId !== undefined && !isNonEmptyId(tradeId))
  ) {
    res.status(400).json({
      error: { code: 'INVALID_TARGET_FILTER', message: 'District and trade filters must be non-empty identifiers.' },
    });
    return;
  }

  let year: number | undefined;
  if (rawYear !== undefined) {
    if (typeof rawYear !== 'string' || !/^\d{4}$/.test(rawYear)) {
      res.status(400).json({
        error: { code: 'INVALID_TARGET_FILTER', message: 'year must be a four-digit supported year.' },
      });
      return;
    }
    year = Number(rawYear);
    if (!validatePlanningYear(year)) {
      res.status(400).json({
        error: { code: 'INVALID_TARGET_FILTER', message: 'year must be between 2000 and 2100.' },
      });
      return;
    }
  }

  const db = await getDb();
  res.json({
    data: await listPlanningTargets(db, {
      district_id: districtId as string | undefined,
      trade_id: tradeId as string | undefined,
      year,
    }),
  });
});

planningRouter.post('/planning/targets', async (req: Request, res: Response) => {
  const { district_id: districtId, trade_id: tradeId, year, target_seats: targetSeats } = req.body ?? {};
  if (!isNonEmptyId(districtId) || !isNonEmptyId(tradeId) || !validatePlanningYear(year) || !validateSeatTarget(targetSeats)) {
    res.status(400).json({
      error: {
        code: 'INVALID_TARGET_REQUEST',
        message: `district_id and trade_id must be non-empty identifiers; year must be an integer from 2000 to 2100; target_seats must be a whole number from 0 to ${MAX_PLANNING_SEATS}.`,
      },
    });
    return;
  }

  try {
    const target = await savePlanningTarget(await getDb(), {
      district_id: districtId.trim(),
      trade_id: tradeId.trim(),
      year,
      target_seats: targetSeats,
    });
    res.status(201).json({ data: target });
  } catch (error) {
    sendPlanningError(res, error);
  }
});

planningRouter.post('/simulate', async (req: Request, res: Response) => {
  const {
    district_id: districtId,
    trade_id: tradeId,
    year,
    adjustment_type: adjustmentType,
    adjustment_value: adjustmentValue,
  } = req.body ?? {};

  if (
    !isNonEmptyId(districtId) ||
    !isNonEmptyId(tradeId) ||
    !validatePlanningYear(year) ||
    (adjustmentType !== 'percent' && adjustmentType !== 'seats') ||
    typeof adjustmentValue !== 'number'
  ) {
    res.status(400).json({
      error: {
        code: 'INVALID_SIMULATION_REQUEST',
        message: 'Provide supported district_id, trade_id, year, adjustment_type (percent or seats), and numeric adjustment_value.',
      },
    });
    return;
  }

  const db = await getDb();
  try {
    const baselineSeats = await getCapacity(db, districtId.trim(), tradeId.trim(), year);
    const scenario = calculateCapacityScenario(baselineSeats, adjustmentType, adjustmentValue);
    res.json({
      data: {
        district_id: districtId.trim(),
        trade_id: tradeId.trim(),
        year,
        unit: 'sanctioned training seats',
        baseline_seats: scenario.baseline_seats,
        scenario_seats: scenario.scenario_seats,
        delta_seats: scenario.delta_seats,
        adjustment: {
          type: scenario.adjustment_type,
          value: scenario.adjustment_value,
          rounding: 'Nearest whole seat; half seats rounded away from zero.',
        },
        limitations: [
          'This is arithmetic scenario planning against annual sanctioned-seat capacity only.',
          'It does not calculate demand, employment outcomes, gaps, or policy effects.',
          'Historical training-capacity records are unchanged.',
        ],
      },
    });
  } catch (error) {
    sendPlanningError(res, error);
  }
});
