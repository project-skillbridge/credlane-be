// Seeds curated learning resources into ai_learning_resources so the app serves
// vetted content instead of generating it with an LLM. Idempotent (upsert).
//
// Usage: node scripts/seed-resources.mjs --track frontend_developer \
//          --articles <articles.json> --videos <videos.json> [--dry-run]
//
// articles.json: { level: [[title, url, type, duration, description], ...] }
// videos.json:   { level: [{ title, description, url, duration, type }, ...] }
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
require('dotenv').config();

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const track = arg('track');
const articlesFile = arg('articles');
const videosFile = arg('videos');
const dryRun = process.argv.includes('--dry-run');
if (!track || !articlesFile || !videosFile) {
  console.error('Missing --track, --articles or --videos');
  process.exit(1);
}

const BANNERS = {
  general: [
    'Start with the foundations',
    'Short, trusted lessons on how the web works and how to build for it.',
  ],
  junior: [
    'Build a strong junior foundation',
    'Practical lessons on the skills junior roles are tested on most.',
  ],
  mid: [
    'Grow into a confident mid-level engineer',
    'Deepen architecture, performance, testing and delivery skills.',
  ],
  senior: [
    'Lead with judgement',
    'Trade-offs, standards and mentoring for engineers who own outcomes.',
  ],
  expert: [
    'Shape direction beyond your team',
    'Strategy, migrations and influence for staff and principal engineers.',
  ],
};

const articles = JSON.parse(readFileSync(articlesFile, 'utf8'));
const videos = JSON.parse(readFileSync(videosFile, 'utf8'));

const toItem = ([title, url, type, duration, description]) => ({
  title,
  description,
  url,
  duration,
  type,
});
const toVideo = (v) => ({
  title: v.title,
  description: v.description,
  url: v.url,
  duration: v.duration,
  type: 'video',
});

const client = new Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});
await client.connect();
try {
  for (const level of Object.keys(BANNERS)) {
    const res = (articles[level] ?? []).map(toItem);
    const vids = (videos[level] ?? []).map(toVideo);
    if (!res.length || !vids.length) {
      console.warn(
        `skip ${level}: ${res.length} articles, ${vids.length} videos`,
      );
      continue;
    }
    console.log(`${level}: ${res.length} resources, ${vids.length} videos`);
    if (dryRun) continue;
    await client.query(
      `INSERT INTO ai_learning_resources (track, level, banner_title, banner_description, resources, videos)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (track, level) DO UPDATE SET
         banner_title = EXCLUDED.banner_title,
         banner_description = EXCLUDED.banner_description,
         resources = EXCLUDED.resources,
         videos = EXCLUDED.videos,
         updated_at = now()`,
      [
        track,
        level,
        ...BANNERS[level],
        JSON.stringify(res),
        JSON.stringify(vids),
      ],
    );
  }
} finally {
  await client.end();
}
