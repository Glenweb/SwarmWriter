import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { cancelJob, rescheduleJob } from '@/lib/services/publish';
import { AppError, handleError, ok } from '@/lib/utils/result';

const schema = z.object({
  action: z.enum(['reschedule', 'cancel']),
  scheduledFor: z.string().datetime().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const { action, scheduledFor } = await readJson(req, schema);

    if (action === 'cancel') return ok({ job: await cancelJob(user.id, id) });
    if (!scheduledFor) throw new AppError('bad_request', 'scheduledFor is required to reschedule.', 400);
    return ok({ job: await rescheduleJob(user.id, id, new Date(scheduledFor)) });
  } catch (e) {
    return handleError(e);
  }
}
