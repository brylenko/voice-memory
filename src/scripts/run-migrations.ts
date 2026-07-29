import { dataSource } from '../data-source';

async function main() {
  await dataSource.initialize();
  const applied = await dataSource.runMigrations();
  if (applied.length === 0) {
    console.log('No pending migrations.');
  } else {
    console.log(`Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`);
  }
  await dataSource.destroy();
}

main().catch((error) => {
  console.error('Migration run failed:', error);
  process.exit(1);
});
