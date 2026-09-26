/**
 * Transactions API (mounted under /v1). Every route requires a signed-in user
 * and only touches that user's data.
 *
 *   GET    /transactions?from&to     { categories, transactions, rules }
 *   POST   /transactions             create        201 transaction
 *   PATCH  /transactions/:id         replace       200 transaction · 404
 *   DELETE /transactions/:id         delete        200 deleted transaction (for Undo) · 404
 *   POST   /transactions/suggest     { description, type } → { suggestions }
 *   PUT    /category-rules           { categoryId, pattern | description } → rule
 *   GET    /categories               categories
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as service from './transactions.service.js';
import { idParams, listQuery, ruleSchema, suggestSchema, transactionSchema } from './transactions.validators.js';

const router = Router();
router.use(['/transactions', '/category-rules', '/categories'], requireAuth);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => res.json(await service.listCategories())),
);

router.get(
  '/transactions',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await service.bootstrap(req.user.id, req.query));
  }),
);

router.post(
  '/transactions/suggest',
  validate(suggestSchema),
  asyncHandler(async (req, res) => res.json(await service.suggest(req.user.id, req.body))),
);

router.post(
  '/transactions',
  validate(transactionSchema),
  asyncHandler(async (req, res) => res.status(201).json(await service.create(req.user.id, req.body))),
);

router.patch(
  '/transactions/:id',
  validate(idParams, 'params'),
  validate(transactionSchema),
  asyncHandler(async (req, res) => res.json(await service.update(req.user.id, req.params.id, req.body))),
);

router.delete(
  '/transactions/:id',
  validate(idParams, 'params'),
  asyncHandler(async (req, res) => res.json(await service.remove(req.user.id, req.params.id))),
);

router.put(
  '/category-rules',
  validate(ruleSchema),
  asyncHandler(async (req, res) => res.json(await service.saveRule(req.user.id, req.body))),
);

export default router;
