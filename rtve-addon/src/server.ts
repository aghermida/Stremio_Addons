import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { getCatalog, getManifest, getMeta, getStreams } from './addon.js';
import { getPrograms } from './rtve.js';

const app = express();

// Stremio Web fetches addons cross-origin from the browser.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

const json = (res: Response, body: unknown, maxAge: number) => {
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
  res.json(body);
};

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

app.get('/health', (_req, res) => {
  res.send('ok');
});

app.get(
  '/manifest.json',
  handle(async (_req, res) => json(res, await getManifest(), 300))
);

app.get(
  '/catalog/:type/:id{/:extra}.json',
  handle(async (req, res) => {
    const { type, id, extra } = req.params as { type: string; id: string; extra?: string };
    json(res, await getCatalog(type, id, new URLSearchParams(extra ?? '')), 600);
  })
);

app.get(
  '/meta/:type/:id.json',
  handle(async (req, res) => {
    const { type, id } = req.params as { type: string; id: string };
    json(res, await getMeta(type, id), 900);
  })
);

app.get(
  '/stream/:type/:id.json',
  handle(async (req, res) => {
    const { type, id } = req.params as { type: string; id: string };
    json(res, await getStreams(type, id), 60);
  })
);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(config.port, () => {
  console.log(`rtve-addon listening on port ${config.port}`);
  // Warm the program index so the first catalog request is fast.
  getPrograms().catch((e) => console.error('index warmup failed', e));
});
