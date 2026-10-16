/**
 * LMIS API Server – Express entry point.
 */
import 'express-async-errors'; // Handles unhandled promise rejections in routes
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import {
  GAP_INTERVAL_COVERAGE,
  GAP_METHOD_VERSION,
  GAP_OPENING_CONVERSION_FACTOR,
} from './config/gapConfig';
import { initializeDatabase } from './database';
import { authRouter } from './routes/auth';
import { geoRouter } from './routes/geo';
import { dataRouter } from './routes/data';
import { alertsRouter } from './routes/alerts';
import { analysisRouter } from './routes/analysis';
import { exportRouter } from './routes/exportRoutes';
import { demandIndexRouter } from './routes/demandIndex';
import { forecastRouter } from './routes/forecast';
import { planningRouter } from './routes/planning';
import { gapRouter } from './routes/gap';
import { supplyForecastRouter } from './routes/supplyForecast';
import { recommendationRouter } from './routes/recommendations';
import { uploadRouter } from './routes/upload';
import { swaggerSpec } from './swagger';

const app = express();

// ─── Uncaught Exception / Rejection Handling ──────────────────────
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ─── CORS (Must be registered FIRST) ──────────────────────────────
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl/Postman) or if in allowlist
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests

// ─── Middleware ───────────────────────────────────────────────────
// Set crossOriginResourcePolicy to "cross-origin" to allow Vite proxy/cross-origin requests
app.use(helmet({ 
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" } 
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/geo', geoRouter);
app.use('/api/v1', dataRouter);
app.use('/api/v1/alerts', alertsRouter);
app.use('/api/v1', analysisRouter);
app.use('/api/v1/demand-index', demandIndexRouter);
app.use('/api/v1/forecasts', forecastRouter);
app.use('/api/v1/gap', gapRouter);
app.use('/api/v1', planningRouter);
app.use('/api/v1/supply-forecast', supplyForecastRouter);
app.use('/api/v1/recommendations', recommendationRouter);
app.use('/api/v1/data', uploadRouter);
app.use('/api/v1', exportRouter);

// ─── Swagger Docs ────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'LMIS API Documentation',
}));

// ─── Health Check ────────────────────────────────────────────────
app.get('/api/v1/health', (_req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'lmis-api', 
    version: '1.0.0', 
    db: 'connected', // We assume true if server is running
    aiService: 'unknown', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString() 
  });
});

app.get('/api/v1/methodology', (_req, res) => {
  res.json({
    demandIndex: 'Unified demand index',
    gap: {
      methodVersion: GAP_METHOD_VERSION,
      formulas: {
        forecastDemand: 'sum((forecast_job_postings + forecast_industry_hiring) * opening_conversion_factor)',
        effectiveSupply: 'annual_sanctioned_seats / 4 * placement_rate',
        gap: 'forecast_demand - effective_supply',
        gapRatio: 'gap / forecast_demand; null when forecast_demand is zero',
        bestCaseGap: 'demand_lower - effective_supply',
        worstCaseGap: 'demand_upper - effective_supply',
        predictionBounds: 'Quarterly demand plus/minus an empirical conformal margin calibrated from paired rolling-origin source errors summed across all three months of that quarter.',
      },
      openingConversionFactor: GAP_OPENING_CONVERSION_FACTOR,
      openingConversionAssumption:
        'The configurable factor defaults to 0.5 openings per summed job-posting and industry-hiring signal unit. Both signals may overlap and do not represent unique workers; this is a synthetic estimation assumption, not an observed conversion rate.',
      capacityAssumption:
        'Annual sanctioned seats are spread evenly across four quarters; effective quarterly supply is quarterly seats multiplied by the synthetic district-trade placement rate.',
      classifications: {
        ACUTE_SHORTAGE: 'gap_ratio > 0.30',
        EMERGING_SHORTAGE: '0.10 < gap_ratio <= 0.30',
        BALANCED: '-0.10 <= gap_ratio <= 0.10',
        APPROACHING_SATURATION: '-0.30 <= gap_ratio < -0.10',
        OVERSUPPLY: 'gap_ratio < -0.30',
      },
      insufficientData:
        'Forecast failures, missing quarterly forecast months, missing capacity or invalid capacity, and inadequate paired interval calibration are stored as INSUFFICIENT_DATA with a reason. Zero demand has a null ratio; status is BALANCED with zero supply and OVERSUPPLY with positive supply.',
      intervalCalibration:
        `The ${GAP_INTERVAL_COVERAGE * 100}% nominal quarterly prediction interval uses the empirical finite-sample conformal quantile of absolute combined posting/hiring residuals summed across each quarter. Only common rolling-origin cutoffs with complete three-month forecasts are paired, and at least nine paired quarter errors are required. This is a synthetic-data interval, not a guarantee of calibration under distribution shift.`,
    },
    knownLimitations: [
      'Weights, conversion factors, and placement rates are provisional synthetic-demo values.',
      'No live PLFS, NCS, e-Shram, or EPFO connection is present.',
    ],
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ─── Global Error Handler ─────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('❌ Server Error:', err.message);
  // Ensure we don't crash
  res.status(500).json({
    error: { 
      code: 'INTERNAL_ERROR', 
      message: err.message || 'An unexpected error occurred',
      status: 500
    },
  });
});

// ─── Start ───────────────────────────────────────────────────────
console.log('Starting API Server...');
console.log(`DB_MODE=${process.env.DB_MODE || 'sqlite'}`);
initializeDatabase().then(() => {
  app.listen(config.port, () => {
    console.log(`🚀 LMIS API running on http://localhost:${config.port}`);
    console.log(`📚 Swagger docs at http://localhost:${config.port}/api/docs`);
    console.log(`🔒 CORS Origins allowed:`, config.corsOrigins);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

export default app;
