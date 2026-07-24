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
  transcribe_backend: string | null; // NULL | 'colab' | 'modal' — tko drži transkripciju
  transcribe_claimed_at: number | null; // unix sekunde kad je transcribe lock uzet
  done_at: number | null;
  deleted_at: number | null; // soft-delete (reverzibilno); NULL = živ job
  api_key_name?: string | null; // popunjava listJobs (LEFT JOIN api_keys) — tko je predao
  mag_hr_state?: string | null; // najnoviji magisterium_jobs.state za (youtube_id,'hr') — za admin badge
  mag_en_state?: string | null; // najnoviji magisterium_jobs.state za (youtube_id,'en')
}

// Red iz magisterium_jobs — request queue za (re)obradu Magisterium koraka po videu.
export interface MagisteriumJobRow {
  id: string;
  youtube_id: string;
  lang: string; // 'hr' | 'en'
  state: string; // queued | running | done | failed
  source: string; // 'admin' | 'auto'
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
