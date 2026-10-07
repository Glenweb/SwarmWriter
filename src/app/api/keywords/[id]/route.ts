import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { getSerp, setStatus } from '@/lib/services/keywords';
import { handleError, ok } from '@/lib/utils/result';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    return ok({ serp: await getSerp(user.id, id) });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({ status: z.enum(['new', 'selected', 'planned', 'rejected']) });

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const { status } = await readJson(req, schema);
    return ok({ keyword: await setStatus(user.id, id, status) });
  } catch (e) {
    return handleError(e);
  }
}
