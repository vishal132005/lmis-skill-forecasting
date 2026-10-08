import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  port: parseInt(process.env.API_PORT || '4000', 10),
  host: process.env.API_HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'],
  jwt: {
    secret: process.env.JWT_SECRET || 'lmis-dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  ai: {
    url: process.env.AI_SERVICE_URL || 'http://localhost:8000',
    timeout: parseInt(process.env.AI_SERVICE_TIMEOUT || '10000', 10),
    retries: parseInt(process.env.AI_SERVICE_RETRIES || '2', 10),
  },
  db: {
    type: process.env.DB_TYPE || 'sqlite',
    sqlitePath: process.env.SQLITE_PATH || path.resolve(__dirname, '../data/lmis.db'),
  },
};
