/**
 * pipeline.ts — granularni prikaz koraka kroz koje video prolazi u
 * `../fetch.domovina.tv/run_pipeline.sh`.
 *
 * Job u D1 ima samo grubo stanje (queued→fetching→transcribing→processing→done).
 * Za "kroz koje je korake video STVARNO prošao" izvor istine NIJE baza nego CDN:
 * svaki korak pipelinea objavi svoj artefakt pod `data/{id}/…` (vidi
 * fetch.domovina.tv/upload_to_r2.js flutter-key mapping). Probamo te ključeve
 * server-side iz Workera (nema CORS-a) i izvedemo status po koraku.
 *
 * Zašto CDN, a ne PATCH-evi iz bridgea: bridge javlja samo grube prijelaze, a
 * koraci poput Magisterium obogaćivanja (KORAK 8.5, opcionalan --with-magisterium)
 * nemaju vlastiti job state. Artefakt na CDN-u je jedini pouzdan, idempotentan signal.
 */

import { updateJob } from './db';

export interface PipelineStep {
  key: string;
  label: string;
  /** Ključ pod data/{id}/ koji ovaj korak objavi; null = izvedeno iz job stanja. */
  artifact: string | null;
  /** Korak ovisi o opcijskom flagu u run_pipeline.sh → odsutnost ≠ greška. */
  optional?: boolean;
  /** Kratko objašnjenje + mapiranje na KORAK iz run_pipeline.sh. */
  note: string;
}

// Redoslijed = redoslijed u run_pipeline.sh. Pokrivamo korake koji imaju
// per-video CDN artefakt (jedini pouzdano provjerljiv signal). Koraci bez
// per-video artefakta (WAV konverzija, RAG prep, channel index) namjerno se
// ne prikazuju da status ostane točan, a ne pretpostavljen.
export const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: 'fetch',
    label: 'Preuzimanje videa',
    artifact: 'info.json',
    note: 'yt-dlp skinuo video + metapodatke (KORAK 1)',
  },
  {
    key: 'transcribe',
    label: 'Transkripcija + diarizacija',
    artifact: 'diarized.srt',
    note: 'Canary SRT s govornicima (KORAK 6)',
  },
  {
    key: 'summary',
    label: 'Sumarizacija',
    artifact: 'summary.json',
    note: 'Gemini sažetak transkripta (KORAK 7)',
  },
  {
    key: 'outline',
    label: 'Outline',
    artifact: 'outline.json',
    note: 'Poglavlja + timestampovi (KORAK 8)',
  },
  {
    key: 'article',
    label: 'Članak',
    artifact: 'article.json',
    note: 'Gemini generirani članak (KORAK 8)',
  },
  {
    key: 'magisterium',
    label: 'Magisterium AI',
    // Produkcijski put je MCP hibrid (prep → chat → assemble) → article.magisterium.json,
    // NE API skripta enrich_magisterium_full.js (.magisterium_full_v2.json — nije u upotrebi).
    // Vidi fetch.domovina.tv/docs/PIPELINE_FULL.md §2.3 + MAGISTERIUM_MCP_RUN.md.
    artifact: 'article.magisterium.json',
    optional: true,
    note: 'Teološko obogaćivanje preko Magisterium MCP (KORAK 8.5)',
  },
  {
    key: 'video',
    label: 'H.264 video',
    artifact: 'video_h264.mp4',
    note: 'Cross-platform video (KORAK 12.5)',
  },
];

export type StepState = 'done' | 'pending' | 'skipped';

export interface StepStatus {
  key: string;
  label: string;
  note: string;
  optional: boolean;
  state: StepState;
  /** Link na rezultat koraka (CDN artefakt / live stranica); null ako još nema što otvoriti. */
  url: string | null;
  /** Kad je artefakt objavljen na CDN-u (unix sek, iz Last-Modified); null ako ga nema. */
  at: number | null;
  /** Sekunde od prethodnog gotovog koraka — koliko je ovaj korak "trajao". */
  delta_seconds: number | null;
  /** Artefakt je stariji od prethodnog koraka (ponovna objava, npr. regeneriran članak). */
  out_of_order: boolean;
}

/**
 * Vremenski okvir obrade.
 *
 * Dva su izvora i NAMJERNO se prikazuju odvojeno jer mjere različite stvari:
 *   • job (D1)   — queued_at/started_at/done_at: kad je job ušao u queue, kad ga je bridge
 *                  claimao i kad je javljen gotovim. Ovo je pravo trajanje OBRADE.
 *   • artefakti  — first/last Last-Modified s CDN-a. Ovo je raspon OBJAVE artefakata i
 *                  pokriva i videe koji nikad nisu prošli kroz queue (redovni kanalni put).
 * Za multi-pass realnost (fetch → čekanje Colaba → noćna AI obrada) raspon artefakata je
 * često informativniji od job trajanja, pa se prikazuju oba.
 */
export interface PipelineTiming {
  queued_at: number | null;
  started_at: number | null;
  done_at: number | null;
  /** done_at − started_at (ili raspon artefakata kad job timestampovi fale). */
  total_seconds: number | null;
  first_artifact_at: number | null;
  last_artifact_at: number | null;
  artifact_span_seconds: number | null;
}

export interface PipelineReport {
  youtube_id: string;
  state: string;
  detail_url: string | null;
  timing: PipelineTiming;
  steps: StepStatus[];
}

export interface ArtifactProbe {
  present: boolean;
  /** Unix sekunde iz Last-Modified zaglavlja; null kad ga nema (ili artefakt ne postoji). */
  at: number | null;
}

// Probaj jedan artefakt. GET s Range bytes=0-0 (ne HEAD): Cloudflare cache-ira
// 404 po točnom URL-u, a Range izbjegava povlačenje punog tijela (npr. video_h264.mp4).
// Uz postojanje čitamo i Last-Modified — R2 ga vraća i kroz Cloudflare edge, pa dobivamo
// vrijeme objave koraka bez ijednog dodatnog zahtjeva.
async function probeArtifact(
  cdnBase: string,
  youtubeId: string,
  artifact: string,
): Promise<ArtifactProbe> {
  try {
    const r = await fetch(`${cdnBase}/data/${youtubeId}/${artifact}`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    if (!r.ok && r.status !== 206) return { present: false, at: null };
    const lm = r.headers.get('last-modified');
    const ms = lm ? Date.parse(lm) : NaN;
    return { present: true, at: Number.isFinite(ms) ? Math.floor(ms / 1000) : null };
  } catch {
    return { present: false, at: null };
  }
}

async function artifactExists(cdnBase: string, youtubeId: string, artifact: string): Promise<boolean> {
  return (await probeArtifact(cdnBase, youtubeId, artifact)).present;
}

/**
 * Je li epizoda već objavljena na domovina.ai? Izvor istine je CDN, ne naš queue:
 * članak (`article.json`) je artefakt koji ide live na `/v/{id}`. Ako postoji,
 * video je već prošao glavni pipeline i objavljen — čak i ako u NAŠOJ bazi nema
 * joba (npr. epizoda obrađena kroz redovni kanal, a ne ovaj ad-hoc queue). Zato
 * lokalni dedup (findActiveJobByYoutubeId) nije dovoljan; ova provjera hvata
 * duplikate koje bi inače nepotrebno ponovno obradili.
 */
export async function isPublishedOnDomovina(cdnBase: string, youtubeId: string): Promise<boolean> {
  return artifactExists(cdnBase, youtubeId, 'article.json');
}

// Ne-terminalna stanja koja mogu "zaostati" za CDN realnošću (bridge nije stigao
// PATCH-ati, ili je epizoda već bila objavljena prije nego je uopće ušla u queue).
const IN_PROGRESS_STATES = new Set(['fetching', 'transcribing', 'processing']);

/**
 * Self-heal: jobovi u ne-terminalnom stanju čiji je članak VEĆ live na CDN-u
 * prebace se u 'done' + detail_url, da status u admin/dashboard tablici ne laže
 * (npr. red zaglavljen u FETCHING iako su svi koraci gotovi). Isti signal koji
 * koristi bridge reconcile.js (article.json), ali ovdje u Workeru — ne ovisi o
 * cronu Mac Minija. Ograničeno na `cap` jobova po pozivu (bounded subrequesti;
 * 404 probe su edge-cache-ani pa su jeftini). Mutira `jobs` in-place tako da
 * ISTI odgovor odmah odražava stvarno stanje. Vrati broj izliječenih.
 */
export async function reconcilePublishedJobs(
  db: D1Database,
  cdnBase: string,
  siteBase: string,
  jobs: Array<{ id: string; youtube_id: string; state: string; detail_url: string | null; deleted_at: number | null }>,
  cap = 25,
): Promise<number> {
  const base = (siteBase || 'https://domovina.ai').replace(/\/$/, '');
  const candidates = jobs.filter((j) => !j.deleted_at && IN_PROGRESS_STATES.has(j.state)).slice(0, cap);
  const results = await Promise.all(
    candidates.map(async (j) => {
      if (!(await isPublishedOnDomovina(cdnBase, j.youtube_id))) return false;
      const detailUrl = j.detail_url || `${base}/v/${j.youtube_id}`;
      await updateJob(db, j.id, { state: 'done', detailUrl });
      j.state = 'done';
      j.detail_url = detailUrl;
      return true;
    }),
  );
  return results.filter(Boolean).length;
}

/**
 * Sastavi izvještaj o koracima za jedan video. Probe-ovi idu paralelno.
 * Logika statusa po koraku:
 *   artefakt postoji            → done
 *   nema, korak obavezan        → pending (čeka pipeline)
 *   nema, korak optional (Magisterium):
 *     with_magisterium ≠ 0      → pending ("čeka" — puna obrada se očekuje, MCP run još nije napravljen)
 *     with_magisterium = 0      → skipped ("preskočeno" — admin isključio za ovaj video)
 */
export async function buildPipelineReport(
  cdnBase: string,
  job: {
    youtube_id: string;
    state: string;
    detail_url: string | null;
    with_magisterium?: number;
    created_at?: number | null;
    claimed_at?: number | null;
    done_at?: number | null;
  },
  siteBase?: string,
): Promise<PipelineReport> {
  const wantMagisterium = job.with_magisterium !== 0; // undefined/1 → želimo; 0 → admin isključio
  const probes = await Promise.all(
    PIPELINE_STEPS.map((s) =>
      s.artifact
        ? probeArtifact(cdnBase, job.youtube_id, s.artifact)
        : Promise.resolve<ArtifactProbe>({ present: false, at: null }),
    ),
  );

  const probeTimes = probes.map((p) => p.at).filter((t): t is number => t !== null);
  const earliestArtifact = probeTimes.length ? Math.min(...probeTimes) : null;

  // Sidro za Δ PRVOG koraka. Job claim je dobro sidro samo ako je job stvarno pokrenuo ovu
  // obradu — kad je job noviji od najstarijeg artefakta (video je već postojao pa je naknadno
  // ubačen u queue, npr. promoviran iz otkrivenih ili re-dodan radi regeneracije), mjerenje
  // "od claima" bi svaki stariji korak lažno proglasilo ponovnom objavom. U tom slučaju prvi
  // korak nema od čega mjeriti → Δ ostaje null umjesto izmišljene vrijednosti.
  let prevAt: number | null =
    job.claimed_at && (earliestArtifact === null || job.claimed_at <= earliestArtifact)
      ? job.claimed_at
      : null;

  const steps: StepStatus[] = PIPELINE_STEPS.map((s, i) => {
    const { present, at } = probes[i];
    // Optional korak (Magisterium): odsutan artefakt je "čeka" ako je namjera obraditi, inače "preskočeno".
    const state: StepState = present
      ? 'done'
      : s.optional
        ? wantMagisterium
          ? 'pending'
          : 'skipped'
        : 'pending';
    // Link nudimo samo kad artefakt stvarno postoji (inače bi 404-ao).
    const url = present && s.artifact ? `${cdnBase}/data/${job.youtube_id}/${s.artifact}` : null;

    // Δ = koliko je prošlo od prethodnog gotovog koraka. Negativan Δ NIJE greška nego signal
    // ponovne objave (npr. članak regeneriran Opusom mjesecima nakon Magisteriuma) — tada ga
    // ne prikazujemo kao trajanje, samo označimo redoslijed. Sidro se pomiče isključivo
    // naprijed, da jedna re-objava ne pokvari Δ svim koracima iza sebe.
    let delta: number | null = null;
    let outOfOrder = false;
    if (present && at !== null) {
      if (prevAt !== null) {
        if (at >= prevAt) delta = at - prevAt;
        else outOfOrder = true;
      }
      if (prevAt === null || at > prevAt) prevAt = at;
    }
    return {
      key: s.key,
      label: s.label,
      note: s.note,
      optional: !!s.optional,
      state,
      url,
      at,
      delta_seconds: delta,
      out_of_order: outOfOrder,
    };
  });

  // Završni izvedeni korak: objavljeno na frontendu. Izvor istine je CDN, ne naš
  // job state — epizoda je live čim članak postoji na CDN-u, i onda kad job kod
  // nas nije 'done' (npr. dodana u ad-hoc queue iako je već prošla glavni pipeline).
  const articlePresent = steps.find((s) => s.key === 'article')?.state === 'done';
  const liveDone = (job.state === 'done' && !!job.detail_url) || articlePresent;
  const base = (siteBase || 'https://domovina.ai').replace(/\/$/, '');
  const liveUrl = job.detail_url || (articlePresent ? `${base}/v/${job.youtube_id}` : null);
  steps.push({
    key: 'live',
    label: 'Objavljeno na domovina.ai',
    note: 'Video je dostupan na /v/{id} (članak live na CDN-u)',
    optional: false,
    state: liveDone ? 'done' : 'pending',
    url: liveDone ? liveUrl : null,
    // Live nije zaseban artefakt — nastaje u trenutku kad članak sleti na CDN.
    at: steps.find((s) => s.key === 'article')?.at ?? null,
    delta_seconds: null,
    out_of_order: false,
  });

  // Raspon objave artefakata (pokriva i videe koji nikad nisu bili u queueu).
  const times = steps.map((s) => s.at).filter((t): t is number => t !== null);
  const firstArtifactAt = times.length ? Math.min(...times) : null;
  const lastArtifactAt = times.length ? Math.max(...times) : null;

  // Ukupno trajanje: primarno job (claimed→done) jer mjeri stvarnu obradu; kad job
  // timestampova nema (ili job još traje), padni na raspon artefakata.
  const jobTotal =
    job.claimed_at && job.done_at && job.done_at >= job.claimed_at
      ? job.done_at - job.claimed_at
      : null;
  const artifactSpan =
    firstArtifactAt !== null && lastArtifactAt !== null ? lastArtifactAt - firstArtifactAt : null;

  return {
    youtube_id: job.youtube_id,
    state: job.state,
    detail_url: job.detail_url,
    timing: {
      queued_at: job.created_at ?? null,
      started_at: job.claimed_at ?? null,
      done_at: job.done_at ?? null,
      total_seconds: jobTotal ?? artifactSpan,
      first_artifact_at: firstArtifactAt,
      last_artifact_at: lastArtifactAt,
      artifact_span_seconds: artifactSpan,
    },
    steps,
  };
}
