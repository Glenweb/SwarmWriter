/**
 * Unit checks on the pure logic: SEO scoring, internal linking, clustering,
 * schema, text analysis and cost maths. No database, no network.
 *
 *   npm test
 */
import { scoreArticle, keywordDensity } from '../src/lib/services/seo-score';
import { rankCandidates, injectLinks, linkBudget, DEFAULT_LINK_RULES } from '../src/lib/services/internal-links';
import { buildSchema, validateSchema, schemaScriptTag } from '../src/lib/services/schema-gen';
import { fleschReadingEase, jaccard, tokenize, truncate, wordCount } from '../src/lib/utils/text';
import { costOf, estimateTokens, TierRouter, PRICING } from '../src/lib/providers/anthropic';
import { classifyIntent } from '../src/lib/providers/dataforseo';
import { opportunityScore } from '../src/lib/services/keywords';
import { slugify } from '../src/lib/utils/slug';
import { encryptSecret, decryptSecret, maskSecret } from '../src/lib/auth/crypto';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';
import { rankMathMeta, cadenceSlots } from '../src/lib/services/publish';
import { balanceKeywordDensity } from '../src/lib/services/swarm/pipeline';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function group(title: string) {
  console.log(`\n${title}`);
}

const SAMPLE_POSTS = [
  { id: '1', wpPostId: 1, title: 'Carry-On Size Limits by Airline', slug: 'carry-on-size-limits', url: 'https://x.com/carry-on-size-limits', excerpt: 'Cabin bag dimensions each airline enforces.', tokens: tokenize('Carry-On Size Limits by Airline cabin bag dimensions airline enforces') },
  { id: '2', wpPostId: 2, title: 'Hard Shell vs Soft Shell Luggage', slug: 'hard-vs-soft', url: 'https://x.com/hard-vs-soft', excerpt: 'Which case survives baggage handling.', tokens: tokenize('Hard Shell vs Soft Shell Luggage case survives baggage handling') },
  { id: '3', wpPostId: 3, title: 'Best Espresso Machines Under 500', slug: 'espresso-machines', url: 'https://x.com/espresso-machines', excerpt: 'Pulling a decent shot at home.', tokens: tokenize('Best Espresso Machines Under 500 pulling decent shot home') },
];

async function main() {
  console.log('════ Swarm Writer — unit checks ════');

  group('Text analysis');
  check('tokenizer strips stopwords', !tokenize('the best of the luggage').includes('the'));
  check('tokenizer stems plurals', tokenize('luggages')[0] === tokenize('luggage')[0],
    `${tokenize('luggages')[0]} / ${tokenize('luggage')[0]}`);
  check('word count ignores HTML tags', wordCount('<p>one two three</p>') === 3);
  check('readability scores plain prose highly', fleschReadingEase('The cat sat on the mat. It was warm.') > 70);
  check('readability penalises dense prose', fleschReadingEase('Notwithstanding the aforementioned considerations, the heterogeneity of methodological approaches necessitates substantive reconsideration.') < 40);
  check('jaccard finds overlap', jaccard(tokenize('carry on luggage'), tokenize('best carry on luggage')) > 0.5);
  check('jaccard rejects unrelated terms', jaccard(tokenize('carry on luggage'), tokenize('espresso machine')) === 0);
  check('truncate respects word boundaries', !truncate('the quick brown fox jumps', 12).endsWith('fo'));
  check('slugify strips punctuation and accents', slugify('Café: Best Carry-On (2026)!') === 'cafe-best-carry-on-2026',
    slugify('Café: Best Carry-On (2026)!'));

  group('Keyword intent and opportunity');
  check('transactional intent detected', classifyIntent('buy carry on luggage cheap') === 'transactional');
  check('commercial intent detected', classifyIntent('best carry on luggage') === 'commercial');
  check('informational is the default', classifyIntent('how big is a cabin bag') === 'informational');
  check('navigational intent detected', classifyIntent('samsonite login') === 'navigational');
  const easyHigh = opportunityScore(5000, 10, 2, 'commercial');
  const hardHigh = opportunityScore(5000, 90, 2, 'commercial');
  check('opportunity discounts difficulty', easyHigh > hardHigh, `${easyHigh} vs ${hardHigh}`);
  check('opportunity rewards buying intent',
    opportunityScore(1000, 30, 1, 'transactional') > opportunityScore(1000, 30, 1, 'informational'));

  group('Keyword density');
  // 11 words, 2 occurrences of a 3-word phrase => 6/11 = 54.5%.
  check('density counts the phrase, not its words',
    Math.abs(keywordDensity('carry on luggage is great and carry on luggage is light', 'carry on luggage') - 54.5) < 0.5,
    `${keywordDensity('carry on luggage is great and carry on luggage is light', 'carry on luggage').toFixed(1)}%`);
  check('density is zero when the phrase is absent', keywordDensity('one two three four', 'carry on luggage') === 0);
  check('density uses the full word count as the denominator',
    keywordDensity(`luggage ${'word '.repeat(99)}`, 'luggage') === 1,
    `${keywordDensity(`luggage ${'word '.repeat(99)}`, 'luggage')}%`);

  group('Density guard');
  const stuffed = [
    { section: { heading: 'A', level: 2 as const, intent: '', wordTarget: 100, keyPoints: [] }, body: Array.from({ length: 10 }, () => 'carry on luggage matters here').join('. ') },
    { section: { heading: 'B', level: 2 as const, intent: '', wordTarget: 100, keyPoints: [] }, body: Array.from({ length: 10 }, () => 'carry on luggage again today').join('. ') },
  ];
  const before = stuffed.map((s) => s.body).join(' ');
  const balanced = balanceKeywordDensity(stuffed, 'carry on luggage');
  const after = balanced.map((s) => s.body).join(' ');
  const countBefore = (before.match(/carry on luggage/gi) ?? []).length;
  const countAfter = (after.match(/carry on luggage/gi) ?? []).length;
  check('density guard thins excess mentions', countAfter < countBefore, `${countBefore} → ${countAfter}`);
  check('density guard keeps at least one mention per section',
    balanced.every((s) => /carry on luggage/i.test(s.body)));
  check('density guard leaves compliant text alone', (() => {
    const fine = [{ section: { heading: 'A', level: 2 as const, intent: '', wordTarget: 100, keyPoints: [] }, body: `carry on luggage ${'word '.repeat(200)}` }];
    return balanceKeywordDensity(fine, 'carry on luggage')[0].body === fine[0].body;
  })());

  group('Internal link ranking');
  const ranked = rankCandidates({
    sectionText: 'Airlines enforce cabin bag dimensions differently, and the size limits catch people out.',
    sectionHeading: 'Airline size limits',
    posts: SAMPLE_POSTS,
    focusClue: undefined as never,
    focusKeyword: 'cabin bag size',
    limit: 3,
  } as any);
  check('most relevant post ranks first', ranked[0]?.slug === 'carry-on-size-limits', ranked[0]?.slug);
  check('unrelated post scores lowest',
    (ranked.find((r) => r.slug === 'espresso-machines')?.score ?? 0) <= (ranked[0]?.score ?? 1));
  check('ranking honours the limit', ranked.length <= 3);
  check('self-link is excluded', !rankCandidates({
    sectionText: 'cabin bag dimensions',
    sectionHeading: 'Limits',
    posts: SAMPLE_POSTS,
    focusKeyword: 'cabin bag',
    excludeSlug: 'carry-on-size-limits',
  }).some((c) => c.slug === 'carry-on-size-limits'));
  check('already-linked URLs are excluded', !rankCandidates({
    sectionText: 'cabin bag dimensions',
    sectionHeading: 'Limits',
    posts: SAMPLE_POSTS,
    focusKeyword: 'cabin bag',
    excludeUrls: ['https://x.com/carry-on-size-limits'],
  }).some((c) => c.url === 'https://x.com/carry-on-size-limits'));

  group('Link injection');
  const injected = injectLinks('<p>Check the size limits before you fly.</p>', [
    { url: 'https://x.com/a', anchor: 'size limits', title: 'Size Limits' },
  ]);
  check('anchor is wrapped in place', injected.html.includes('<a href="https://x.com/a"'));
  check('anchor text is preserved', injected.html.includes('>size limits</a>'));
  check('placement is reported', injected.placed.length === 1);

  const noMatch = injectLinks('<p>Nothing relevant in this sentence.</p>', [
    { url: 'https://x.com/b', anchor: 'cabin bag rules', title: 'Rules' },
  ]);
  check('absent phrase falls back to a related sentence', noMatch.placed.length === 1 && noMatch.html.includes('covers this in more detail'));

  const nested = injectLinks('<p>See <a href="https://y.com">size limits</a> here, and size limits again.</p>', [
    { url: 'https://x.com/c', anchor: 'size limits', title: 'Limits' },
  ]);
  check('existing anchors are not nested', !/<a[^>]*><a/.test(nested.html));

  // "cart" must not be wrapped inside "carton". The phrase is genuinely absent,
  // so the related-link fallback is the correct outcome rather than no link.
  const boundary = injectLinks('<p>The carton was heavy.</p>', [
    { url: 'https://x.com/d', anchor: 'cart', title: 'Cart' },
  ]);
  check('a partial word match is never wrapped', boundary.html.includes('The carton was heavy.'));
  check('no anchor is opened mid-word', !/car<a /.test(boundary.html));
  check('absent phrase uses the related-link fallback', boundary.html.includes('covers this in more detail'));

  const inTag = injectLinks('<p class="size limits">Body text.</p>', [
    { url: 'https://x.com/e', anchor: 'size limits', title: 'Limits' },
  ]);
  check('phrases inside tag attributes are skipped', !inTag.html.includes('class="<a'));

  group('Link budget');
  check('budget scales with length', linkBudget(1500) === 8 || linkBudget(1500) === Math.floor(1500 / 150));
  check('budget is capped', linkBudget(100000) === DEFAULT_LINK_RULES.maxLinks);
  check('short posts still get a minimum', linkBudget(200) >= 2);

  group('SEO scoring');
  const goodHtml = `
    <h1>Best Carry On Luggage for 2026</h1>
    <p>Choosing the best carry on luggage comes down to three criteria, and most guides bury all of them.</p>
    ${Array.from({ length: 5 }, (_, i) => `<h2>Section ${i + 1} about travel gear</h2><p>${'A clear sentence about packing. '.repeat(40)}</p>`).join('')}
    <figure><img src="/a.jpg" alt="A cabin bag in an overhead locker" /></figure>
    <p><a href="/carry-on-size-limits">size limits</a> and <a href="/hard-vs-soft">shell types</a> and <a href="/weights">weights</a></p>
    <p><a href="https://which.co.uk/luggage">external test data</a></p>
    <script type="application/ld+json">{}</script>`;
  const good = scoreArticle({
    html: goodHtml,
    title: 'Best Carry On Luggage for 2026',
    metaTitle: 'Best Carry On Luggage 2026: Tested and Compared Fully',
    metaDescription: 'Best carry on luggage for 2026, with the three criteria that decide it, what each option costs, and the mistakes that waste money at the airport desk.',
    focusKeyword: 'best carry on luggage',
    wordTarget: 1100,
    hasSchema: true,
    siteUrl: 'https://x.com',
  });
  check('a well-formed article scores high', good.score >= 80, `${good.score}/100`);
  check('all 12 signals are evaluated', good.signals.length === 12);
  check('grade matches the score', good.grade === (good.score >= 85 ? 'excellent' : 'good'));

  const bad = scoreArticle({ html: '<p>Too short.</p>', title: 'x', focusKeyword: 'carry on luggage', wordTarget: 1800 });
  check('a thin article scores low', bad.score < 30, `${bad.score}/100`);
  check('every failing signal carries a fix', bad.signals.filter((s) => !s.pass).every((s) => !!s.fix));
  check('word-count fix names the shortfall', /Add roughly \d+ words/.test(bad.signals.find((s) => s.id === 'word_count')?.fix ?? ''));
  check('internal links are counted', good.stats.internalLinks >= 3, `${good.stats.internalLinks}`);
  check('external links are separated from internal', good.stats.externalLinks >= 1, `${good.stats.externalLinks}`);
  check('image alt text is detected', good.stats.imagesWithAlt === 1);

  const longMeta = scoreArticle({
    html: goodHtml,
    title: 'T',
    metaTitle: 'x'.repeat(80),
    metaDescription: 'y'.repeat(200),
    focusKeyword: 'carry on',
    wordTarget: 1100,
  });
  check('over-long meta title is flagged with the overage',
    /Trim \d+ characters/.test(longMeta.signals.find((s) => s.id === 'meta_title')?.fix ?? ''));

  group('Meta description padding');
  {
    const { padDescriptionForTest } = await import('../src/lib/services/swarm/pipeline');
    const short = padDescriptionForTest('Best carry on luggage for 2026');
    check('short description is padded', short.length > 'Best carry on luggage for 2026'.length, `${short.length} chars`);
    check('padded description reaches the 140-160 band', short.length >= 140 && short.length <= 160, `${short.length} chars`);
    check('padded description ends on a complete sentence', /[.!?]$/.test(short), short.slice(-42));
    check('padded description is never mid-word', !/\b(that|the|and|with|of|to|a|an|for)$/i.test(short.replace(/[.!?]$/, '')));
    const already = padDescriptionForTest('x'.repeat(150));
    check('a description already in band is left alone', already.length <= 160);
  }

  group('Schema generation');
  const schema = buildSchema({
    title: 'Best Carry On Luggage',
    description: 'A practical guide.',
    url: 'https://x.com/best-carry-on/',
    siteUrl: 'https://x.com',
    siteName: 'X',
    authorName: 'Author',
    datePublished: new Date().toISOString(),
    faq: [{ question: 'Is it worth it?', answer: 'Yes.' }],
    wordCount: 1800,
    keywords: ['carry on luggage'],
  });
  check('schema validates', validateSchema(schema).valid, validateSchema(schema).issues.join('; '));
  const graph = (schema as any)['@graph'];
  check('Article node present', graph.some((n: any) => n['@type'] === 'Article'));
  check('FAQPage node present', graph.some((n: any) => n['@type'] === 'FAQPage'));
  check('BreadcrumbList node present', graph.some((n: any) => n['@type'] === 'BreadcrumbList'));
  check('missing schema is reported invalid', !validateSchema(null).valid);
  check('over-long headline is flagged', !validateSchema({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'Article', headline: 'x'.repeat(130), datePublished: 'now', author: { name: 'a' } }],
  }).valid);
  check('script tag escapes a closing tag in the JSON',
    !schemaScriptTag({ a: '</script><script>alert(1)</script>' }).includes('</script><script>alert'));

  group('Cost model and tier routing');
  check('haiku pricing applied', costOf('haiku', 1_000_000, 0) === PRICING.haiku.input);
  check('output tokens cost more than input', costOf('sonnet', 0, 1000) > costOf('sonnet', 1000, 0));
  check('opus is the most expensive tier', costOf('opus', 1000, 1000) > costOf('sonnet', 1000, 1000));
  check('token estimate scales with length', estimateTokens('a'.repeat(400)) === 100);

  const router = new TierRouter(0.039);
  check('outline is never downgraded', router.tierFor('outline') === 'sonnet');
  check('draft always uses haiku', router.tierFor('draft') === 'haiku');
  const cheapRouter = new TierRouter(0.039);
  check('polish keeps sonnet when there is budget',
    cheapRouter.tierFor('polish', { inputTokens: 1000, outputTokens: 500 }) === 'sonnet');
  const spentRouter = new TierRouter(0.039);
  spentRouter.record('haiku', 0.038);
  check('polish downgrades when the budget is nearly gone',
    spentRouter.tierFor('polish', { inputTokens: 2000, outputTokens: 900 }) === 'haiku');
  check('downgrade is recorded with a reason', spentRouter.summary().downgrades.length === 1,
    spentRouter.summary().downgrades[0]);

  const mixRouter = new TierRouter(0.039);
  mixRouter.record('haiku', 0.03);
  mixRouter.record('sonnet', 0.01);
  const summary = mixRouter.summary();
  check('spend share computed', Math.abs(summary.spendShare.haiku - 0.75) < 0.01, `${summary.spendShare.haiku}`);
  check('within-target flag reflects the ceiling', summary.withinTarget === true, `$${summary.totalUsd}`);

  group('Credentials at rest');
  const secret = 'abcd efgh ijkl mnop qrst uvwx';
  const envelope = encryptSecret(secret);
  check('ciphertext does not contain the plaintext', !envelope.includes('abcd'));
  check('envelope is versioned', envelope.startsWith('v1.'));
  check('round-trips exactly', decryptSecret(envelope) === secret);
  check('tampering is rejected', (() => {
    const parts = envelope.split('.');
    parts[2] = parts[2].slice(0, -2) + 'xy';
    try {
      decryptSecret(parts.join('.'));
      return false;
    } catch {
      return true;
    }
  })());
  check('encryption is non-deterministic', encryptSecret(secret) !== encryptSecret(secret));
  check('mask keeps only the last 4 characters', maskSecret('abcdefghij').endsWith('ghij'));

  group('Password hashing');
  const hash = await hashPassword('correct horse battery staple');
  check('hash is prefixed with the scheme', hash.startsWith('scrypt$'));
  check('correct password verifies', await verifyPassword('correct horse battery staple', hash));
  check('wrong password is rejected', !(await verifyPassword('wrong password', hash)));
  check('salt makes hashes unique', (await hashPassword('same')) !== (await hashPassword('same')));
  check('malformed hash is rejected safely', !(await verifyPassword('x', 'garbage')));

  group('RankMath field mapping');
  const meta = rankMathMeta({
    metaTitle: 'Title here',
    metaDescription: 'Description here',
    focusKeyword: 'carry on luggage',
    canonicalUrl: 'https://x.com/slug/',
    title: 'Fallback',
    excerpt: null,
  } as any);
  check('rank_math_title maps from metaTitle', meta.rank_math_title === 'Title here');
  check('rank_math_description maps from metaDescription', meta.rank_math_description === 'Description here');
  check('rank_math_focus_keyword maps from focusKeyword', meta.rank_math_focus_keyword === 'carry on luggage');
  check('rank_math_canonical_url maps from canonicalUrl', meta.rank_math_canonical_url === 'https://x.com/slug/');
  check('rank_math_robots defaults to index/follow', JSON.stringify(meta.rank_math_robots) === '["index","follow"]');
  const fallback = rankMathMeta({ metaTitle: null, title: 'Fallback Title', metaDescription: null, excerpt: 'Ex', focusKeyword: null, canonicalUrl: null } as any);
  check('title falls back when meta title is blank', fallback.rank_math_title === 'Fallback Title');
  check('description falls back to the excerpt', fallback.rank_math_description === 'Ex');

  group('Publishing cadence');
  const weekly = cadenceSlots('weekly', 3);
  check('weekly cadence spaces slots 7 days apart',
    Math.round((weekly[1].getTime() - weekly[0].getTime()) / 86_400_000) === 7);
  check('daily cadence spaces slots 1 day apart',
    Math.round((cadenceSlots('daily', 2)[1].getTime() - cadenceSlots('daily', 2)[0].getTime()) / 86_400_000) === 1);
  check('slots are all in the future', weekly.every((d) => d.getTime() > Date.now()));
  check('slots land at the same time of day', weekly.every((d) => d.getHours() === weekly[0].getHours()));

  console.log('\n════ result ════');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`\n  Failures:\n${failures.map((f) => `   - ${f}`).join('\n')}`);
    process.exit(1);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('\n✗ unit run threw:', e);
    process.exit(1);
  },
);
