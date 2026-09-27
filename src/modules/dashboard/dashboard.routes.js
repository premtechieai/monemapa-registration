/**
 * GET /v1/dashboard?month=YYYY-MM&today=YYYY-MM-DD — everything the Overview
 * page needs in one call, computed on the server for the signed-in user
 * (merged from the monemapa-main project).
 *
 *   month  month to show (default: today's month)
 *   today  the browser's local date, so "this month so far" matches the user's
 *          calendar rather than the server's timezone
 */
import { Router } from 'express';
import { z } from 'zod';
import config from '../../config/index.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { addMonths, firstDay, lastDay, todayString } from '../../lib/dates.js';
import * as transactionsRepo from '../transactions/transactions.repository.js';
import { listCategories, toTransaction } from '../transactions/transactions.service.js';
import { buildDashboard } from './dashboard.calculator.js';

const router = Router();

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.').optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
});

router.get(
  '/dashboard',
  requireAuth,
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const options = config.dashboard;
    const today = req.query.today || todayString();
    const month = req.query.month || today.slice(0, 7);

    // One query for the whole chart window: oldest chart month → end of the viewed month.
    const from = firstDay(addMonths(month, -(options.chartMonths - 1)));
    const [rows, categories] = await Promise.all([
      transactionsRepo.listTransactions(req.user.id, { from, to: lastDay(month) }),
      listCategories(),
    ]);

    res.set('Cache-Control', 'no-store').json(
      buildDashboard({ transactions: rows.map(toTransaction), categories, month, today, options }),
    );
  }),
);

export default router;
