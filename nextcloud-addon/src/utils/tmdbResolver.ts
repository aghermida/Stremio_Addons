export interface TmdbMatch {
  tmdbId: number;
  title: string;
  overview: string;
  posterUrl?: string;
  backgroundUrl?: string;
  releaseYear?: number;
  rating?: number;
  genres: string[];
  mediaType: 'movie' | 'series';
}

/** In-memory TTL cache; good enough for a low-traffic single-instance service. */
class TTLCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();

  get(key: K): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

const matchCache = new TTLCache<string, TmdbMatch | null>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p/w500';

// Stable, well-known TMDB genre ids — avoids an extra API call per lookup.
const MOVIE_GENRES: Record<number, string> = {
  28: 'Acción', 12: 'Aventura', 16: 'Animación', 35: 'Comedia', 80: 'Crimen',
  99: 'Documental', 18: 'Drama', 10751: 'Familia', 14: 'Fantasía', 36: 'Historia',
  27: 'Terror', 10402: 'Música', 9648: 'Misterio', 10749: 'Romance',
  878: 'Ciencia ficción', 10770: 'Película de TV', 53: 'Suspense', 10752: 'Bélica',
  37: 'Western',
};

const TV_GENRES: Record<number, string> = {
  10759: 'Acción y Aventura', 16: 'Animación', 35: 'Comedia', 80: 'Crimen',
  99: 'Documental', 18: 'Drama', 10751: 'Familia', 10762: 'Infantil',
  9648: 'Misterio', 10763: 'Noticias', 10764: 'Reality', 10765: 'Ciencia ficción y Fantasía',
  10766: 'Telenovela', 10767: 'Talk', 10768: 'Guerra y Política', 37: 'Western',
};

interface TmdbSearchResult {
  id: number;
  title?: string; // movie
  name?: string; // tv
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string; // movie
  first_air_date?: string; // tv
  vote_average: number;
  genre_ids: number[];
  popularity: number;
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function yearFromDate(date?: string): number | undefined {
  if (!date) return undefined;
  const year = parseInt(date.slice(0, 4), 10);
  return Number.isInteger(year) ? year : undefined;
}

async function searchTmdb(
  apiKey: string,
  mediaType: 'movie' | 'series',
  title: string,
  year?: number
): Promise<TmdbSearchResult[]> {
  const endpoint = mediaType === 'movie' ? 'search/movie' : 'search/tv';
  const yearParam =
    mediaType === 'movie'
      ? year
        ? `&year=${year}`
        : ''
      : year
        ? `&first_air_date_year=${year}`
        : '';
  const url = `${TMDB_API_URL}/${endpoint}?api_key=${apiKey}&language=es-ES&query=${encodeURIComponent(title)}${yearParam}`;
  const data = await fetchJson(url);
  return Array.isArray(data?.results) ? data.results : [];
}

function toMatch(
  result: TmdbSearchResult,
  mediaType: 'movie' | 'series'
): TmdbMatch {
  const genreMap = mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES;
  return {
    tmdbId: result.id,
    title: (mediaType === 'movie' ? result.title : result.name) || '',
    overview: result.overview,
    posterUrl: result.poster_path ? `${TMDB_IMAGE_URL}${result.poster_path}` : undefined,
    backgroundUrl: result.backdrop_path ? `${TMDB_IMAGE_URL}${result.backdrop_path}` : undefined,
    releaseYear: yearFromDate(mediaType === 'movie' ? result.release_date : result.first_air_date),
    rating: result.vote_average,
    genres: result.genre_ids.map((id) => genreMap[id]).filter((g): g is string => !!g),
    mediaType,
  };
}

/**
 * Resolves a parsed filename title (+ optional year) to a real TMDB match.
 * Tries movie first, then series. Only accepts a result whose release year
 * is within 1 year of the parsed filename year — otherwise returns null
 * rather than risk attaching the wrong film's poster/synopsis.
 * Returns null (not throwing) on any failure, so callers can fall back
 * to the plain filename-based catalog entry.
 */
export async function resolveTmdbMatch(
  apiKey: string,
  title: string,
  year?: number
): Promise<TmdbMatch | null> {
  const cacheKey = `${title}:${year ?? ''}`;
  const cached = matchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let match: TmdbMatch | null = null;
  try {
    for (const mediaType of ['movie', 'series'] as const) {
      const results = await searchTmdb(apiKey, mediaType, title, year);
      if (results.length === 0) continue;

      const best = year
        ? results.find((r) => {
            const ry = yearFromDate(mediaType === 'movie' ? r.release_date : r.first_air_date);
            return ry !== undefined && Math.abs(ry - year) <= 1;
          })
        : results[0];

      if (best) {
        match = toMatch(best, mediaType);
        break;
      }
    }
  } catch {
    match = null;
  }

  matchCache.set(cacheKey, match, TTL_MS);
  return match;
}
