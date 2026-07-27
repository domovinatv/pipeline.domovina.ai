export interface Env {
  DB: D1Database;
  // Secrets (wrangler secret put):
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
  INGEST_KEY?: string;
  TRANSCRIBE_KEY?: string; // scoped token samo za /api/transcription/* (npr. Colab); INGEST_KEY također prolazi
  // Vars (wrangler.toml [vars]):
  SITE_BASE?: string; // https://domovina.ai
  CDN_BASE?: string; // https://cdn.domovina.ai — izvor istine za per-korak artefakte
  PRICE_CENTS?: string; // default cijena u centima
}

export const JOB_STATES = [
  'queued',
  'fetching',
  'transcribing',
  'processing',
  'done',
  'failed',
  'skipped', // admin: ne obrađuj (nikad se ne claima)
  'postponed', // admin: odgođeno (drži izvan queuea dok ga admin ne vrati u queued)
] as const;

export type JobState = (typeof JOB_STATES)[number];

// Transkripcijski backendi koji se natječu za isti WAV (claim/lock u D1).
export const TRANSCRIBE_BACKENDS = ['colab', 'modal'] as const;
export type TranscribeBackend = (typeof TRANSCRIBE_BACKENDS)[number];

// Magisterium (re)obrada: jezici + stanja request queuea (magisterium_jobs).
export const MAGISTERIUM_LANGS = ['hr', 'en'] as const;
export type MagisteriumLang = (typeof MAGISTERIUM_LANGS)[number];
export const MAGISTERIUM_STATES = ['queued', 'running', 'done', 'failed'] as const;
export type MagisteriumState = (typeof MAGISTERIUM_STATES)[number];

// ───────────────────────── Izbor modela za AI korake ─────────────────────────
// Koraci 7 (sažetak) + 8 (outline + članak) u fetch.domovina.tv imaju zamjenjiv backend
// (`run_pipeline.sh --gemini-backend vertex|cli|claude`, uz `CLAUDE_MODEL`/`CLAUDE_EFFORT`).
// Ovdje živi izbor koji admin napravi PO VIDEU; bridge ga prevede u zastavice/env.

export const LLM_BACKENDS = ['vertex', 'cli', 'claude'] as const;
export type LlmBackend = (typeof LLM_BACKENDS)[number];

export interface ArticleModelOption {
  value: string; // ono što ide u <select>/API: 'vertex' | 'cli' | 'claude:opus' | …
  backend: LlmBackend;
  model: string | null; // NULL = default tog backenda (gemini.conf / CLAUDE_MODEL)
  label: string;
  hint: string;
}

// ⚠️ NAMJERNO BEZ 'fable', iako ga `generate_article_gemini.js:CLAUDE_SLUGS` poznaje.
// Downstream (channel_index, CDN manifest) dedupa članke po LEKSIKOGRAFSKI NAJVEĆEM
// `_{datum}_{model}.article.json`, a slug ide u IME datoteke. 'opus'/'sonnet'/'haiku'
// počinju slovom > 'g' pa pri istom datumu pobjeđuju `gemini-*`; 'fable' počinje s 'f' < 'g'
// → članak bi se uredno generirao, spremio i NIKAD servirao. Dok se to ne popravi uzvodno
// (slug koji sortira iznad `gemini-`), Fable se ne nudi u UI-u.
export const ARTICLE_MODELS: ArticleModelOption[] = [
  {
    value: 'vertex',
    backend: 'vertex',
    model: null,
    label: 'Gemini 3.5 Flash (Vertex) — standard',
    hint: 'Dosadašnje ponašanje. Jeftino, ide na GCP kredite, global endpoint.',
  },
  {
    value: 'claude:opus',
    backend: 'claude',
    model: 'opus',
    label: 'Claude Opus (pretplata) — najviša kvaliteta',
    hint: 'claude -p --model opus pod Claude Code pretplatom (alias trenutno → Opus 5). ~5 poziva / ~430k ulaznih tokena po epizodi.',
  },
  {
    value: 'claude:sonnet',
    backend: 'claude',
    model: 'sonnet',
    label: 'Claude Sonnet (pretplata)',
    hint: 'Jeftinije od Opusa, i dalje pod pretplatom.',
  },
  {
    value: 'claude:haiku',
    backend: 'claude',
    model: 'haiku',
    label: 'Claude Haiku (pretplata)',
    hint: 'Najjeftiniji Claude put; za kratke/jednostavne videe.',
  },
  {
    value: 'cli',
    backend: 'cli',
    model: null,
    label: 'Gemini CLI (fallback)',
    hint: 'Kad Vertex zapinje (429/403) — koristi user-level google login.',
  },
];

export const DEFAULT_ARTICLE_MODEL = 'vertex';

// Razriješi vrijednost iz forme/API-ja u (backend, model). Vrati null za nepoznatu
// vrijednost — pozivatelj tada padne na default umjesto da upiše smeće u bazu.
export function parseArticleModel(
  value: string | null | undefined,
): { backend: LlmBackend; model: string | null } | null {
  if (!value) return null;
  const opt = ARTICLE_MODELS.find((o) => o.value === value);
  return opt ? { backend: opt.backend, model: opt.model } : null;
}

// Obrnuto: (backend, model) iz baze → vrijednost za <select> (da UI pokaže što je odabrano).
export function articleModelValue(backend?: string | null, model?: string | null): string {
  const opt = ARTICLE_MODELS.find(
    (o) => o.backend === (backend || 'vertex') && (o.model ?? null) === (model ?? null),
  );
  return opt?.value ?? DEFAULT_ARTICLE_MODEL;
}

// Magisterium (korak 8.5) ide isključivo kroz Claude Code CLI — runbook koristi Magisterium
// MCP alate, što Vertex/Gemini put nema. Zato samo Claude aliasi. Ponuda je namjerno ISTA
// kao za članak (bez 'fable') da UI nigdje ne nudi model koji na drugom koraku tiho pukne.
export const MAGISTERIUM_MODELS = ['opus', 'sonnet', 'haiku'] as const;
export type MagisteriumModel = (typeof MAGISTERIUM_MODELS)[number];
export const DEFAULT_MAGISTERIUM_MODEL: MagisteriumModel = 'opus';

// Validiraj model za Magisterium; nepoznat → null (pozivatelj padne na default).
export function parseMagisteriumModel(value: string | null | undefined): MagisteriumModel | null {
  if (!value) return null;
  return (MAGISTERIUM_MODELS as readonly string[]).includes(value)
    ? (value as MagisteriumModel)
    : null;
}

// Stanja koja lokalni bridge smije postaviti preko PATCH /api/jobs/:id.
export const BRIDGE_SETTABLE: JobState[] = [
  'fetching',
  'transcribing',
  'processing',
  'done',
  'failed',
];

export interface JobRow {
  id: string;
  youtube_id: string;
  youtube_url: string;
  title: string | null;
  channel: string | null;
  duration_seconds: number | null;
  source: string;
  source_platform: string; // 'youtube' | 'x' — izvorna platforma (eksplicitna metadata)
  source_url: string | null; // kanonski originalni URL (X post / YouTube watch) za linkanje
  api_key_id: string | null;
  state: JobState;
  visibility: string;
  detail_url: string | null;
  error: string | null;
  attempts: number;
  price_cents: number;
  paid: number;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  priority: number; // 0 = standard (noćni Colab bulk), 1 = prioritet (Modal instant fast-path)
  credit_cost: number; // koliko kredita je rezervirano za ovaj job (1 standard, 3 prioritet)
  with_magisterium: number; // 1 = želimo Magisterium (KORAK 8.5), 0 = admin isključio za ovaj video
  llm_backend: string; // 'vertex' (default) | 'cli' | 'claude' — backend koraka 7+8
  llm_model: string | null; // NULL = default tog backenda; inače slug ('opus'|'sonnet'|'haiku')
  magisterium_model: string | null; // NULL = 'opus' — model za MCP runbook (korak 8.5)
  transcribe_backend: string | null; // NULL | 'colab' | 'modal' — tko drži transkripciju
  transcribe_claimed_at: number | null; // unix sekunde kad je transcribe lock uzet
  done_at: number | null;
  deleted_at: number | null; // soft-delete (reverzibilno); NULL = živ job
  api_key_name?: string | null; // popunjava listJobs (LEFT JOIN api_keys) — tko je predao
  mag_hr_state?: string | null; // najnoviji magisterium_jobs.state za (youtube_id,'hr') — za admin badge
  mag_en_state?: string | null; // najnoviji magisterium_jobs.state za (youtube_id,'en')
}

// ── "Otkriveni videi" (discovered_videos) — dnevna podlista onoga što je nightly povukao.
// NIJE queue obrade: redak postoji samo da se VIDI. Tek 'promote' iz admina stvara `jobs` redak.
export const DISCOVERED_STATES = ['new', 'promoted', 'dismissed'] as const;
export type DiscoveredState = (typeof DISCOVERED_STATES)[number];

// Dokle je video stigao lokalno (bridge računa s diska na svakom nightlyju).
// Redoslijed = napredak pipelinea; admin ga prikazuje kao badge u podlisti.
export const DISCOVERED_STAGES = ['fetched', 'wav', 'transcribed', 'diarized', 'article'] as const;
export type DiscoveredStage = (typeof DISCOVERED_STAGES)[number];

export interface DiscoveredRow {
  id: string;
  youtube_id: string;
  youtube_url: string;
  title: string | null;
  channel: string | null;
  channel_dir: string | null;
  duration_seconds: number | null;
  published_at: string | null; // YYYYMMDD
  batch_date: string; // YYYY-MM-DD — dan otkrića (podlista)
  stage: string;
  promotable: number; // 0 = sintetički ID (beamly audio-only) → promote nije moguć
  source_platform: string; // 'youtube' | 'beamly'
  state: DiscoveredState;
  job_id: string | null;
  created_at: number;
  updated_at: number;
  promoted_at: number | null;
  job_state?: string | null; // popunjava listDiscovered (LEFT JOIN jobs) — stanje promoviranog joba
}

// Sažetak jedne dnevne podliste (za grupirani prikaz u adminu).
export interface DiscoveredBatch {
  batch_date: string;
  total: number;
  n_new: number;
  n_promoted: number;
  n_dismissed: number;
}

// Potrošnja tokena po videu iz Claude Code headless sesija (vidi migrations/0009).
export interface TokenUsageRow {
  youtube_id: string;
  runs: number;
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  models: string | null;
  first_at: number | null;
  last_at: number | null;
  source: string;
  updated_at: number;
}

// Red iz magisterium_jobs — request queue za (re)obradu Magisterium koraka po videu.
export interface MagisteriumJobRow {
  id: string;
  youtube_id: string;
  lang: string; // 'hr' | 'en'
  state: string; // queued | running | done | failed
  source: string; // 'admin' | 'auto'
  model: string | null; // NULL = 'opus' — model kojim poller pokreće MCP runbook
  error: string | null;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  done_at: number | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string; // SHA-256 sirovog ključa; sirovi ključ se ne pohranjuje
  credits: number; // 1 kredit = 1 obrađeni video (gate na enqueue)
  enabled: number; // 0/1
  created_at: number;
  last_used_at: number | null;
}
