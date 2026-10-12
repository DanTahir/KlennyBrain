export const DEFAULT_GITHUB_ACTIONS_REPO = 'DanTahir/northwind-atlas-tracker';
/** Real Slack channel used when a proposed channel does not exist in the connected workspace. */
export const DEFAULT_SLACK_ACTIONS_CHANNEL = 'all-klennyspace';

export interface ExecutionContext {
  actionId: string;
  organizationId: string;
  /** Display name of the approving human, for audit footers. */
  approvedBy: string;
}
