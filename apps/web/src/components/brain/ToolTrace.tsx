'use client';

import { ChevronRight, Wrench, XCircle } from 'lucide-react';
import type { ToolCallTrace } from '@app-starter/shared';
import { Badge } from '@/components/ui/badge';

const TOOL_NAMES: Record<string, string> = {
  search_knowledge: 'Search',
  explore_entity: 'Graph explore',
  find_experts: 'Find experts',
  list_insights: 'Insights',
};

function friendlyName(name: string): string {
  if (name.startsWith('propose_')) return 'Propose action';
  return TOOL_NAMES[name] ?? name;
}

function mainArgument(args: Record<string, unknown>): string | null {
  for (const key of ['query', 'name', 'topic', 'title']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function ToolTrace({ calls }: { calls: ToolCallTrace[] }) {
  if (calls.length === 0) return null;

  return (
    <details className="group rounded-lg border bg-muted/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span>How the brain found this</span>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {calls.length}
        </Badge>
      </summary>
      <ol className="space-y-2 border-t px-3 py-2">
        {calls.map((call) => {
          const arg = mainArgument(call.args);
          return (
            <li key={call.id} className="flex items-start gap-2 text-xs">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold">{friendlyName(call.name)}</span>
                  {arg && <span className="truncate text-muted-foreground">“{arg}”</span>}
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    {formatDuration(call.durationMs)}
                  </span>
                  {call.status === 'error' && (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Failed" />
                  )}
                </div>
                {call.resultSummary && (
                  <p className="mt-0.5 text-muted-foreground">{call.resultSummary}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}