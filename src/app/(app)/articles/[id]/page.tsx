import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getArticle, getRuns } from '@/lib/services/articles';
import { getSite } from '@/lib/services/sites';
import { getPlan } from '@/lib/services/plans';
import { listJobs } from '@/lib/services/publish';
import { providerMode } from '@/lib/env';
import { ArticleEditor } from '@/components/app/article-editor';

export const dynamic = 'force-dynamic';

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const article = await getArticle(user.id, id).catch(() => null);
  if (!article) notFound();

  const [site, runs, jobs] = await Promise.all([
    getSite(user.id, article.siteId),
    getRuns(user.id, article.id),
    listJobs(user.id, { siteId: article.siteId }),
  ]);
  const plan = article.planId ? await getPlan(user.id, article.planId).catch(() => null) : null;

  return (
    <ArticleEditor
      article={article}
      site={{
        id: site.id,
        name: site.name,
        url: site.url,
        postCount: site.postCount,
        cadence: site.publishCadence,
        rankMathDetected: site.rankMathDetected,
      }}
      wordTarget={plan?.wordTarget ?? 1800}
      runs={runs}
      job={jobs.find((j) => j.articleId === article.id && j.status === 'pending') ?? null}
      wordpressMode={providerMode.wordpress}
    />
  );
}
