import { createHmac } from 'crypto';
import { createClient, WebDAVClient } from 'webdav';
import { config } from './config.js';
import { resolveTitleAndYear } from './utils/titleResolver.js';
import { parseId } from './utils/idParser.js';
import { parseExtras } from './utils/extrasParser.js';
import { formatBytes } from './utils/formatBytes.js';

const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.m4v',
  '.webm',
  '.flv',
  '.ts',
  '.m2ts',
  '.mpg',
  '.mpeg',
  '.iso',
]);

export interface NextcloudConfig {
  url: string;
  username: string;
  password: string;
  folder: string;
}

export function getNextcloudMediaToken(config: NextcloudConfig): string {
  return createHmac('sha256', internalSecret())
    .update('nextcloud-addon-v1' + JSON.stringify(config))
    .digest('hex')
    .slice(0, 32);
}

export function validateNextcloudMediaToken(
  token: string,
  cfg: NextcloudConfig
): boolean {
  return token === getNextcloudMediaToken(cfg);
}

function internalSecret(): string {
  return config.secret;
}

interface Manifest {
  id: string;
  version: string;
  name: string;
  description: string;
  logo: string;
  catalogs: unknown[];
  resources: unknown[];
  types: string[];
  behaviorHints: Record<string, unknown>;
}

interface MetaPreview {
  id: string;
  name: string;
  description?: string;
  type: string;
}

export class NextcloudAddon {
  private config: NextcloudConfig;
  private client: WebDAVClient;

  constructor(cfg: NextcloudConfig) {
    this.config = cfg;
    this.client = createClient(
      `${cfg.url}/remote.php/dav/files/${cfg.username}`,
      { username: cfg.username, password: cfg.password }
    );
  }

  private getStreamUrl(filename: string): string {
    const token = getNextcloudMediaToken(this.config);
    const base64Config = Buffer.from(JSON.stringify(this.config)).toString(
      'base64url'
    );
    return `${config.baseUrl}/media/${token}/${base64Config}/files/${encodeURIComponent(filename)}`;
  }

  private async listVideoFiles(): Promise<string[]> {
    try {
      const contents = await this.client.getDirectoryContents(
        this.config.folder
      );
      const items = Array.isArray(contents) ? contents : (contents as any).data;
      return items
        .filter(
          (f: any) =>
            f.type === 'file' &&
            VIDEO_EXTENSIONS.has(extname(f.basename).toLowerCase())
        )
        .map((f: any) => f.basename as string);
    } catch {
      return [];
    }
  }

  private async getFileStat(
    filename: string
  ): Promise<{ size: number; mtime: Date } | null> {
    try {
      const stat = (await this.client.stat(
        `${this.config.folder}/${filename}`
      )) as any;
      return { size: stat.size, mtime: new Date(stat.lastmod) };
    } catch {
      return null;
    }
  }

  private filenameToId(filename: string): string {
    return `nextcloud.${Buffer.from(filename).toString('base64url')}`;
  }

  private idToFilename(id: string): string | null {
    if (!id.startsWith('nextcloud.')) return null;
    const encoded = id.slice('nextcloud.'.length);
    try {
      return Buffer.from(encoded, 'base64url').toString();
    } catch {
      return null;
    }
  }

  static getManifest(): Manifest {
    return {
      id: 'com.nextcloud.aiostreams',
      version: '1.0.0',
      name: 'Nextcloud Media',
      description: 'Stream media files from your Nextcloud Stremio folder!',
      logo: `${config.baseUrl}/logo.svg`,
      catalogs: [
        {
          name: 'Nextcloud Media',
          id: 'nextcloud.videos',
          type: 'Cloud',
          extra: [{ name: 'search', isRequired: false }, { name: 'skip' }],
        },
      ],
      resources: [
        { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
        { name: 'catalog', types: ['Cloud'], idPrefixes: ['nextcloud'] },
        { name: 'meta', types: ['Cloud'], idPrefixes: ['nextcloud'] },
      ],
      types: ['movie', 'series', 'Cloud'],
      behaviorHints: {
        adult: false,
        p2p: false,
        configurable: false,
        configurationRequired: false,
      },
    };
  }

  getManifest(): Manifest {
    return NextcloudAddon.getManifest();
  }

  async getStreams(type: string, id: string) {
    const parsedId = parseId(id);
    if (!parsedId) return [];

    const { imdbId, season, episode } = parsedId;

    let title: string;
    let year: number | undefined;
    try {
      const resolved = await resolveTitleAndYear(imdbId, type);
      title = resolved.title;
      year = resolved.year;
    } catch {
      return [];
    }

    const files = await this.listVideoFiles();
    const matches = files.filter((f) =>
      fileMatchesContent(f, [title], year, season, episode)
    );

    const stats = await Promise.all(matches.map((f) => this.getFileStat(f)));

    return matches.map((filename, i) => ({
      name: 'Nextcloud',
      description: filename,
      url: this.getStreamUrl(filename),
      behaviorHints: {
        filename,
        videoSize: stats[i]?.size,
        notWebReady: false,
      },
    }));
  }

  async getCatalog(type: string, id: string, extras?: string): Promise<MetaPreview[]> {
    if (id !== 'nextcloud.videos' || type !== 'Cloud') {
      throw new Error('Unsupported catalog type or ID');
    }
    const { search, skip = 0 } = parseExtras(extras);

    let files = await this.listVideoFiles();
    if (search) {
      const lower = search.toLowerCase();
      files = files.filter((f) => f.toLowerCase().includes(lower));
    }

    const page = files.slice(skip, skip + 100);
    const stats = await Promise.all(page.map((f) => this.getFileStat(f)));

    return page.map((filename, i) =>
      this.createMetaPreview(filename, stats[i]?.size)
    );
  }

  async getMeta(type: string, id: string) {
    if (type !== 'Cloud' || !id.startsWith('nextcloud.')) {
      throw new Error('Unsupported type or ID for Meta request');
    }

    const filename = this.idToFilename(id);
    if (!filename) throw new Error('Invalid Nextcloud meta ID');

    const stat = await this.getFileStat(filename);
    if (!stat) throw new Error(`File not found: ${filename}`);

    const streamUrl = this.getStreamUrl(filename);
    const cleanName = cleanFilename(filename);

    return {
      id,
      name: cleanName,
      description: `${formatBytes(stat.size, 1000)} • ${stat.mtime.toLocaleDateString()}`,
      type: 'Cloud',
      posterShape: 'landscape',
      videos: [
        {
          id: filename,
          title: filename,
          released: stat.mtime.toISOString(),
          streams: [
            {
              name: 'Nextcloud',
              description: filename,
              url: streamUrl,
              behaviorHints: {
                filename,
                videoSize: stat.size,
                notWebReady: false,
              },
            },
          ],
        },
      ],
    };
  }

  private createMetaPreview(filename: string, size?: number): MetaPreview {
    return {
      id: this.filenameToId(filename),
      name: cleanFilename(filename),
      description: size ? formatBytes(size, 1000) : undefined,
      type: 'Cloud',
    };
  }
}

function extname(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i);
}

/** Strip extension and quality tags, replace dots/underscores with spaces */
function cleanFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const spaced = base.replace(/[._]/g, ' ');
  return spaced
    .replace(
      /\s*(1080p|720p|480p|2160p|4K|UHD|BluRay|BDRip|WEBRip|WEB-DL|HDRip|HDTV|DVDRip|x264|x265|HEVC|H\.264|H\.265|AAC|DTS|DD5|AC3|Remux|PROPER|REPACK).*$/i,
      ''
    )
    .trim();
}

/** Check if a filename matches the requested content */
function fileMatchesContent(
  filename: string,
  titles: string[],
  year?: number,
  season?: number,
  episode?: number
): boolean {
  const lower = filename.toLowerCase();
  const normalized = lower.replace(/[._\-]/g, ' ');

  const normalizedTitles = titles.map((t) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
  );
  const normalizedFile = normalized.replace(/[^a-z0-9\s]/g, '');

  const titleMatch = normalizedTitles.some(
    (title) => title && normalizedFile.includes(title)
  );
  if (!titleMatch) return false;

  if (season !== undefined && episode !== undefined) {
    const sPad = season.toString().padStart(2, '0');
    const ePad = episode.toString().padStart(2, '0');
    const patterns = [
      `s${sPad}e${ePad}`,
      `s${season}e${episode}`,
      `${season}x${ePad}`,
      `season ${season} episode ${episode}`,
    ];
    return patterns.some((p) => lower.includes(p));
  }

  if (year) {
    const yearMatch = filename.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      return Math.abs(parseInt(yearMatch[0], 10) - year) <= 1;
    }
  }

  return true;
}
