import { config } from './config.js';
import {
  getEpisodes,
  getProgram,
  getProgramVideos,
  getPrograms,
  getStream,
  getVideo,
  normalize,
  type Program,
  type Video,
} from './rtve.js';

const PROGRAM_PREFIX = 'rtve:p:';
const VIDEO_PREFIX = 'rtve:v:';

const FILM_TYPE = 'Contenedor Películas';
const DOC_TYPES = ['Documental', 'Documental Original', 'Reportajes Factual'];

type Group = 'series' | 'documentales' | 'programas';

function groupOf(p: Program): Group | null {
  if (p.programType === FILM_TYPE) return null;
  if (p.programType?.startsWith('Serie')) return 'series';
  if (p.programType && DOC_TYPES.includes(p.programType)) return 'documentales';
  return 'programas';
}

const genreOf = (p: Program) => p.programType ?? 'Otros';

async function programsIn(group: Group): Promise<Program[]> {
  return (await getPrograms()).filter((p) => groupOf(p) === group);
}

const genresOf = (programs: Program[]) => [...new Set(programs.map(genreOf))].sort((a, b) => a.localeCompare(b, 'es'));

export async function getManifest() {
  const [series, docs, shows, all] = await Promise.all([
    programsIn('series'),
    programsIn('documentales'),
    programsIn('programas'),
    getPrograms(),
  ]);
  const films = all.filter((p) => p.programType === FILM_TYPE);

  const paged = (id: string, name: string, type: string, genres: string[], required = false) => ({
    id,
    type,
    name,
    extra: [{ name: 'genre', options: genres, isRequired: required }, { name: 'skip' }],
  });

  return {
    id: 'dev.sandokan.rtve',
    version: '1.0.0',
    name: 'RTVE Play',
    description: 'Series, documentales, programas y cine de RTVE Play.',
    logo: 'https://www.rtve.es/favicon.ico',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    idPrefixes: ['rtve:'],
    catalogs: [
      paged('rtve-series', 'RTVE · Series', 'series', genresOf(series)),
      paged('rtve-documentales', 'RTVE · Documentales', 'series', genresOf(docs)),
      paged('rtve-programas', 'RTVE · Programas', 'series', genresOf(shows)),
      paged('rtve-cine', 'RTVE · Cine', 'movie', films.map((f) => f.name), true),
      { id: 'rtve-search', type: 'series', name: 'RTVE Play', extra: [{ name: 'search', isRequired: true }] },
    ],
    behaviorHints: { configurable: false },
  };
}

// ---- catalogs ---------------------------------------------------------------

const programMeta = (p: Program) => ({
  id: PROGRAM_PREFIX + p.id,
  type: 'series',
  name: p.name,
  poster: p.poster,
  background: p.background,
  logo: p.logo,
  description: p.description,
});

const filmMeta = (v: Video) => ({
  id: VIDEO_PREFIX + v.id,
  type: 'movie',
  name: v.title,
  poster: v.thumbnail,
  posterShape: 'landscape',
  description: v.description,
});

export async function getCatalog(type: string, id: string, extra: URLSearchParams) {
  const skip = Number(extra.get('skip') ?? 0) || 0;
  const genre = extra.get('genre');

  if (id === 'rtve-search') {
    const q = normalize(extra.get('search') ?? '').trim();
    if (!q) return { metas: [] };
    const hits = (await getPrograms()).filter((p) => p.programType !== FILM_TYPE && normalize(p.name).includes(q));
    // Prefix matches first.
    hits.sort((a, b) => Number(normalize(b.name).startsWith(q)) - Number(normalize(a.name).startsWith(q)));
    return { metas: hits.slice(0, 50).map(programMeta) };
  }

  if (id === 'rtve-cine') {
    const films = (await getPrograms()).filter((p) => p.programType === FILM_TYPE);
    const container = films.find((f) => f.name === genre) ?? films[0];
    if (!container) return { metas: [] };
    const page = Math.floor(skip / config.pageSize) + 1;
    const vids = await getProgramVideos(container.id, page, config.pageSize);
    return { metas: vids.map(filmMeta) };
  }

  const group = ({ 'rtve-series': 'series', 'rtve-documentales': 'documentales', 'rtve-programas': 'programas' } as const)[
    id as 'rtve-series'
  ];
  if (!group) return { metas: [] };
  let list = await programsIn(group);
  if (genre) list = list.filter((p) => genreOf(p) === genre);
  return { metas: list.slice(skip, skip + config.pageSize).map(programMeta) };
}

// ---- meta -------------------------------------------------------------------

export async function getMeta(type: string, id: string) {
  if (id.startsWith(PROGRAM_PREFIX)) {
    const p = await getProgram(id.slice(PROGRAM_PREFIX.length));
    if (!p) return { meta: null };
    const episodes = await getEpisodes(p.id, config.maxEpisodes);
    return {
      meta: {
        ...programMeta(p),
        genres: p.genres,
        cast: p.cast,
        director: p.directors,
        videos: episodes.map((v) => ({
          id: VIDEO_PREFIX + v.id,
          title: v.title,
          released: v.published ?? new Date(0).toISOString(),
          season: v.season ?? 1,
          episode: v.episode ?? 1,
          thumbnail: v.thumbnail,
          overview: v.description,
        })),
      },
    };
  }

  if (id.startsWith(VIDEO_PREFIX)) {
    const v = await getVideo(id.slice(VIDEO_PREFIX.length));
    if (!v) return { meta: null };
    return {
      meta: {
        ...filmMeta(v),
        background: v.thumbnail,
        releaseInfo: v.year ? String(v.year) : undefined,
        released: v.published,
        runtime: v.duration ? `${Math.round(v.duration / 60000)} min` : undefined,
        director: v.directors,
        cast: v.cast,
      },
    };
  }
  return { meta: null };
}

// ---- streams ----------------------------------------------------------------

export async function getStreams(type: string, id: string) {
  if (!id.startsWith(VIDEO_PREFIX)) return { streams: [] };
  const info = await getStream(id.slice(VIDEO_PREFIX.length));
  // No plain source: DRM-only, geo-blocked or expired.
  const subtitles = info.subtitles.map((s, i) => ({ id: `rtve-${i}`, lang: s.lang, url: s.url }));
  return {
    streams: info.sources.map((src) => ({
      name: 'RTVE Play',
      description: `HLS · ${src.label}`,
      url: src.url,
      subtitles,
    })),
  };
}
