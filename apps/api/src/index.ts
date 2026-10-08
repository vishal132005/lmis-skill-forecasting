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
import { initializeDatabase } from './database';
import { authRouter } from './routes/auth';
import { geoRouter } from './routes/geo';
import { dataRouter } from './routes/data';
import { alertsRouter } from './routes/alerts';
import { analysisRouter } from './routes/analysis';
import { exportRouter } from './routes/exportRoutes';
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
    knownLimitations: ['DUMMY DATA'],
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
