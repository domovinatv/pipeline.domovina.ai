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
}

export interface PipelineReport {
  youtube_id: string;
  state: string;
  detail_url: string | null;
  steps: StepStatus[];
}

// Probaj jedan artefakt. GET s Range bytes=0-0 (ne HEAD): Cloudflare cache-ira
// 404 po točnom URL-u, a Range izbjegava povlačenje punog tijela (npr. video_h264.mp4).
async function artifactExists(cdnBase: string, youtubeId: string, artifact: string): Promise<boolean> {
  try {
    const r = await fetch(`${cdnBase}/data/${youtubeId}/${artifact}`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}

/**
 * Sastavi izvještaj o koracima za jedan video. Probe-ovi idu paralelno.
 * Logika statusa po koraku:
 *   artefakt postoji            → done
 *   nema, korak je optional     → skipped (npr. Magisterium bez --with-magisterium)
 *   nema, korak je obavezan     → pending (čeka pipeline)
 */
export async function buildPipelineReport(
  cdnBase: string,
  job: { youtube_id: string; state: string; detail_url: string | null },
): Promise<PipelineReport> {
  const probes = await Promise.all(
    PIPELINE_STEPS.map((s) =>
      s.artifact ? artifactExists(cdnBase, job.youtube_id, s.artifact) : Promise.resolve(false),
    ),
  );

  const steps: StepStatus[] = PIPELINE_STEPS.map((s, i) => {
    const present = probes[i];
    const state: StepState = present ? 'done' : s.optional ? 'skipped' : 'pending';
    return { key: s.key, label: s.label, note: s.note, optional: !!s.optional, state };
  });

  // Završni izvedeni korak: objavljeno na frontendu (job done + detail_url).
  steps.push({
    key: 'live',
    label: 'Objavljeno na domovina.ai',
    note: 'Video je dostupan na /v/{id} (članak live na CDN-u)',
    optional: false,
    state: job.state === 'done' && job.detail_url ? 'done' : 'pending',
  });

  return {
    youtube_id: job.youtube_id,
    state: job.state,
    detail_url: job.detail_url,
    steps,
  };
}
