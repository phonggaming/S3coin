import type { Request, Response } from 'express';
import app, { ensureInitialized } from '../server';

export default async function handler(req: Request, res: Response) {
  try {
    await ensureInitialized();
    return app(req, res);
  } catch (err: any) {
    console.error('[Vercel API Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err?.message });
  }
}
