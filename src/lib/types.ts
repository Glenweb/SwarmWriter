/** Shapes the client reads. Mirrors the service return types. */
export type { Site, SitePost } from './services/sites';
export type { Keyword } from './services/keywords';
export type { Cluster } from './services/clustering';
export type { ContentPlan, OutlineSection } from './services/plans';
export type { Article } from './services/articles';
export type { PublishJob } from './services/publish';
export type { SeoReport, SeoSignal } from './services/seo-score';
export type { CreditPack } from './providers/stripe';
export type { LedgerEntry } from './services/credits';
export type { StageLog } from './services/swarm/types';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  creditsBalance: number;
};

export type WorkspaceStats = {
  articles: { total: number; published: number; drafts: number; scheduled: number; totalWords: number };
  seo: { avgScore: number };
  cost: { totalUsd: number; avgPerArticleUsd: number; targetPerArticleUsd: number; modelCalls: number };
  tierSpendShare: { haiku: number; sonnet: number; opus: number };
  internalLinks: number;
  sites: { total: number; connected: number };
  credits: { balance: number };
};

export type VerifyResult = {
  ok: boolean;
  userId?: number;
  userName?: string;
  roles?: string[];
  canPublish: boolean;
  rankMathDetected: boolean;
  restBase: string;
  warnings: string[];
  error?: string;
};
