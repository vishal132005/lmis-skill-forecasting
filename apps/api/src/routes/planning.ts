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

/**
 * @openapi
 * /planning/options:
 *   get:
 *     summary: List supported annual district/trade capacity options
 *     responses:
 *       200:
 *         description: Options derived from existing training-capacity rows.
 */
planningRouter.get('/planning/options', async (_req: Request, res: Response) => {
  const db = await getDb();
  res.json({ data: await listCapacityOptions(db) });
});

/**
 * @openapi
 * /planning/targets:
 *   get:
 *     summary: List saved capacity targets
 *     parameters:
 *       - in: query
 *         name: district_id
 *         schema: { type: string }
 *       - in: query
 *         name: trade_id
 *         schema: { type: string }
 *       - in: query
 *         name: year
 *         schema: { type: integer, minimum: 2000, maximum: 2100 }
 *     responses:
 *       200:
 *         description: Saved proposals with their original capacity baseline.
 *       400:
 *         description: Invalid filters.
 *   post:
 *     summary: Save a proposed annual sanctioned-seat target
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [district_id, trade_id, year, target_seats]
 *             properties:
 *               district_id: { type: string }
 *               trade_id: { type: string }
 *               year: { type: integer, minimum: 2000, maximum: 2100 }
 *               target_seats: { type: integer, minimum: 0, maximum: 10000000 }
 *     responses:
 *       201:
 *         description: Saved proposal distinct from training-capacity records.
 *       400:
 *         description: Invalid input.
 *       404:
 *         description: Unsupported district/trade/year.
 */
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

/**
 * @openapi
 * /simulate:
 *   post:
 *     summary: Compare a capacity-only annual seat scenario with baseline
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [district_id, trade_id, year, adjustment_type, adjustment_value]
 *             properties:
 *               district_id: { type: string }
 *               trade_id: { type: string }
 *               year: { type: integer, minimum: 2000, maximum: 2100 }
 *               adjustment_type: { type: string, enum: [percent, seats] }
 *               adjustment_value: { type: number }
 *     responses:
 *       200:
 *         description: Baseline and scenario sanctioned-seat counts.
 *       400:
 *         description: Invalid input or scenario outside supported bounds.
 *       404:
 *         description: Unsupported district/trade/year.
 *       409:
 *         description: Capacity value is unavailable.
 */
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
