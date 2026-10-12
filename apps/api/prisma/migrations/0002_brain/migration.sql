-- CreateEnum
CREATE TYPE "BrainSpaceStatus" AS ENUM ('NOT_PROVISIONED', 'PROVISIONING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('DEMO', 'SLACK', 'GITHUB');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('IDLE', 'SYNCING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('CONTRADICTION', 'STALE_DOC', 'DECISION', 'ACTION_ITEM');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "InsightSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AgentActionType" AS ENUM ('CREATE_GITHUB_ISSUE', 'POST_SLACK_MESSAGE', 'UPDATE_KNOWLEDGE_DOC', 'SEND_EMAIL');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'EXECUTED', 'FAILED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_organization_id_fkey";

-- DropTable
DROP TABLE "projects";

-- DropEnum
DROP TYPE "ProjectVisibility";

-- CreateTable
CREATE TABLE "brain_spaces" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "hydra_database" TEXT NOT NULL,
    "collection" TEXT NOT NULL DEFAULT 'default',
    "status" "BrainSpaceStatus" NOT NULL DEFAULT 'NOT_PROVISIONED',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brain_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'IDLE',
    "config" JSONB,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "indexed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "hydra_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "author_email" TEXT,
    "occurred_at" TIMESTAMPTZ(6),
    "acl" JSONB,
    "metadata" JSONB,
    "additional" JSONB,
    "indexing_status" TEXT NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_people" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "person_key" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "manager_email" TEXT,
    "groups" TEXT[],
    "slack_user_id" TEXT,
    "expertise" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "directory_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "tool_trace" JSONB,
    "graph_paths" JSONB,
    "hydra_request_id" TEXT,
    "feedback" INTEGER,
    "feedback_comment" TEXT,
    "view_as_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" "InsightSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "InsightStatus" NOT NULL DEFAULT 'OPEN',
    "evidence" JSONB,
    "entities" JSONB,
    "owner_email" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "occurred_at" TIMESTAMPTZ(6),
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "AgentActionType" NOT NULL,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "conversation_id" TEXT,
    "insight_id" TEXT,
    "requested_by_id" TEXT,
    "approved_by_id" TEXT,
    "executed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brain_spaces_organization_id_key" ON "brain_spaces"("organization_id");

-- CreateIndex
CREATE INDEX "sources_organization_id_idx" ON "sources"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sources_organization_id_type_name_key" ON "sources"("organization_id", "type", "name");

-- CreateIndex
CREATE INDEX "sync_jobs_organization_id_idx" ON "sync_jobs"("organization_id");

-- CreateIndex
CREATE INDEX "sync_jobs_source_id_created_at_idx" ON "sync_jobs"("source_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_items_organization_id_kind_idx" ON "knowledge_items"("organization_id", "kind");

-- CreateIndex
CREATE INDEX "knowledge_items_source_id_idx" ON "knowledge_items"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_items_organization_id_hydra_id_key" ON "knowledge_items"("organization_id", "hydra_id");

-- CreateIndex
CREATE INDEX "directory_people_organization_id_slack_user_id_idx" ON "directory_people"("organization_id", "slack_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_people_organization_id_email_key" ON "directory_people"("organization_id", "email");

-- CreateIndex
CREATE INDEX "conversations_organization_id_user_id_updated_at_idx" ON "conversations"("organization_id", "user_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_organization_id_idx" ON "chat_messages"("organization_id");

-- CreateIndex
CREATE INDEX "insights_organization_id_type_status_idx" ON "insights"("organization_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insights_organization_id_fingerprint_key" ON "insights"("organization_id", "fingerprint");

-- CreateIndex
CREATE INDEX "agent_actions_organization_id_status_created_at_idx" ON "agent_actions"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "agent_actions_insight_id_idx" ON "agent_actions"("insight_id");

-- AddForeignKey
ALTER TABLE "brain_spaces" ADD CONSTRAINT "brain_spaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_people" ADD CONSTRAINT "directory_people_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "insights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
