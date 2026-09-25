/**
 * Current-user endpoint used by the dashboard.
 *   GET /me → { user, session }
 */
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';

const router = Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, session: req.authSession });
});

export default router;
