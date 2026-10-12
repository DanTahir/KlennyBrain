import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_GITHUB_ACTIONS_REPO, ExecutionContext } from '../constants';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export type GithubIssueResult = { url: string; number: number; repo: string };

/** Creates GitHub issues through the REST API with GITHUB_TOKEN. */
@Injectable()
export class GithubExecutor {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('GITHUB_TOKEN'));
  }

  async createIssue(payload: Record<string, unknown>, context: ExecutionContext): Promise<GithubIssueResult> {
    const token = this.config.get<string>('GITHUB_TOKEN');
    if (!token) throw new Error('GitHub is not configured (GITHUB_TOKEN is empty)');
    const repo = str(payload.repo) || this.config.get<string>('GITHUB_ACTIONS_REPO') || DEFAULT_GITHUB_ACTIONS_REPO;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Invalid GitHub repository "${repo}"`);
    const title = str(payload.title);
    if (!title) throw new Error('GitHub issue title is required');
    const body = str(payload.body) ?? '';
    const labels = Array.isArray(payload.labels)
      ? payload.labels.filter((label): label is string => typeof label === 'string').slice(0, 5)
      : [];

    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'KlennyBrain',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title.slice(0, 250),
        body: `${body}\n\n---\n_Proposed by the KlennyBrain agent and approved by ${context.approvedBy} (action ${context.actionId})._`,
        labels,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`GitHub returned ${response.status}: ${detail}`);
    }
    const issue = (await response.json()) as { html_url: string; number: number };
    return { url: issue.html_url, number: issue.number, repo };
  }
}
