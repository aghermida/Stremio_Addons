import { Router, Request, Response, NextFunction } from 'express';
import { NextcloudAddon } from '../nextcloudAddon.js';
import { decodeConfig } from '../utils/decodeConfig.js';

const router: Router = Router();

interface Params {
  encodedConfig: string;
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      const addon = new NextcloudAddon(decodeConfig(encodedConfig));
      const meta = await addon.getMeta(type, id);
      res.json({ meta });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
