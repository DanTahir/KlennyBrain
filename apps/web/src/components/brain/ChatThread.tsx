'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Brain, Loader2, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { AgentActionDto, AgentActionStatus, AgentActionType } from '@app-starter/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AnswerMarkdown } from './AnswerMarkdown';
import { SourceList } from './SourceCard';
import { ToolTrace } from './ToolTrace';
import { WhyGraph } from './WhyGraph';
import type { UiMessage } from './types';

const ACTION_LABELS: Record<AgentActionType, string> = {
  CREATE_GITHUB_ISSUE: 'GitHub issue',
  POST_SLACK_MESSAGE: 'Slack message',
  UPDATE_KNOWLEDGE_DOC: 'Doc update',
  SEND_EMAIL: 'Email',
};

function statusVariant(status: AgentActionStatus): BadgeProps['variant'] {
  if (status === 'EXECUTED') return 'default';
  if (status === 'FAILED' || status === 'REJECTED') return 'destructive';
  return 'secondary';
}

function ActionCard({ action }: { action: AgentActionDto }) {
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px]">
          {ACTION_LABELS[action.type]}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{action.title}</span>
        <Badge variant={statusVariant(action.status)} className="text-[10px]">
          {action.status}
        </Badge>
      </div>
      {action.summary && (
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{action.summary}</p>
      )}
      {action.status === 'PROPOSED' && (
        <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          Needs approval on the Actions page
        </p>
      )}
    </Card>
  );
}

function UserMessage({ message }: { message: UiMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  onFeedback,
}: {
  message: UiMessage;
  onFeedback?: (message: UiMessage, rating: 1 | -1) => void;
}) {
  const [highlightedN, setHighlightedN] = useState<number | null>(null);
  const hasContent = message.content.trim().length > 0;
  const showFeedback = Boolean(message.messageId) && !message.streaming;

  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        {message.viewAs && (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          >
            Answered as {message.viewAs.name} — only sources they can see
          </Badge>
        )}

        {message.streaming && !hasContent ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span className="animate-pulse">{message.status ?? 'Thinking…'}</span>
          </div>
        ) : hasContent ? (
          <div>
            <AnswerMarkdown
              content={message.content}
              citations={message.citations}
              onCitationClick={setHighlightedN}
            />
            {message.streaming && (
              <span
                className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/70 align-middle"
                aria-hidden="true"
              />
            )}
          </div>
        ) : null}

        {message.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{message.error}</span>
          </div>
        )}

        <ToolTrace calls={message.toolTrace} />

        {message.graphPaths.length > 0 && <WhyGraph paths={message.graphPaths} />}

        {message.citations.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sources
            </h4>
            <SourceList citations={message.citations} highlightedN={highlightedN} />
          </div>
        )}

        {message.actions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Proposed actions
            </h4>
            <div className="space-y-2">
              {message.actions.map((action) => (
                <ActionCard key={action.id} action={action} />
              ))}
            </div>
          </div>
        )}

        {showFeedback && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={clsx('h-8 w-8', message.feedback === 1 && 'text-primary')}
              aria-label="Helpful"
              aria-pressed={message.feedback === 1}
              onClick={() => onFeedback?.(message, 1)}
            >
              <ThumbsUp fill={message.feedback === 1 ? 'currentColor' : 'none'} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={clsx('h-8 w-8', message.feedback === -1 && 'text-primary')}
              aria-label="Not helpful"
              aria-pressed={message.feedback === -1}
              onClick={() => onFeedback?.(message, -1)}
            >
              <ThumbsDown fill={message.feedback === -1 ? 'currentColor' : 'none'} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatThread({
  messages,
  onFeedback,
  onSuggestion,
  suggestions,
}: {
  messages: UiMessage[];
  onFeedback?: (message: UiMessage, rating: 1 | -1) => void;
  onSuggestion?: (question: string) => void;
  suggestions?: string[];
}) {
  if (messages.length === 0) {
    if (!suggestions || suggestions.length === 0) return null;
    return (
      <div className="flex flex-col items-center px-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Brain className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Ask anything about Northwind Robotics</h2>
        <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
          {suggestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onSuggestion?.(question)}
              className="rounded-full border bg-background px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground"
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {messages.map((message) =>
        message.role === 'USER' ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AssistantMessage key={message.id} message={message} onFeedback={onFeedback} />
        ),
      )}
    </div>
  );
}