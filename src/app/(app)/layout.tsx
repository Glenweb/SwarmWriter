import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { listSites } from '@/lib/services/sites';
import { providerMode } from '@/lib/env';
import { AppShell } from '@/components/app/app-shell';

// Reads the session cookie, so this segment is never prerendered.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const sites = await listSites(user.id);

  return (
    <AppShell
      user={user}
      sites={sites.map((s) => ({ id: s.id, name: s.name, url: s.url, status: s.status }))}
      mocked={{
        anthropic: providerMode.anthropic === 'mock',
        dataForSeo: providerMode.dataForSeo === 'mock',
        stripe: providerMode.stripe === 'mock',
      }}
    >
      {children}
    </AppShell>
  );
}
