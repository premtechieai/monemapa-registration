/**
 * Sandbox replacement for the three exports of src/lib/supabase.js.
 * Loaded only when app.mode is "sandbox".
 */
import logger from '../lib/logger.js';
import { memoryDb } from './memoryDb.js';
import { admin, createClientAuth } from './fakeAuth.js';

logger.warn('[sandbox] Using the in-memory Supabase stand-in. Emails appear at /sandbox; nothing is really sent.');

export const db = memoryDb;
export const authAdmin = admin;
export const createAuthClient = createClientAuth;
