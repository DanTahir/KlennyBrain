'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Brain, Database, Lightbulb, MessageSquare, Zap, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface NavTab {
  label: string;
  href: string;
  icon: LucideIcon;
  exact: boolean;
}

export default function OrganizationLayout({ children }: { children: ReactNode }) {
  const { organizationId } = useParams<{ organizationId: string }>();
  const pathname = usePathname();
  const base = `/organizations/${organizationId}`;

  const tabs: NavTab[] = [
    { label: 'Home', href: base, icon: Brain, exact: true },
    { label: 'Ask', href: `${base}/ask`, icon: MessageSquare, exact: false },
    { label: 'Sources', href: `${base}/sources`, icon: Database, exact: false },
    { label: 'Insights', href: `${base}/insights`, icon: Lightbulb, exact: false },
    { label: 'Actions', href: `${base}/actions`, icon: Zap, exact: false },
  ];

  const isActive = (tab: NavTab): boolean => {
    if (!pathname) return false;
    if (tab.exact) return pathname === tab.href;
    return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  };

  return (
    <>
      <div className="sticky top-16 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4">
          <nav aria-label="Brain navigation" className="-mb-px flex gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = isActive(tab);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.label}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {children}
    </>
  );
}