import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AssessmentType, VerifiedLevel } from '../modules/assessments/entities';
import {
  QuestionBankGeneratorService,
  type QuestionBankGeneratorAssessmentType,
} from '../tasks/question-bank-generator.service';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function readBooleanFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readCsv(flag: string): string[] | undefined {
  const value = readArg(flag);
  if (!value) {
    return undefined;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readAssessmentTypes():
  | QuestionBankGeneratorAssessmentType[]
  | undefined {
  const value = readArg('--assessment-type');
  if (!value || value === 'all') {
    return undefined;
  }

  const types = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter(
      (entry): entry is QuestionBankGeneratorAssessmentType =>
        entry === AssessmentType.SKILL || entry === AssessmentType.ADVANCED,
    );

  return types.length > 0 ? types : undefined;
}

function readLevels(): VerifiedLevel[] | undefined {
  const values = readCsv('--levels');
  if (!values) {
    return undefined;
  }

  return values as VerifiedLevel[];
}

async function main(): Promise<void> {
  const batchSize = Number(readArg('--batch-size') ?? '5');
  const isLiveArg = readArg('--is-live');
  const dryRun = readBooleanFlag('--dry-run');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const generator = app.get(QuestionBankGeneratorService);
    const result = await generator.run({
      batchSize,
      dryRun,
      isLive: isLiveArg ? isLiveArg === 'true' : true,
      assessmentTypes: readAssessmentTypes(),
      tracks: readCsv('--tracks'),
      levels: readLevels(),
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});
