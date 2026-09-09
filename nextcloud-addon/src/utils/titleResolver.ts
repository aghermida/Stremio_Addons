export interface TitleYear {
  title: string;
  year?: number;
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

const titleCache = new TTLCache<string, TitleYear>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const IMDB_SUGGESTION_API = 'https://v3.sg.media-imdb.com/suggestion/a/';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

interface IMDBSuggestionItem {
  id: string;
  l: string; // title
  y?: number; // year
}

function isSuggestionItem(value: unknown): value is IMDBSuggestionItem {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as any).id === 'string' &&
    typeof (value as any).l === 'string'
  );
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Request to ${url} failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fromImdbSuggestion(id: string): Promise<TitleYear> {
  const data = await fetchJson(`${IMDB_SUGGESTION_API}${id}.json`);
  const items: unknown[] = Array.isArray(data?.d) ? data.d : [];
  const item = items.find((i) => isSuggestionItem(i) && i.id === id);
  if (!item || !isSuggestionItem(item)) {
    throw new Error(`IMDB item not found for id: ${id}`);
  }
  return { title: item.l, year: item.y };
}

/** Parses a Cinemeta `releaseInfo` string ("2019", "2019-2021", "2019-") into a start year. */
function parseReleaseYear(meta: any): number | undefined {
  if (meta?.releaseInfo) {
    const start = meta.releaseInfo.toString().split(/[-—]/)[0]?.trim();
    if (start && Number.isInteger(Number(start))) return Number(start);
  }
  if (Number.isInteger(Number(meta?.year))) return Number(meta.year);
  return undefined;
}

async function fromCinemeta(id: string, type: string): Promise<TitleYear> {
  const data = await fetchJson(`${CINEMETA_URL}/meta/${type}/${id}.json`);
  const meta = data?.meta;
  if (!meta?.name) {
    throw new Error('Cinemeta data is missing a title');
  }
  return { title: meta.name, year: parseReleaseYear(meta) };
}

/**
 * Resolves an IMDB id (e.g. "tt1234567") to a title/year.
 * Tries the IMDB suggestion API first, falls back to Cinemeta.
 * Throws if both fail.
 */
export async function resolveTitleAndYear(
  id: string,
  type: string
): Promise<TitleYear> {
  const cacheKey = `${id}:${type}`;
  const cached = titleCache.get(cacheKey);
  if (cached) return cached;

  let result: TitleYear;
  try {
    result = await fromImdbSuggestion(id);
  } catch {
    result = await fromCinemeta(id, type);
  }

  titleCache.set(cacheKey, result, TTL_MS);
  return result;
}
