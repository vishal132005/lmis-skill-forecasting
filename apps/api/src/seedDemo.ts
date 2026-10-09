import fs from 'fs';
import path from 'path';
import { DEMO_DATABASE_DIRECTORY, DEMO_DATABASE_PATH } from './demoDatabase';

function getDatabaseArgument(args: string[]): string {
  const index = args.indexOf('--database');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error('Usage: npm run seed:demo -- --database ./data/demo/kaushalpulse-demo.db');
  }
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed data cannot be written when NODE_ENV=production.');
  }

  const apiDirectory = path.resolve(__dirname, '..');
  const databasePath = path.resolve(apiDirectory, getDatabaseArgument(process.argv.slice(2)));
  if (databasePath !== DEMO_DATABASE_PATH) {
    throw new Error(`Demo seeding is restricted to the designated database: ${DEMO_DATABASE_PATH}`);
  }

  fs.mkdirSync(DEMO_DATABASE_DIRECTORY, { recursive: true });
  if (fs.lstatSync(DEMO_DATABASE_DIRECTORY).isSymbolicLink()) {
    throw new Error('The designated demo database directory cannot be a symbolic link.');
  }
  if (fs.existsSync(databasePath) && fs.lstatSync(databasePath).isSymbolicLink()) {
    throw new Error('The designated demo database file cannot be a symbolic link.');
  }

  const resolvedDirectory = fs.realpathSync(DEMO_DATABASE_DIRECTORY);
  const resolvedDataDirectory = fs.realpathSync(path.resolve(apiDirectory, 'data'));
  if (path.dirname(resolvedDirectory) !== resolvedDataDirectory) {
    throw new Error('The demo database directory resolves outside the API data directory.');
  }

  process.env.SQLITE_PATH = databasePath;
  process.env.LMIS_DEMO_SEED_TARGET = databasePath;
  await import('./seed');
}

main().catch((error: unknown) => {
  console.error('Unable to start demo seeding:', error);
  process.exitCode = 1;
});
