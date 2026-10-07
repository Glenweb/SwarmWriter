import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { rescore } from '@/lib/services/articles';
import { handleError, ok } from '@/lib/utils/result';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const { article, report } = await rescore(user.id, id);
    return ok({ seoScore: article.seoScore, report });
  } catch (e) {
    return handleError(e);
  }
}
