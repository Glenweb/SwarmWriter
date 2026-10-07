import { requireUser } from '@/lib/auth/session';
import { ConnectWizard } from '@/components/app/connect-wizard';

// Reads the session cookie, so this segment is never prerendered.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Connect a site — Swarm Writer' };

export default async function NewSitePage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Connect a WordPress site</h1>
      <p className="mt-1.5 text-sm muted">
        Three steps. Nothing is charged, and the credentials are verified against your site before anything
        is saved.
      </p>
      <ConnectWizard />
    </div>
  );
}
