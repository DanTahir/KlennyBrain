'use client';

import { use, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, RotateCcw, SendHorizontal, Square } from 'lucide-react';
import type { AskRequest, AskResponse, AskStreamEvent } from '@app-starter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ChatThread } from '@/components/brain/ChatThread';
import { ViewAsPicker } from '@/components/brain/ViewAsPicker';
import type { UiMessage } from '@/components/brain/types';
import { brainApi } from '@/lib/brain-api';
import { isApiErrorLike, streamAsk } from '@/lib/sse';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

const SUGGESTIONS: string[] = [
  'What is blocking the Atlas launch?',
  'What is our refund window for customers?',
  'When does Atlas launch, and why did the date move?',
  'Who knows the billing service best?',
  'What is the plan for the Q4 reorg?',
  'Which meeting action items are overdue?',
];

function applyStreamEvent(message: UiMessage, event: AskStreamEvent): UiMessage {
  switch (event.type) {
    case 'status':
      return { ...message, status: event.message };
    case 'tool_call':
      return { ...message, toolTrace: [...message.toolTrace, event.call] };
    case 'sources':
      return { ...message, citations: event.citations };
    case 'graph':
      return { ...message, graphPaths: event.paths };
    case 'token':
      return { ...message, content: message.content + event.delta, status: null };
    case 'action_proposed':
      return { ...message, actions: [...message.actions, event.action] };
    case 'done':
      return {
        ...message,
        streaming: false,
        status: null,
        messageId: event.messageId,
        viewAs: event.viewAs,
      };
    case 'error':
      return { ...message, streaming: false, status: null, error: event.message };
    case 'heartbeat':
    default:
      return message;
  }
}

function fromAskResponse(message: UiMessage, response: AskResponse): UiMessage {
  return {
    ...message,
    content: response.answer,
    citations: response.citations,
    toolTrace: response.toolTrace,
    graphPaths: response.graphPaths,
    actions: response.actions,
    messageId: response.messageId,
    viewAs: response.viewAs,
    streaming: false,
    status: null,
    error: null,
  };
}

function errorMessage(err: unknown, fallback: string): string {
  if (isApiErrorLike(err)) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function AskPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const queryClient = useQueryClient();

  const brain = useQuery({
    queryKey: ['brain', organizationId],
    queryFn: () => brainApi.getBrain(organizationId),
  });

  const personas = useQuery({
    queryKey: ['personas', organizationId],
    queryFn: () => brainApi.listPersonas(organizationId),
    enabled: brain.data?.viewer.canViewAs === true,
  });

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [viewAsEmail, setViewAsEmail] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const updateMessage = useCallback((id: string, updater: (message: UiMessage) => UiMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const resetChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || busy) return;

      const userMessage: UiMessage = {
        id: crypto.randomUUID(),
        role: 'USER',
        content: question,
        citations: [],
        toolTrace: [],
        graphPaths: [],
        actions: [],
      };
      const assistantId = crypto.randomUUID();
      const placeholder: UiMessage = {
        id: assistantId,
        role: 'ASSISTANT',
        content: '',
        citations: [],
        toolTrace: [],
        graphPaths: [],
        actions: [],
        streaming: true,
        status: 'Thinking…',
      };

      setMessages((prev) => [...prev, userMessage, placeholder]);
      setInput('');
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const body: AskRequest = {
        question,
        conversationId: conversationId ?? undefined,
        viewAsEmail: viewAsEmail ?? undefined,
      };

      try {
        await streamAsk(organizationId, body, {
          signal: controller.signal,
          onEvent: (event) => {
            updateMessage(assistantId, (m) => applyStreamEvent(m, event));
            if (event.type === 'done') {
              setConversationId(event.conversationId);
            }
          },
        });
      } catch (err) {
        if (controller.signal.aborted) {
          updateMessage(assistantId, (m) => ({
            ...m,
            streaming: false,
            status: null,
            error: m.content ? m.error ?? null : 'Stopped.',
          }));
        } else if (isApiErrorLike(err) && err.statusCode === 0) {
          updateMessage(assistantId, (m) => ({ ...m, status: 'Retrying without streaming…' }));
          try {
            const response = await brainApi.ask(organizationId, body);
            updateMessage(assistantId, (m) => fromAskResponse(m, response));
            setConversationId(response.conversationId);
          } catch (fallbackErr) {
            updateMessage(assistantId, (m) => ({
              ...m,
              streaming: false,
              status: null,
              error: errorMessage(fallbackErr, 'The brain could not answer right now.'),
            }));
          }
        } else {
          updateMessage(assistantId, (m) => ({
            ...m,
            streaming: false,
            status: null,
            error: errorMessage(err, 'The brain could not answer right now.'),
          }));
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        void queryClient.invalidateQueries({ queryKey: ['brain', organizationId] });
      }
    },
    [busy, conversationId, viewAsEmail, organizationId, queryClient, updateMessage],
  );

  // Brain Home links here with ?q=<question>: ask it once, then drop the param.
  const autoAskedRef = useRef(false);
  useEffect(() => {
    if (autoAskedRef.current) return;
    const question = new URLSearchParams(window.location.search).get('q')?.trim();
    if (!question) return;
    // Deferred so React's dev double-mount cannot abort the first stream.
    const timer = window.setTimeout(() => {
      autoAskedRef.current = true;
      window.history.replaceState(null, '', window.location.pathname);
      void send(question);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [send]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onFeedback = useCallback(
    async (message: UiMessage, rating: 1 | -1) => {
      const messageId = message.messageId;
      if (!messageId) return;
      const previous = message.feedback ?? null;
      updateMessage(message.id, (m) => ({ ...m, feedback: rating }));
      try {
        await brainApi.sendFeedback(organizationId, messageId, { rating });
        toast.success('Thanks — feedback sent to the brain');
      } catch (err) {
        updateMessage(message.id, (m) => ({ ...m, feedback: previous }));
        toast.error(errorMessage(err, 'Could not send feedback'));
      }
    },
    [organizationId, updateMessage],
  );

  const onViewAsChange = useCallback(
    (email: string | null) => {
      if (email === viewAsEmail) return;
      setViewAsEmail(email);
      if (conversationId || messages.length > 0) {
        resetChat();
      }
    },
    [viewAsEmail, conversationId, messages.length, resetChat],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  const canViewAs = brain.data?.viewer.canViewAs === true;
  const brainEmpty =
    brain.data !== undefined && (brain.data.status !== 'READY' || brain.data.stats.items === 0);

  return (
    <PageContainer variant="default" className="px-0 py-0">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl flex-col px-4 py-6">
        <PageHeader
          title="Ask the brain"
          description="Cited answers from Slack, email, docs, meetings, tickets and issues — limited to what you can see."
          className="mb-6"
        >
          <div className="flex flex-wrap items-center gap-2">
            {canViewAs && (
              <ViewAsPicker
                personas={personas.data ?? []}
                value={viewAsEmail}
                onChange={onViewAsChange}
                disabled={busy}
              />
            )}
            <Button variant="outline" onClick={resetChat} disabled={busy}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              New chat
            </Button>
          </div>
        </PageHeader>

        {brainEmpty && (
          <Card className="mb-6 border-amber-500/40 bg-amber-500/10">
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-foreground">The brain is empty</p>
                  <p className="text-sm text-muted-foreground">
                    Load the Northwind Robotics demo company on the Sources page to start asking.
                  </p>
                </div>
              </div>
              <Button asChild size="sm">
                <Link href={`/organizations/${organizationId}/sources`}>Go to Sources</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex-1">
          <ChatThread
            messages={messages}
            onFeedback={(message, rating) => void onFeedback(message, rating)}
            onSuggestion={(q) => void send(q)}
            suggestions={SUGGESTIONS}
          />
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        <div className="sticky bottom-0 mt-4 border-t bg-background pb-4 pt-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <Textarea
              rows={2}
              value={input}
              maxLength={2000}
              placeholder="Ask a question…"
              aria-label="Ask a question"
              className="min-h-[60px] resize-none"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {busy ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={stop}
                aria-label="Stop generating"
              >
                <Square className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={input.trim().length === 0}
                aria-label="Send question"
              >
                <SendHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </PageContainer>
  );
}