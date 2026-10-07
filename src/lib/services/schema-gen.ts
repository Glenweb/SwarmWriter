/**
 * JSON-LD generation: Article + FAQPage + BreadcrumbList in one @graph, which
 * is how RankMath itself emits structured data.
 */
import { stripHtml, truncate } from '../utils/text';

export type FaqItem = { question: string; answer: string };

export type SchemaInput = {
  title: string;
  description: string;
  url: string;
  siteUrl: string;
  siteName: string;
  authorName: string;
  datePublished: string;
  dateModified?: string;
  faq?: FaqItem[];
  imageUrl?: string;
  wordCount?: number;
  keywords?: string[];
  breadcrumbs?: Array<{ name: string; url: string }>;
};

export function buildSchema(input: SchemaInput): Record<string, unknown> {
  const graph: Record<string, unknown>[] = [];
  const articleId = `${input.url}#article`;

  graph.push({
    '@type': 'Article',
    '@id': articleId,
    headline: truncate(stripHtml(input.title), 110),
    description: truncate(stripHtml(input.description), 300),
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    url: input.url,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    author: { '@type': 'Person', name: input.authorName },
    publisher: { '@type': 'Organization', name: input.siteName, url: input.siteUrl },
    ...(input.imageUrl ? { image: { '@type': 'ImageObject', url: input.imageUrl } } : {}),
    ...(input.wordCount ? { wordCount: input.wordCount } : {}),
    ...(input.keywords?.length ? { keywords: input.keywords.join(', ') } : {}),
    inLanguage: 'en',
  });

  if (input.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${input.url}#faq`,
      mainEntity: input.faq.map((f) => ({
        '@type': 'Question',
        name: stripHtml(f.question),
        acceptedAnswer: { '@type': 'Answer', text: stripHtml(f.answer) },
      })),
    });
  }

  const crumbs = input.breadcrumbs ?? [
    { name: 'Home', url: input.siteUrl },
    { name: stripHtml(input.title), url: input.url },
  ];
  graph.push({
    '@type': 'BreadcrumbList',
    '@id': `${input.url}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  });

  return { '@context': 'https://schema.org', '@graph': graph };
}

export function schemaScriptTag(schema: Record<string, unknown>): string {
  // Escape the closing tag sequence so the JSON cannot break out of the script.
  const json = JSON.stringify(schema, null, 0).replace(/<\/script/gi, '<\\/script');
  return `<script type="application/ld+json">${json}</script>`;
}

/** Shallow validity check surfaced in the editor's SEO panel. */
export function validateSchema(schema: unknown): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!schema || typeof schema !== 'object') return { valid: false, issues: ['Schema is missing.'] };
  const s = schema as Record<string, any>;
  if (!s['@context']) issues.push('Missing @context.');
  const graph = Array.isArray(s['@graph']) ? s['@graph'] : [s];
  const article = graph.find((n: any) => n['@type'] === 'Article');
  if (!article) issues.push('No Article node.');
  else {
    if (!article.headline) issues.push('Article is missing headline.');
    if (article.headline && String(article.headline).length > 110) issues.push('Headline exceeds 110 characters.');
    if (!article.datePublished) issues.push('Article is missing datePublished.');
    if (!article.author?.name) issues.push('Article is missing an author.');
  }
  const faq = graph.find((n: any) => n['@type'] === 'FAQPage');
  if (faq && (!Array.isArray(faq.mainEntity) || faq.mainEntity.length === 0)) {
    issues.push('FAQPage has no questions.');
  }
  return { valid: issues.length === 0, issues };
}
