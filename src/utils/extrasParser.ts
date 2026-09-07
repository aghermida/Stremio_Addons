export interface ParsedExtras {
  search?: string;
  skip?: number;
}

/**
 * Parses Stremio's "key=value&key2=value2" catalog extras string.
 * Only understands `search` and `skip` — everything else is ignored.
 */
export function parseExtras(extras?: string): ParsedExtras {
  const result: ParsedExtras = {};
  if (!extras) return result;

  for (const pair of extras.split('&')) {
    const [key, rawValue] = pair.split('=');
    if (!key || rawValue === undefined) continue;
    const value = decodeURIComponent(rawValue);

    if (key === 'search') {
      result.search = value;
    } else if (key === 'skip') {
      const skip = Number(value);
      if (!Number.isNaN(skip)) result.skip = skip;
    }
  }

  return result;
}
