import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { setPlanStatus } from '@/lib/services/plans';
import { handleError, ok } from '@/lib/utils/result';

const schema = z.object({ decision: z.enum(['approved', 'rejected', 'draft']) });

/** The approval gate: no credit is spent on a plan nobody signed off. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const { decision } = await readJson(req, schema);
    return ok({ plan: await setPlanStatus(user.id, id, decision) });
  } catch (e) {
    return handleError(e);
  }
}
