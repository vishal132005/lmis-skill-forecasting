import { Request, Response, Router } from 'express';
import { getDb } from '../database';
import { ForecastServiceError, isSupportedHorizon, runForecast } from '../services/forecastService';

export const forecastRouter = Router();

/**
 * @openapi
 * /forecasts/run:
 *   post:
 *     summary: Run source-specific statistical demand forecasts
 *     description: Uses chronological job-posting and industry-hiring histories from SQLite and the internal AI service.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [district_id, trade_id, horizon_months]
 *             properties:
 *               district_id: { type: string }
 *               trade_id: { type: string }
 *               horizon_months: { type: integer, minimum: 1, maximum: 12 }
 *     responses:
 *       200:
 *         description: Source-specific forecasts, evaluation metrics, methodology, and provenance.
 *       400:
 *         description: Invalid request fields.
 *       404:
 *         description: District or trade does not exist.
 *       502:
 *         description: Invalid response from the internal forecasting service.
 *       503:
 *         description: Internal forecasting service is unavailable.
 *       504:
 *         description: Internal forecasting service timed out.
 */
forecastRouter.post('/run', async (req: Request, res: Response) => {
  const { district_id: districtId, trade_id: tradeId, horizon_months: horizon } =
    req.body ?? {};
  if (
    typeof districtId !== 'string' ||
    districtId.trim().length === 0 ||
    typeof tradeId !== 'string' ||
    tradeId.trim().length === 0 ||
    !isSupportedHorizon(horizon)
  ) {
    res.status(400).json({
      error: {
        code: 'INVALID_FORECAST_REQUEST',
        message:
          'district_id and trade_id must be non-empty strings; horizon_months must be an integer from 1 to 12.',
      },
    });
    return;
  }

  try {
    res.json(await runForecast(await getDb(), districtId.trim(), tradeId.trim(), horizon));
  } catch (error) {
    if (!(error instanceof ForecastServiceError)) throw error;
    res.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
  }
});
