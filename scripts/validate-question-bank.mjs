#!/usr/bin/env node
/**
 * Validates question-bank JSON files BEFORE they are imported.
 * Dependency-free, read-only, no network and no AI. Safe to run anywhere.
 *
 *   node scripts/validate-question-bank.mjs <file.json> [more files...] [--strict] [--json] [--coverage] [--tells]
 *
 * Input: a JSON array, an object with a `questions` array, or concatenated JSON
 * objects (same formats the importer accepts). Items use the SourceQuestion shape
 * from src/database/import/import.types.ts.
 *
 * Exit code 1 when any ERROR is found (or any WARNING with --strict).
 *
 * ERRORS block the import. WARNINGS are things a human reviewer should look at.
 * The goal is to catch recall-style trivia, answer-key tells, duplicates and
 * thin rubrics early, so a person only reviews questions that are worth their time.
 */
import { readFileSync } from 'node:fs';

const LEVELS = ['entry', 'junior', 'mid', 'senior', 'expert'];
const STAGES = ['skill_assessment', 'advanced_assessment', 'extension_bank', 'practice'];
const FORMATS = ['mcq', 'long_text', 'open_ended_scenario'];
// Keep in sync with src/database/import/role-code-map.ts
const ROLE_CODES = new Set(
  'FED BED MOB FSD DEV DTE QAE MLE PMG PDG UXR BRD GRM CTM SMM PFM DTA BIA BID DSC OPM CSM PJM HRO CYB'.split(
    ' ',
  ),
);

// What the live sessions need (see skill-assessment.service.ts / advanced-assessment-ai.service.ts)
const SKILL_MCQ_AT_LEVEL = 16;
const SKILL_MCQ_PER_PROBE_LEVEL = 2;
const ADV = { mcq: 8, short: 2, longSituational: 2, longWork: 3 };
// A talent is never re-served a question, so one track+level must hold enough
// unserved questions for every attempt they are allowed, or a retake hits BANK_EXHAUSTED.
const SKILL_MAX_ATTEMPTS = 3; // SKILL_ASSESSMENT_MAX_ATTEMPTS in talent.constants.ts
const ADV_PLANNED_ATTEMPTS = 2; // advanced has no cap, only a 14-day retake window; plan for two
const HEADROOM = 1.5; // spare depth for retired questions and answers that leak between accounts

const RECALL_STEM = /^(what|which)\s+(is|are|does|do|was|were)\b[^?]{0,70}\?\s*$/i;
const DEFINE_STEM = /^(define|name|list|state)\b/i;
const SCENARIO_CUES =
  /\b(you|your|team|customer|customers|user|users|production|ticket|pull request|pr\b|sprint|client|stakeholder|deadline|incident|release|deploy|dashboard|checkout|signup|onboarding|bug|report|review|manager|colleague|designer|backend|api|page|screen|app|feature|component|components|project|codebase|pricing|product|products|handler|loop|pull request|reviewer|stakeholders?|sprint|launch)\b/i;
const ABSOLUTE_WORDS = /\b(always|never|none|all of|guarantee[sd]?|impossible)\b/i;
const OPTION_CRUTCHES = /^(all|none) of the above|^both [a-d]\b|^[a-d] and [a-d]\b/i;
const STALE_TERMS = [
  /componentWillMount|componentWillReceiveProps|UNSAFE_/,
  /\bReact\s?1[0-6]\b/,
  /\bAngularJS\b|\bAngular\s?1\.x\b/i,
  /\bcreate-react-app\b|\bCreate React App\b/i,
  /\bInternet Explorer\b|\bIE ?11\b/i,
  /\bFlash\b|\bSilverlight\b/,
];
const REGION_BIASED = [
  /[$£€]\s?\d/,
  /\b(Thanksgiving|Super Bowl|Black Friday|401\(?k\)?|IRS|SSN|zip code|Medicare|Obamacare)\b/i,
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('Usage: validate-question-bank.mjs <file.json> [...] [--strict] [--json] [--coverage] [--tells]');
  process.exit(2);
}

// ---------- load ----------
function parseConcatenated(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}') { if (--depth === 0 && start >= 0) { out.push(JSON.parse(text.slice(start, i + 1))); start = -1; } }
  }
  return out;
}
function load(file) {
  const text = readFileSync(file, 'utf8');
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.questions)) return v.questions;
    return [v];
  } catch {
    return parseConcatenated(text);
  }
}
const items = files.flatMap((f) => load(f).map((q) => ({ ...q, __file: f })));

// ---------- helpers ----------
const findings = []; // {sev, code, id, msg}
const add = (sev, code, q, msg) => findings.push({ sev, code, id: q?.id ?? '(no id)', msg });
const words = (s) => (s.toLowerCase().match(/[a-z0-9']+/g) ?? []);
function shingles(s, n = 4) {
  const w = words(s);
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function syllables(word) {
  const m = word.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
}
function fkGrade(text) {
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const w = words(text);
  if (w.length < 20) return 0;
  const syl = w.reduce((n, x) => n + syllables(x), 0);
  return 0.39 * (w.length / sentences) + 11.8 * (syl / w.length) - 15.59;
}

// ---------- per-question checks ----------
const seenIds = new Map();
for (const q of items) {
  // schema
  if (!q.id || typeof q.id !== 'string') add('ERROR', 'E-ID', q, 'missing id');
  else if (seenIds.has(q.id)) add('ERROR', 'E-ID-DUP', q, `duplicate id (also in ${seenIds.get(q.id)})`);
  else seenIds.set(q.id, q.__file);

  if (!q.question || typeof q.question !== 'string') { add('ERROR', 'E-STEM', q, 'missing question text'); continue; }
  if (!ROLE_CODES.has(String(q.role_code ?? '').toUpperCase())) add('ERROR', 'E-ROLE', q, `unknown role_code "${q.role_code}"`);
  if (!LEVELS.includes(q.level)) add('ERROR', 'E-LEVEL', q, `level must be one of ${LEVELS.join('/')}`);
  if (!STAGES.includes(q.assessment_stage)) add('ERROR', 'E-STAGE', q, `assessment_stage must be one of ${STAGES.join('/')}`);
  if (!FORMATS.includes(q.format)) add('ERROR', 'E-FORMAT', q, `format must be one of ${FORMATS.join('/')}`);
  if (!q.competency) add('ERROR', 'E-COMPETENCY', q, 'missing competency');
  if (q.format !== 'mcq' && q.assessment_stage === 'skill_assessment') {
    add('ERROR', 'E-SKILL-FORMAT', q, 'skill_assessment sessions only serve mcq; text items here are never shown');
  }

  const stem = q.question.trim();
  const isAdvanced = q.assessment_stage !== 'skill_assessment';

  // thinking-quality heuristics (these are what separate exam-grade items from trivia)
  if (RECALL_STEM.test(stem) || DEFINE_STEM.test(stem)) {
    add('WARN', 'W-RECALL', q, 'reads like a definition/recall question; rewrite as a decision in a realistic situation');
  }
  if (!SCENARIO_CUES.test(stem) && stem.length < 400) {
    add('WARN', 'W-NO-SCENARIO', q, 'no work-situation cues (who/what/where); candidates should have context to reason about');
  }
  const minStem = q.format === 'mcq' ? (isAdvanced ? 160 : 120) : q.format === 'open_ended_scenario' ? 150 : 240;
  if (stem.length < minStem) add('WARN', 'W-SHORT-STEM', q, `stem is ${stem.length} chars (< ${minStem}); likely too thin to require judgement`);
  if (STALE_TERMS.some((r) => r.test(stem + JSON.stringify(q.options ?? {})))) add('WARN', 'W-STALE', q, 'mentions deprecated/legacy tech; confirm it is still relevant');
  if (REGION_BIASED.some((r) => r.test(stem + JSON.stringify(q.options ?? {})))) add('WARN', 'W-GLOBAL', q, 'region-specific reference (currency/holiday/institution); this is a global audience');
  const grade = /[{}()=;]\s|\\n/.test(stem) ? 0 : fkGrade(stem);
  if (grade > 15) add('WARN', 'W-READABILITY', q, `reading grade ~${grade.toFixed(0)}; simplify wording for non-native English speakers`);

  if (q.format === 'mcq') {
    const o = q.options ?? {};
    const keys = Object.keys(o).sort();
    if (keys.join('') !== 'ABCD') add('ERROR', 'E-MCQ-OPTIONS', q, `options must be exactly A,B,C,D (found ${keys.join(',') || 'none'})`);
    else {
      const vals = keys.map((k) => String(o[k] ?? '').trim());
      if (vals.some((v) => !v)) add('ERROR', 'E-MCQ-EMPTY', q, 'empty option');
      if (new Set(vals.map((v) => v.toLowerCase())).size !== 4) add('ERROR', 'E-MCQ-DUP-OPT', q, 'two options are identical');
      if (vals.some((v) => OPTION_CRUTCHES.test(v))) add('ERROR', 'E-MCQ-CRUTCH', q, '"all/none of the above" or "both A and B" options are not allowed');
      const key = String(q.correct_answer ?? '').toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(key)) add('ERROR', 'E-MCQ-KEY', q, 'correct_answer must be a letter A-D');
      else {
        const others = keys.filter((k) => k !== key).map((k) => String(o[k]));
        if (ABSOLUTE_WORDS.test(String(o[key])) === false && others.filter((v) => ABSOLUTE_WORDS.test(v)).length >= 2) {
          add('WARN', 'W-ABSOLUTES', q, 'two or more distractors use absolutes (always/never/only); test-wise candidates will spot this');
        }
        const lens = keys.map((k) => String(o[k]).length);
        const maxLen = Math.max(...lens);
        if (lens.filter((l) => l === maxLen).length === 1 && String(o[key]).length === maxLen && maxLen > 1.6 * (lens.reduce((a, b) => a + b, 0) - maxLen) / 3) {
          add('WARN', 'W-KEY-OBVIOUS', q, 'correct option is far longer than the distractors');
        }
      }
    }
    if (q.grading_rubric) add('WARN', 'W-RUBRIC-ON-MCQ', q, 'grading_rubric is ignored for mcq');
  } else {
    const r = q.grading_rubric;
    if (!r || typeof r !== 'object') add('ERROR', 'E-RUBRIC', q, 'text questions need a grading_rubric');
    else {
      if (!r.what_to_evaluate || r.what_to_evaluate.length < 30) add('ERROR', 'E-RUBRIC-EVAL', q, 'what_to_evaluate missing or too short');
      if (!Array.isArray(r.strong_answer_must_show) || r.strong_answer_must_show.length < 3) add('ERROR', 'E-RUBRIC-STRONG', q, 'strong_answer_must_show needs >= 3 concrete signals');
      if (!Array.isArray(r.weak_answer_indicators) || r.weak_answer_indicators.length < 2) add('ERROR', 'E-RUBRIC-WEAK', q, 'weak_answer_indicators needs >= 2 items');
      if (!r.score_guide || Object.keys(r.score_guide).length < 3) add('ERROR', 'E-RUBRIC-GUIDE', q, 'score_guide needs >= 3 bands');
      const thin = [...(r.strong_answer_must_show ?? []), ...(r.weak_answer_indicators ?? [])].filter((s) => String(s).length < 25);
      if (thin.length) add('WARN', 'W-RUBRIC-THIN', q, `${thin.length} rubric line(s) under 25 chars; graders (human or AI) need concrete criteria`);
    }
  }
  // The importer rewrites curly double quotes to straight ones before parsing, which breaks the JSON and
  // silently drops the question. Use straight single quotes or escape straight double quotes instead.
  if (/[\u201C\u201D]/.test(JSON.stringify(q))) add('ERROR', 'E-SMART-QUOTES', q, 'contains curly double quotes, which the importer turns into invalid JSON (the question is silently dropped); use straight quotes');
  if (!Array.isArray(q.tags) || q.tags.length === 0) add('WARN', 'W-TAGS', q, 'no tags');
  if (q.difficulty_score === undefined) add('WARN', 'W-DIFFICULTY', q, 'no difficulty_score (defaults to medium)');
}


// ---------- test-wise guesser simulation ----------
// Each strategy picks an option using only surface cues, never the content. Expected accuracy
// is averaged over ties. With four options chance is 25%; a strategy that clearly beats it means
// the key is recognisable without knowing the subject, which makes the level result unreliable.
const tellWords = (t) => String(t).toLowerCase().match(/[a-z][a-z'-]+/g) ?? [];
const STOP = new Set('a an the and or of to in on for with is are was were be been it its this that these those you your we our they their as at by from so if then than but not do does did can could should would will may might have has had into out up down over under more most less very'.split(' '));
const NEGATIVE = /\b(quietly|do not|don't|never|always|ignore|ignoring|just|simply|only|wait|waiting|refuse|force-push|force|delete|deleting|skip|skipping|hide|hiding|blame|disable|disabling|entire|entirely|everything|immediately|without|avoid|forget|rewrite|abandon|escalate|giv(?:e|ing) up|nothing|unnecessary|completely|any|all)\b/gi;
const PROCESS = /\b(ask|asking|explain|explaining|measure|measuring|test|tests|testing|verify|verifying|check|checking|understand|understanding|trade-?offs?|evidence|data|incremental|incrementally|rollback|document|documenting|review|confirm|agree|raise|flag|communicate|reproduce|profile|profiling|accessible|accessibility|root cause|monitor|monitoring|prioriti[sz]e|stakeholders?|options|both|first|then|before|after|while)\b/gi;
const hits = (t, re) => (String(t).match(re) ?? []).length;
const clauses = (t) => 1 + (String(t).match(/,|;| and | then | so | while | before | after /gi) ?? []).length;
const specifics = (t) => (String(t).match(/\d+|`[^`]+`|\b[a-z]+\([^)]*\)|[A-Z][a-z]+[A-Z]\w*|\b[a-z]+-[a-z]+\b|\.[a-z]+\b/g) ?? []).length;
const contentWords = (t) => new Set(tellWords(t).filter((w) => !STOP.has(w) && w.length > 3));
const overlap = (a, b) => { const A = contentWords(a); let n = 0; for (const w of contentWords(b)) if (A.has(w)) n++; return n; };
const STRATEGIES = {
  'longest option': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, String(t).length])),
  'shortest option': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, -String(t).length])),
  'fewest clauses': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, -clauses(t)])),
  'most clauses': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, clauses(t)])),
  'fewest negative/absolute words': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, -hits(t, NEGATIVE)])),
  'most process/hedge words': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, hits(t, PROCESS)])),
  'process minus negative': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, hits(t, PROCESS) - 2 * hits(t, NEGATIVE)])),
  'least specific detail': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, -specifics(t)])),
  'most specific detail': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, specifics(t)])),
  'most overlap with the question': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, overlap(q.question, t)])),
  'most similar to the other options': (q, o) => Object.fromEntries(o.map(([l, t]) => [l, o.filter(([m]) => m !== l).reduce((n, [, u]) => n + overlap(t, u), 0)])),
};
const strategyHit = (scores, key) => {
  const best = Math.max(...Object.values(scores));
  const top = Object.keys(scores).filter((l) => scores[l] === best);
  return top.includes(key) ? 1 / top.length : 0;
};
const TELL_LIMIT = 0.4; // chance is 0.25
// Filler appended only to equalise option length adds no meaning, reads badly, and is itself a tell
// when it lands on distractors more than on keys.
const FILLER = /\b(in practice|at this stage|as a result|in this case|for now|overall|for this team|for the most part|to some extent|in general|as needed|when appropriate|over time)\s*[,.]?\s*$|,\s*(in practice|at this stage|as a result|for this team|overall)\b/i;
const tellReport = [];

// ---------- bank-level checks ----------
const groups = new Map(); // role|level|stage -> items
for (const q of items) {
  const k = `${q.role_code}|${q.level}|${q.assessment_stage}`;
  (groups.get(k) ?? groups.set(k, []).get(k)).push(q);
}
for (const [k, list] of groups) {
  const mcqs = list.filter((q) => q.format === 'mcq' && ['A', 'B', 'C', 'D'].includes(String(q.correct_answer ?? '').toUpperCase()));
  if (mcqs.length >= 12) {
    const count = { A: 0, B: 0, C: 0, D: 0 };
    mcqs.forEach((q) => count[String(q.correct_answer).toUpperCase()]++);
    for (const [letter, n] of Object.entries(count)) {
      const share = n / mcqs.length;
      if (share > 0.4 || share < 0.1) findings.push({ sev: 'WARN', code: 'W-KEY-POSITION', id: k, msg: `correct answer is "${letter}" for ${(share * 100).toFixed(0)}% of ${mcqs.length} MCQs (aim for ~25% each)` });
    }
  }
  // "Longest" only counts when it stands out: at least 10% longer than the next longest option.
  const longest = mcqs.filter((q) => {
    const o = q.options ?? {};
    const k2 = String(q.correct_answer).toUpperCase();
    const keyLen = String(o[k2] ?? '').length;
    const otherMax = Math.max(...Object.entries(o).filter(([l]) => l !== k2).map(([, v]) => String(v).length));
    return keyLen >= otherMax * 1.1;
  }).length;
  if (mcqs.length >= 12 && longest / mcqs.length > 0.35) findings.push({ sev: 'WARN', code: 'W-KEY-LONGEST', id: k, msg: `the correct option is clearly the longest in ${((longest / mcqs.length) * 100).toFixed(0)}% of MCQs (chance is ~25% or less); test-wise candidates exploit this` });
  if (mcqs.length >= 12) {
    let fKey = 0, fDis = 0, nDis = 0;
    for (const q of mcqs) {
      for (const [l, t] of Object.entries(q.options)) {
        const hit = FILLER.test(String(t));
        if (l.toUpperCase() === String(q.correct_answer).toUpperCase()) { if (hit) fKey++; } else { nDis++; if (hit) fDis++; }
      }
    }
    if ((fKey + fDis) / (mcqs.length + nDis) > 0.05) findings.push({ sev: 'WARN', code: 'W-FILLER', id: k, msg: `filler phrases ("in practice", "as a result", "for this team"...) end ${fKey} keys and ${fDis} distractors; remove them and equalise length with real content` });
  }
  if (mcqs.length >= 12) {
    for (const [name, fn] of Object.entries(STRATEGIES)) {
      let hit = 0;
      for (const q of mcqs) {
        const entries = Object.entries(q.options).map(([l, t]) => [l.toUpperCase(), t]);
        hit += strategyHit(fn(q, entries), String(q.correct_answer).toUpperCase());
      }
      const acc = hit / mcqs.length;
      tellReport.push({ group: k, strategy: name, accuracy: acc, n: mcqs.length });
      if (acc >= TELL_LIMIT) findings.push({ sev: 'WARN', code: 'W-TELL', id: k, msg: `guessing by "${name}" finds the key ${(acc * 100).toFixed(0)}% of the time over ${mcqs.length} MCQs (chance is 25%); distractors give the answer away` });
    }
  }
}
// near-duplicates inside a role (stems)
const byRole = new Map();
for (const q of items) (byRole.get(q.role_code) ?? byRole.set(q.role_code, []).get(q.role_code)).push(q);
for (const [role, list] of byRole) {
  const sh = list.map((q) => shingles(q.question ?? ''));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const sim = jaccard(sh[i], sh[j]);
    if (sim >= 0.5) findings.push({ sev: 'WARN', code: 'W-NEAR-DUP', id: `${list[i].id} ~ ${list[j].id}`, msg: `${(sim * 100).toFixed(0)}% similar stems in ${role}; merge or differentiate` });
  }
}

// ---------- coverage vs what sessions actually need ----------
const cov = [];
const need = (role, level, stage, label, have, perSession, attempts) => {
  const min = perSession * attempts;
  const target = Math.ceil(min * HEADROOM);
  cov.push({ role, level, stage, what: label, have, min, target, status: have < min ? 'BLOCKER' : have < target ? 'thin' : 'ok' });
};
const LEVEL_ORDER = ['entry', 'junior', 'mid', 'senior', 'expert'];
const roleLevels = new Set(items.map((q) => `${q.role_code}|${q.level}`));
for (const rl of roleLevels) {
  const [role, level] = rl.split('|');
  const at = (stage, pred) => items.filter((q) => q.role_code === role && q.level === level && q.assessment_stage === stage && pred(q)).length;
  const hasSkill = items.some((q) => q.role_code === role && q.level === level && q.assessment_stage === 'skill_assessment');
  if (hasSkill) need(role, level, 'skill', `MCQ to serve a "${level}" claimant (16 x ${SKILL_MAX_ATTEMPTS} attempts)`, at('skill_assessment', (q) => q.format === 'mcq'), SKILL_MCQ_AT_LEVEL, SKILL_MAX_ATTEMPTS);
  const hasAdv = items.some((q) => q.role_code === role && q.level === level && q.assessment_stage !== 'skill_assessment');
  if (hasAdv) {
    const adv = (pred) => at('advanced_assessment', pred) + at('extension_bank', pred);
    const isSit = (q) => q.format === 'long_text' && /incident|scenario|stakeholder/i.test(q.question_type ?? '');
    need(role, level, 'advanced', `MCQ (8 x ${ADV_PLANNED_ATTEMPTS} attempts)`, adv((q) => q.format === 'mcq'), ADV.mcq, ADV_PLANNED_ATTEMPTS);
    need(role, level, 'advanced', `short-text (2 x ${ADV_PLANNED_ATTEMPTS})`, adv((q) => q.format === 'open_ended_scenario'), ADV.short, ADV_PLANNED_ATTEMPTS);
    need(role, level, 'advanced', `long-text situational (2 x ${ADV_PLANNED_ATTEMPTS})`, adv(isSit), ADV.longSituational, ADV_PLANNED_ATTEMPTS);
    need(role, level, 'advanced', `long-text work-task (3 x ${ADV_PLANNED_ATTEMPTS})`, adv((q) => q.format === 'long_text' && !isSit(q)), ADV.longWork, ADV_PLANNED_ATTEMPTS);
  }
}
// probes: a skill claimant at level L also gets 2 MCQs from the level above and below
for (const rl of roleLevels) {
  const [role, level] = rl.split('|');
  const idx = LEVEL_ORDER.indexOf(level);
  for (const adj of [LEVEL_ORDER[idx + 1], LEVEL_ORDER[idx - 1]].filter(Boolean)) {
    const claimantsExist = items.some((q) => q.role_code === role && q.level === level && q.assessment_stage === 'skill_assessment');
    if (!claimantsExist) continue;
    const have = items.filter((q) => q.role_code === role && q.level === adj && q.assessment_stage === 'skill_assessment' && q.format === 'mcq').length;
    // below-level probe is optional in the product; only flag the level above as a blocker
    if (adj === LEVEL_ORDER[idx + 1]) {
      const min = SKILL_MCQ_PER_PROBE_LEVEL * SKILL_MAX_ATTEMPTS;
      const target = Math.ceil(min * HEADROOM);
      cov.push({ role, level: adj, stage: 'skill', what: `probe MCQs (${SKILL_MCQ_PER_PROBE_LEVEL} x ${SKILL_MAX_ATTEMPTS} for "${level}" claimants)`, have, min, target, status: have < min ? 'BLOCKER' : have < target ? 'thin' : 'ok' });
    }
  }
}

// ---------- output ----------
const errors = findings.filter((f) => f.sev === 'ERROR');
const warns = findings.filter((f) => f.sev === 'WARN');
const blockers = cov.filter((c) => c.status === 'BLOCKER');

if (flags.has('--json')) {
  console.log(JSON.stringify({ total: items.length, errors, warnings: warns, coverage: cov }, null, 2));
} else {
  const byCode = {};
  for (const f of findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  console.log(`Checked ${items.length} questions from ${files.length} file(s)\n`);
  for (const f of findings.sort((a, b) => (a.sev === b.sev ? a.code.localeCompare(b.code) : a.sev === 'ERROR' ? -1 : 1))) {
    console.log(`${f.sev.padEnd(5)} ${f.code.padEnd(16)} ${String(f.id).padEnd(24)} ${f.msg}`);
  }
  if (findings.length) console.log('');
  console.log('Findings by code:', Object.entries(byCode).map(([k, v]) => `${k}=${v}`).join('  ') || 'none');
  if (flags.has('--coverage') || blockers.length) {
    console.log('\nCoverage vs every allowed attempt (min = per-session x attempts, below this a retake runs out; target = min x' + HEADROOM + ')');
    for (const c of cov.sort((a, b) => `${a.role}${a.level}${a.stage}`.localeCompare(`${b.role}${b.level}${b.stage}`))) {
      console.log(`  ${c.status.padEnd(7)} ${c.role} ${c.level.padEnd(7)} ${c.stage.padEnd(8)} ${c.what.padEnd(44)} have ${String(c.have).padStart(3)} / min ${c.min} / target ${c.target}`);
    }
  }
  if (flags.has('--tells') && tellReport.length) {
    console.log('\nGuess-without-knowing accuracy (chance = 25%; flagged at >= ' + TELL_LIMIT * 100 + '%)');
    for (const r of tellReport.sort((a, b) => a.group.localeCompare(b.group) || b.accuracy - a.accuracy)) {
      console.log(`  ${r.accuracy >= TELL_LIMIT ? 'TELL' : '    '} ${r.group.padEnd(26)} ${r.strategy.padEnd(34)} ${(r.accuracy * 100).toFixed(0).padStart(3)}%  (n=${r.n})`);
    }
  }
  console.log(`\nResult: ${errors.length} error(s), ${warns.length} warning(s), ${blockers.length} coverage blocker(s)`);
}
process.exit(errors.length || blockers.length || (flags.has('--strict') && warns.length) ? 1 : 0);
