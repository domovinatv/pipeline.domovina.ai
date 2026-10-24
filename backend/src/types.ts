export interface Env {
  DB: D1Database;
  // R2 binding na javni CDN bucket (cdn-domovina-ai) — read-only, za /admin/jobs/:id/files
  // live listing artefakata. Optional: bez bindinga ruta vraća 503, ostalo radi normalno.
  CDN_BUCKET?: R2Bucket;
  // Secrets (wrangler secret put):
  INGEST_KEY?: string;
  TRANSCRIBE_KEY?: string; // scoped token samo za /api/transcription/* (npr. Colab); INGEST_KEY također prolazi
  // Vars (wrangler.toml [vars]):
  SITE_BASE?: string; // https://domovina.ai
  CDN_BASE?: string; // https://cdn.domovina.ai — izvor istine za per-korak artefakte
  PRICE_CENTS?: string; // default cijena u centima
  // Admin prijava (Cloudflare Access + passkey, docs/admin-auth.md) — vars, nisu tajne:
  ADMIN_EMAILS?: string; // CSV e-mailova koji smiju u /admin (provjera pri svakom zahtjevu)
  ADMIN_HOST?: string; // jedini host admina (passkey rpID = hostname)
  ACCESS_TEAM_DOMAIN?: string; // Zero Trust tim, npr. domovina.cloudflareaccess.com
  ACCESS_AUD?: string; // AUD Access aplikacije koja štiti ADMIN_HOST/admin/sso
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
  label: string; // puni opis — forma za dodavanje, gdje ima mjesta
  short: string; // kratka oznaka — select u retku tablice i badge (inače se kropa)
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
    label: 'Gemini 3.8 Flash (Vertex) — jeftina opcija',
    short: 'Gemini 3.8 Flash',
    hint: 'Bivši default (do 2026-07-29). Model čita fetch.domovina.tv/gemini.conf (GEMINI_MODEL). Jeftino, ide na GCP kredite; sklonije halucinaciji imena govornika.',
  },
  {
    value: 'claude:opus',
    backend: 'claude',
    model: 'opus',
    label: 'Claude Opus (pretplata) — default, najviša kvaliteta',
    short: 'Claude Opus',
    hint: 'claude -p --model opus pod Claude Code pretplatom (alias trenutno → Opus 5). Izmjereno ~4 poziva / ~150-210k ulaznih tokena po epizodi.',
  },
  {
    value: 'claude:sonnet',
    backend: 'claude',
    model: 'sonnet',
    label: 'Claude Sonnet (pretplata)',
    short: 'Claude Sonnet',
    hint: 'Jeftinije od Opusa, i dalje pod pretplatom.',
  },
  {
    value: 'claude:haiku',
    backend: 'claude',
    model: 'haiku',
    label: 'Claude Haiku (pretplata)',
    short: 'Claude Haiku',
    hint: 'Najjeftiniji Claude put; za kratke/jednostavne videe.',
  },
  {
    value: 'cli',
    backend: 'cli',
    model: null,
    label: 'Gemini CLI (fallback)',
    short: 'Gemini CLI',
    hint: 'Kad Vertex zapinje (429/403) — koristi user-level google login.',
  },
];

// Default od 2026-07-29: Claude Opus (premium output za trajni statični sadržaj;
// odluka nakon incidenta atribucije imena kod Gemini Flasha — Ivan Voras / cb4CsFDCDho).
// Vertex ostaje dostupan kao jeftina opcija po videu.
export const DEFAULT_ARTICLE_MODEL = 'claude:opus';

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

// ───────────────────────── Izbor transkripcije ─────────────────────────
// Vrijedi za PRIORITETNI fast-path (priority_poller.js → run_pipeline.sh). Standardni jobovi
// idu kroz nightly batch, koji ima vlastitu globalnu konfiguraciju (od 24.10.2026. Soniox +
// pyannoteAI + sluh za svjež priljev), pa ovo polje na njih nema utjecaja.
//   soniox       — cloud tok kao nightly (od 24.10.2026.): Soniox tekst (2.7b) + pyannoteAI
//                  govornici (2.7c) + Gemini sluh (2.8, promote); Speechmatics je fallback unutar
//                  2.7b. Uz to Modal Canary; rezultat ima i words.json (titl riječ po riječ).
//   canary       — samo Modal Canary + pyannote. Jeftino, bez words.json.
// 'speechmatics' je ZASTARJELA vrijednost (do 24.10.2026.): ulaz je i dalje prihvaća kao alias
// za 'soniox' (stari /api/v1 klijenti), a stari D1 reci je zadržavaju jer su stvarno išli
// Speechmaticsom. Bridge (plan.js) obje mapira na isti cloud tok.
export const TRANSCRIPTIONS = ['soniox', 'canary'] as const;
export type Transcription = (typeof TRANSCRIPTIONS)[number];
export const DEFAULT_TRANSCRIPTION: Transcription = 'soniox';
export const LEGACY_TRANSCRIPTION_ALIASES: Record<string, Transcription> = { speechmatics: 'soniox' };

export interface TranscriptionOption {
  value: Transcription;
  label: string;
  short: string;
  hint: string;
}
export const TRANSCRIPTION_OPTIONS: TranscriptionOption[] = [
  {
    value: 'soniox',
    label: 'Soniox + pyannoteAI + Gemini sluh (kao nightly) — default',
    short: 'Soniox',
    hint: 'Soniox tekst + pyannoteAI govornici (tko/kada) + Gemini 3.8 Flash čuje zvuk i piše tekst; Speechmatics je rezerva kad Soniox padne, uz to i Modal Canary. Daje words.json (titl riječ po riječ). ~$0.4-0.7 po epizodi od 45 min.',
  },
  {
    value: 'canary',
    label: 'Samo Canary + pyannote (jeftino)',
    short: 'Canary',
    hint: 'Modal Canary + lokalna pyannote diarizacija. ~$0.01 po epizodi, bez words.json; sklono „mljevenju" iste riječi na teškom zvuku.',
  },
];

// Ponovna obrada smije i ne dirati prijepis (npr. samo novi članak ili samo Magisterium).
export const TRANSCRIPTION_NONE = 'none';

// Validiraj izbor transkripcije; nepoznat/izostavljen → null (pozivatelj padne na default).
// 'none' prolazi samo uz allowNone (ponovna obrada) — novi video bez prijepisa nema smisla.
export function parseTranscription(
  value: string | null | undefined,
  allowNone = false,
): Transcription | typeof TRANSCRIPTION_NONE | null {
  if (!value) return null;
  if (allowNone && value === TRANSCRIPTION_NONE) return TRANSCRIPTION_NONE;
  if (LEGACY_TRANSCRIPTION_ALIASES[value]) return LEGACY_TRANSCRIPTION_ALIASES[value];
  return (TRANSCRIPTIONS as readonly string[]).includes(value) ? (value as Transcription) : null;
}

// Ponovna obrada: novi prijepis UVIJEK povlači novi članak (poglavlja/citati starog ne
// odgovaraju novom tekstu); „ne diraj članak" vrijedi samo uz 'none'. Jedno pravilo za
// /admin formu i /api/v1 — klijentski UI ga samo zrcali (REPROCESS_WIRE_JS).
export function reprocessRedoArticle(transcription: string, articleMode: string | null | undefined): boolean {
  return transcription !== TRANSCRIPTION_NONE || articleMode !== 'keep';
}

// ───────────────────────── Krediti (API ključevi) ─────────────────────────
// Cloud tok ('soniox'; stari reci 'speechmatics') košta naspram ~$0.01 za Canary više, pa prioritetni job s njim
// rezervira 2 kredita više. (Uz Speechmatics je bilo ~$2-2.5/ep; od 24.10.2026. Soniox +
// pyannoteAI + sluh ≈ $0.4-0.7/ep — cijena u kreditima NAMJERNO nije dirana, to je
// poslovna odluka, ne posljedica promjene ASR-a.) Standardni job ide kroz nightly (globalna konfiguracija)
// pa za njega izbor transkripcije ne mijenja cijenu. Ponovna obrada je uvijek prioritetna;
// bez novog prijepisa ('none') košta kao Canary.
export const STANDARD_COST = 1;
export function priorityCost(transcription: string): number {
  return transcription === 'soniox' || transcription === 'speechmatics' ? 5 : 3;
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
  transcription: string; // 'soniox' | 'canary' | 'none' (stari reci: 'speechmatics') (samo reprocess) — NAMJERA za prioritetni fast-path (≠ transcribe_backend)
  reprocess: number; // 1 = namjerna ponovna obrada već objavljene epizode
  redo_article: number; // 0 = ne diraj postojeći članak (samo reprocess bez novog prijepisa)
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
  force: number; // 1 = regeneriraj iako artefakt već postoji (ponovna obrada)
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

// ── Inventar epizoda (episodes) — sve što je na disku Mac Minija + stanje po koraku.
// Puni ga bridge/report_inventory.js (migrations/0014). Nije queue: ništa se ne pokreće samo od sebe.
export const EPISODE_STEP_VALUES = ['ok', 'missing', 'blocked', 'partial', 'na'] as const;
// soniox = Soniox(+pyannoteAI) prijepis na disku; speechmatics = stariji cloud prijepis.
export const EPISODE_TRANSCRIPTS = ['soniox', 'speechmatics', 'canary', 'none'] as const;

// Koraci po kojima admin filtrira „fali korak X" (whitelist = imena stupaca, ide u SQL).
// Redoslijed = run_pipeline.sh. `transcript` je poseban (vrijednost je backend, ne ok/missing).
export const EPISODE_STEPS = [
  { key: 'fetch', label: 'Preuzimanje' },
  { key: 'transcript', label: 'Transkript' },
  { key: 'diarized', label: 'Diarizacija' },
  { key: 'summary', label: 'Sažetak' },
  { key: 'article', label: 'Članak' },
  { key: 'rag', label: 'RAG' },
  { key: 'screenshots', label: 'Screenshotovi' },
  { key: 'epub', label: 'EPUB' },
  { key: 'words', label: 'Riječi' },
  { key: 'magisterium_hr', label: 'Magisterium HR' },
  { key: 'article_en', label: 'Članak EN' },
  { key: 'magisterium_en', label: 'Magisterium EN' },
  { key: 'cdn', label: 'CDN' },
] as const;
export type EpisodeStepKey = (typeof EPISODE_STEPS)[number]['key'];

export interface EpisodeRow {
  youtube_id: string;
  channel_dir: string;
  channel: string | null;
  title: string | null;
  upload_date: string | null; // YYYYMMDD
  duration_seconds: number | null;
  audio_only: number;
  fetch: string;
  transcript: string; // soniox | speechmatics | canary | none
  diarized: string;
  summary: string;
  article: string;
  article_model: string | null;
  article_date: string | null;
  article_sections: number | null; // Σ sekcija najnovijeg članka — trajanje EN prijevoda
  rag: string;
  screenshots: string;
  epub: string;
  words: string;
  magisterium_hr: string;
  magisterium_en: string;
  article_en: string;
  cdn: string | null; // NULL = Worker još nije probao CDN
  cdn_checked_at: number | null;
  first_seen_at: number;
  updated_at: number;
  // Popunjava listEpisodes (korelirani subupiti) — ⏳ u adminu.
  active_job_state?: string | null; // aktivan job (queued/fetching/transcribing/processing)
  mag_hr_state?: string | null;
  mag_en_state?: string | null;
}
