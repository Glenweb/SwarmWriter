import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { connectSite, listSites } from '@/lib/services/sites';
import { handleError, ok } from '@/lib/utils/result';

export async function GET() {
  try {
    await boot();
    const user = await requireUser();
    return ok({ sites: await listSites(user.id) });
  } catch (e) {
    return handleError(e);
  }
}

const connectSchema = z.object({
  name: z.string().trim().min(1, 'Give the site a name.').max(120),
  url: z.string().trim().min(4, 'Enter the site URL.'),
  wpUsername: z.string().trim().min(1, 'Enter the WordPress username.'),
  wpAppPassword: z.string().trim().min(8, 'Paste the full application password.'),
  niche: z.string().trim().max(200).optional(),
  audience: z.string().trim().max(300).optional(),
  tone: z.string().trim().max(200).optional(),
  publishCadence: z.enum(['daily', '3x_week', 'weekly', 'biweekly']).optional(),
  autoPublish: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const input = await readJson(req, connectSchema);
    const { site, verify } = await connectSite(user.id, input);
    return ok({ site, verify }, 201);
  } catch (e) {
    return handleError(e);
  }
}
