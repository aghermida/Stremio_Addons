import { Router, Request, Response, NextFunction } from 'express';
import { NextcloudAddon } from '../nextcloudAddon.js';
import { decodeConfig } from '../utils/decodeConfig.js';

const router: Router = Router();

interface Params {
  encodedConfig: string;
  type: string;
  id: string;
  extras?: string;
}

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id, extras } = req.params;
    try {
      const addon = new NextcloudAddon(decodeConfig(encodedConfig));
      const catalog = await addon.getCatalog(type, id, extras);
      res.json({ metas: catalog });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
