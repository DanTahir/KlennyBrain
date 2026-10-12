import Link from 'next/link';
import { Bell, Building2, Globe, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UniversalLayout } from '@/components/layout/UniversalLayout';

export const metadata = {
  title: 'KlennyBrain',
  description:
    'A company brain: cited, permission-aware answers and agentic actions across Slack, docs, tickets and meetings.',
};

const CAPABILITIES = [
  {
    icon: Users,
    title: 'Auth and organizations',
    description:
      'Email, OTP, and Google sign-in. Organizations with owner, admin, and member roles, invites, and impersonation with an audit trail.',
  },
  {
    icon: Bell,
    title: 'Notifications',
    description:
      'Email and in-app delivery, with per-user channel preferences and per-tenant sender identity.',
  },
  {
    icon: Globe,
    title: 'Custom domains',
    description: 'Per-tenant domains with DNS verification and white-label branding.',
  },
  {
    icon: Building2,
    title: 'A company brain',
    description:
      'Ask questions across Slack, docs, tickets and meetings with cited, permission-aware answers powered by HydraDB.',
  },
];

/**
 * Marketing home. Authenticated users are sent to /dashboard by the header,
 * so this stays a plain public page rather than redirecting.
 */
export default function HomePage() {
  return (
    <UniversalLayout>
      <main className="mx-auto max-w-5xl px-4 py-20">
        <section className="space-y-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Your company&apos;s brain, with receipts
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            KlennyBrain connects Slack, email, docs, meetings, tickets and issues into a HydraDB
            knowledge graph. Ask anything and get cited, permission-aware answers, spot
            contradictions and stale docs, and let the agent fix them with your approval.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/login">Get started</Link>
            </Button>
          </div>
        </section>

        <section className="mt-20 grid gap-8 sm:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex gap-4">
              <Icon className="mt-1 h-6 w-6 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <h2 className="font-medium">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </UniversalLayout>
  );
}
