import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import dataSource from '../data-source';
import { importLibraryAssessment, type LibraryFile } from './library-import';

async function run() {
  const file = process.argv[process.argv.indexOf('--file') + 1];
  if (!file || file.startsWith('--')) {
    console.error('Usage: pnpm import:library -- --file <path.json>');
    process.exit(1);
  }
  const parsed = JSON.parse(
    fs.readFileSync(path.resolve(file), 'utf-8'),
  ) as LibraryFile;

  await dataSource.initialize();
  try {
    const result = await importLibraryAssessment(dataSource, parsed);
    console.log(
      `${result.replaced ? 'Replaced' : 'Created'} library assessment ${result.id} with ${result.questionCount} questions`,
    );
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
