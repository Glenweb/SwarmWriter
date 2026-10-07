import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { publishNow, schedule } from '@/lib/services/publish';
import { handleError, ok } from '@/lib/utils/result';

const schema = z.object({
  /** Omit scheduledFor to publish immediately. */
  scheduledFor: z.string().datetime().optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const { scheduledFor, dryRun } = await readJson(req, schema);

    if (scheduledFor) {
      const job = await schedule(user.id, id, new Date(scheduledFor), { dryRun });
      return ok({ mode: 'scheduled', job });
    }
    const result = await publishNow(user.id, id, { dryRun });
    return ok({ mode: 'published', ...result });
  } catch (e) {
    return handleError(e);
  }
}
