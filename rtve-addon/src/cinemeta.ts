import { cached } from './rtve.js';

export interface CinemetaSeries {
  name: string;
  videos: { season: number; episode: number; released?: string }[];
}

/**
 * Series metadata from Cinemeta (Stremio's IMDb catalogue). Used to learn the
 * air date of the requested episode: Cinemeta often numbers seasons by year,
 * so dates are the only reliable bridge to RTVE's own numbering.
 */
export function getCinemetaSeries(imdb: string): Promise<CinemetaSeries | undefined> {
  return cached(`cm:${imdb}`, 6 * 3600_000, async () => {
    try {
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/series/${imdb}.json`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return undefined;
      const meta = ((await res.json()) as any).meta;
      if (!meta?.name) return undefined;
      return {
        name: String(meta.name),
        videos: ((meta.videos ?? []) as any[]).map((v) => ({
          season: Number(v.season),
          episode: Number(v.episode),
          released: typeof v.released === 'string' ? v.released : undefined,
        })),
      };
    } catch {
      return undefined;
    }
  });
}
