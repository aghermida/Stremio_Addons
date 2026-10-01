const API = 'https://www.rtve.es/api';
const ZTNR = 'https://ztnr.rtve.es/ztnr';
const RESOURCES = 'https://www.rtve.es/resources';
// RTVE's CDN (Fastly) answers 403 to requests without a browser User-Agent.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
export const FILM_TYPE = 'Contenedor Películas';
const COMPLETE_TYPE = 39816; // video "type" id for "Completo" (full episode / film)

export interface Program {
  id: string;
  name: string;
  description: string;
  programType: string | null;
  numSeasons: number;
  poster?: string;
  background?: string;
  logo?: string;
  genres: string[];
  cast: string[];
  directors: string[];
}

export interface Video {
  id: string;
  title: string;
  description: string;
  thumbnail?: string;
  duration?: number;
  published?: string;
  season: number | null;
  episode: number | null;
  programTitle?: string;
  programId?: string;
  year?: number;
  imdb?: string;
  directors: string[];
  cast: string[];
}

export interface StreamInfo {
  sources: { label: string; url: string }[];
  subtitles: { lang: string; url: string }[];
}

// ---- tiny cache + concurrency limiter -------------------------------------

const cache = new Map<string, { exp: number; value: Promise<unknown> }>();

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { exp: Date.now() + ttlMs, value });
  value.catch(() => cache.delete(key)); // never keep failures
  return value;
}

let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 6) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function getJson<T>(url: string): Promise<T> {
  return limited(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (res.ok) return (await res.json()) as T;
        lastErr = new Error(`${res.status} ${url}`);
        if (res.status === 404) break;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    throw lastErr;
  });
}

// ---- helpers --------------------------------------------------------------

const splitNames = (s: unknown): string[] =>
  typeof s === 'string' && s ? s.split('|').map((x) => x.trim()).filter(Boolean) : [];

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  agrave: 'à', egrave: 'è', ograve: 'ò', iquest: '¿', iexcl: '¡', ccedil: 'ç',
};

const stripHtml = (s: unknown): string =>
  typeof s === 'string'
    ? s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m)
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : '';

export const normalize = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function toProgram(i: any): Program {
  return {
    id: String(i.id),
    name: i.name ?? i.title,
    description: stripHtml(i.longDescription) || stripHtml(i.description),
    programType: i.programType ?? null,
    numSeasons: Number(i.numSeasons) || 0,
    poster: i.imgPoster || i.imgPortada || i.thumbnail || undefined,
    background: i.imgBackground || i.imgBanner || undefined,
    logo: i.logo || undefined,
    genres: Array.isArray(i.generos) ? i.generos.map((g: any) => g.generoInf).filter(Boolean) : [],
    cast: splitNames(i.showMan).concat(splitNames(i.casting)),
    directors: splitNames(i.director),
  };
}

function toVideo(i: any): Video {
  const title: string = i.longTitle || i.title || '';
  const prog: string | undefined = i.programInfo?.title;
  const prefix = prog ? `${prog} - ` : '';
  const ts = Number(i.publicationDateTimestamp);
  const prodYear = String(i.productionDate ?? '').match(/\d{4}/)?.[0];
  return {
    id: String(i.id),
    title: prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title,
    description: stripHtml(i.description) || stripHtml(i.shortDescription),
    thumbnail: i.thumbnail || undefined,
    duration: Number(i.duration) || undefined,
    published: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : undefined,
    season: null,
    episode: Number(i.episode) > 0 ? Number(i.episode) : null,
    programTitle: prog,
    programId: i.programInfo?.id ? String(i.programInfo.id) : undefined,
    year: prodYear ? Number(prodYear) : undefined,
    imdb: /^tt\d+$/.test(String(i.idImdb ?? '')) ? String(i.idImdb) : undefined,
    directors: splitNames(i.director),
    cast: splitNames(i.casting),
  };
}

// ---- programs index -------------------------------------------------------

/** All ~4,700 programs, fetched once and refreshed every 6h. Audio-only (radio) programs are dropped. */
export function getPrograms(): Promise<Program[]> {
  return cached('programs', 6 * 3600_000, async () => {
    const byId = new Map<string, Program>();
    for (let page = 1; page <= 20; page++) {
      const d = await getJson<any>(`${API}/programas.json?size=500&page=${page}`);
      for (const i of d.page.items as any[]) {
        if (String(i.htmlUrl ?? '').includes('/play/audios/')) continue;
        if (i.pubState?.code && i.pubState.code !== 'ENPUB') continue;
        byId.set(String(i.id), toProgram(i));
      }
      if (page >= d.page.totalPages) break;
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });
}

export async function getProgram(id: string): Promise<Program | undefined> {
  return (await getPrograms()).find((p) => p.id === id);
}

// ---- videos ---------------------------------------------------------------

/** One page of full-length videos of a program (newest first). */
export function getProgramVideos(programId: string, page: number, size: number): Promise<Video[]> {
  return cached(`pv:${programId}:${page}:${size}`, 15 * 60_000, async () => {
    const d = await getJson<any>(
      `${API}/programas/${programId}/videos.json?type=${COMPLETE_TYPE}&size=${size}&page=${page}`
    );
    return (d.page.items as any[]).map(toVideo);
  });
}

export function getVideo(id: string): Promise<Video | undefined> {
  return cached(`v:${id}`, 3600_000, async () => {
    try {
      const d = await getJson<any>(`${API}/videos/${id}.json`);
      const item = d.page?.items?.[0];
      return item ? toVideo(item) : undefined;
    } catch {
      return undefined;
    }
  });
}

/** All full episodes of a program, ascending, with season/episode numbers filled in. */
export function getEpisodes(programId: string, max: number): Promise<Video[]> {
  return cached(`eps:${programId}`, 3600_000, async () => {
    const seasons = await getJson<any>(`${API}/programas/${programId}/temporadas.json?size=100`);
    const list = ((seasons.page?.items ?? []) as any[])
      .map((s) => ({ id: s.id as number, order: Number(s.orden) || 0 }))
      .sort((a, b) => a.order - b.order);

    const out: Video[] = [];
    if (list.length) {
      const perSeason = await Promise.all(
        list.map(async (s, idx) => {
          const vids: Video[] = [];
          for (let page = 1; page <= 10; page++) {
            const d = await getJson<any>(
              `${API}/programas/${programId}/temporadas/${s.id}/videos.json?type=${COMPLETE_TYPE}&size=100&page=${page}`
            );
            vids.push(...(d.page.items as any[]).map(toVideo));
            if (page >= d.page.totalPages) break;
          }
          const seasonNo = s.order > 0 ? s.order : idx + 1;
          const asc = vids.reverse(); // API is newest first
          asc.forEach((v, n) => {
            v.season = seasonNo;
            v.episode ??= n + 1;
          });
          return asc;
        })
      );
      perSeason.forEach((v) => out.push(...v));
    } else {
      // No seasons: the most recent `max` full videos as season 1, oldest first.
      const vids: Video[] = [];
      for (let page = 1; vids.length < max; page++) {
        const d = await getJson<any>(
          `${API}/programas/${programId}/videos.json?type=${COMPLETE_TYPE}&size=100&page=${page}`
        );
        vids.push(...(d.page.items as any[]).map(toVideo));
        if (page >= d.page.totalPages) break;
      }
      const asc = vids.slice(0, max).reverse();
      asc.forEach((v, n) => {
        v.season = 1;
        v.episode = n + 1;
      });
      out.push(...asc);
    }
    return out;
  });
}

// ---- films index ----------------------------------------------------------

export interface FilmIndex {
  byContainer: Map<string, Video[]>; // container program name -> films, newest first
  byImdb: Map<string, Video[]>;
}

// Film containers such as "Cine de barrio" mostly hold the presenter's intro
// (3-25 min) as a "Completo" video, not the film. Real films are >= 60 min.
const MIN_FILM_MS = 60 * 60_000;

/** All full-length films of the film containers, deduplicated; refreshed every 6h. */
export function getFilmIndex(): Promise<FilmIndex> {
  return cached('films', 6 * 3600_000, async () => {
    const containers = (await getPrograms()).filter((p) => p.programType === FILM_TYPE);
    const seen = new Set<string>();
    const byContainer = new Map<string, Video[]>();
    const byImdb = new Map<string, Video[]>();

    await Promise.all(
      containers.map(async (c) => {
        const films: Video[] = [];
        for (let page = 1; page <= 20; page++) {
          const d = await getJson<any>(
            `${API}/programas/${c.id}/videos.json?type=${COMPLETE_TYPE}&size=100&page=${page}`
          );
          for (const item of d.page.items as any[]) {
            const v = toVideo(item);
            if ((v.duration ?? 0) < MIN_FILM_MS || seen.has(v.id)) continue;
            seen.add(v.id);
            films.push(v);
            if (v.imdb) byImdb.set(v.imdb, [...(byImdb.get(v.imdb) ?? []), v]);
          }
          if (page >= d.page.totalPages) break;
        }
        if (films.length) {
          films.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));
          byContainer.set(c.name, films);
        }
      })
    );
    return { byContainer, byImdb };
  });
}

// ---- streams --------------------------------------------------------------

/**
 * Resolves playable HLS URLs, best quality first. They are built from the
 * `presets` list of ztnr's JSON (the same way yt-dlp does): that gives the
 * plain CDN manifest even for videos flagged as DRM, for which the
 * `ztnr/{id}.m3u8` redirect only offers the encrypted `hls_drm` manifest.
 * CDN URLs are not bound to the caller's IP, so they go straight to the
 * Stremio client (no proxying through this server).
 */
const QUALITY_LABEL: Record<string, string> = { HD_FULL: '1080p', HD_READY: '720p', HQ: '576p', Alta: '360p' };
const QUALITY_ORDER = ['HD_FULL', 'HD_READY', 'HQ', 'Alta'];
const HD_QUALITIES = ['HD_FULL', 'HD_READY']; // 720p and above
const HLS_HOST = 'https://rtvehlsvodlote7.rtve.es/mediavodv2/resources';

/**
 * 'ok' = plain manifest; 'blocked' = 403 (some renditions are limited to Spanish
 * IPs, and this server may not be in Spain, so the client may still be able to
 * play it); 'bad' = missing, encrypted or not a manifest.
 */
async function checkHls(url: string): Promise<'ok' | 'blocked' | 'bad'> {
  try {
    const res = await limited(() => fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }));
    if (res.status === 403) return 'blocked';
    if (!res.ok) return 'bad';
    const body = await res.text();
    return body.startsWith('#EXTM3U') && !/#EXT-X-(SESSION-)?KEY/.test(body) ? 'ok' : 'bad';
  } catch {
    return 'bad';
  }
}

export function getStream(id: string): Promise<StreamInfo> {
  return cached(`st:${id}`, 5 * 60_000, async () => {
    const info: StreamInfo = { sources: [], subtitles: [] };

    try {
      const d = (await getJson<any>(`${ZTNR}/${id}.json`))['0'] ?? {};
      const subs = (d.subtitulos ?? []) as { subtitulo: string; idioma: string }[];
      info.subtitles = subs.map((s) => ({ lang: s.idioma, url: `${RESOURCES}/${s.subtitulo}` }));

      const presets = ((d.presets ?? []) as { fichero: string; quality: string }[])
        .filter((p) => p.fichero && d.catuid)
        .sort((a, b) => QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality));
      // Drop sub-720p renditions, unless nothing at 720p or above exists.
      const hd = presets.filter((p) => HD_QUALITIES.includes(p.quality));
      const candidates = (hd.length ? hd : presets).map((p) => ({
        label: QUALITY_LABEL[p.quality] ?? p.quality,
        url: `${HLS_HOST}/${d.catuid}/${p.fichero}/video.m3u8?hls_no_audio_only=true&hls_client_manifest_version=3&idasset=${id}`,
      }));
      const checks = await Promise.all(candidates.map((c) => checkHls(c.url)));
      candidates.forEach((c, i) => checks[i] !== 'bad' && info.sources.push(c));
    } catch {
      /* fall through to the redirect */
    }

    if (!info.sources.length) {
      // Fallback: the redirect, unless it points at the DRM manifest.
      const res = await limited(() =>
        fetch(`${ZTNR}/${id}.m3u8`, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(20000) })
      );
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc && !/drm/i.test(loc)) info.sources.push({ label: 'HLS', url: loc });
    }
    return info;
  });
}
