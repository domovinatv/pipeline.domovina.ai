export interface Env {
  DB: D1Database;
  // Secrets (wrangler secret put):
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
  INGEST_KEY?: string;
  // Vars (wrangler.toml [vars]):
  SITE_BASE?: string; // https://domovina.ai
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
  done_at: number | null;
  deleted_at: number | null; // soft-delete (reverzibilno); NULL = živ job
}
