import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { deleteArticle, getArticle, updateArticle } from '@/lib/services/articles';
import { handleError, ok } from '@/lib/utils/result';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    return ok({ article: await getArticle(user.id, id) });
  } catch (e) {
    return handleError(e);
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  html: z.string().max(400_000).optional(),
  markdown: z.string().max(400_000).optional(),
  excerpt: z.string().max(1000).optional(),
  metaTitle: z.string().max(200).optional(),
  metaDescription: z.string().max(400).optional(),
  focusKeyword: z.string().max(160).optional(),
  slug: z.string().max(200).optional(),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })).max(12).optional(),
});

/** Editor save. Re-scores so the SEO panel is never stale. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const patch = await readJson(req, patchSchema);
    return ok({ article: await updateArticle(user.id, id, patch) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    await deleteArticle(user.id, id);
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
