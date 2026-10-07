import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { deleteSite, getSite, updateSite } from '@/lib/services/sites';
import { handleError, ok } from '@/lib/utils/result';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    return ok({ site: await getSite(user.id, id) });
  } catch (e) {
    return handleError(e);
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  niche: z.string().trim().max(200).optional(),
  audience: z.string().trim().max(300).optional(),
  tone: z.string().trim().max(200).optional(),
  publishCadence: z.enum(['daily', '3x_week', 'weekly', 'biweekly']).optional(),
  autoPublish: z.boolean().optional(),
  defaultAuthorId: z.number().int().positive().optional(),
  defaultCategoryId: z.number().int().positive().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const patch = await readJson(req, patchSchema);
    return ok({ site: await updateSite(user.id, id, patch) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    await deleteSite(user.id, id);
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
