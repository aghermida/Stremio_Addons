export interface ParsedNextcloudId {
  imdbId: string;
  season?: number;
  episode?: number;
}

const ID_PATTERN = /^(tt\d+)(?::(\d+):(\d+))?$/;

/**
 * Parses ids of the form "tt1234567" or "tt1234567:1:2".
 * Returns null for anything else — Nextcloud only ever serves IMDB-style ids.
 */
export function parseId(id: string): ParsedNextcloudId | null {
  const match = ID_PATTERN.exec(id);
  if (!match) return null;
  const [, imdbId, season, episode] = match;
  return {
    imdbId,
    season: season !== undefined ? Number(season) : undefined,
    episode: episode !== undefined ? Number(episode) : undefined,
  };
}
