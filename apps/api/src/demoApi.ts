import { DEMO_DATABASE_PATH } from './demoDatabase';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The demo API entry point cannot run when NODE_ENV=production.');
}

process.env.SQLITE_PATH = DEMO_DATABASE_PATH;
if (!process.env.API_PORT) process.env.API_PORT = '4001';

void import('./index').catch((error: unknown) => {
  console.error('Unable to start the demo API:', error);
  process.exitCode = 1;
});
