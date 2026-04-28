-- Feature Requests — global board (cross-tenant)
-- Single board, weighted voting by lifetime MRR + recency, embeddings for duplicate detection.

CREATE TABLE "feature_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "category" TEXT,
    "author_user_id" UUID NOT NULL,
    "author_tenant_id" UUID,
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "weighted_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "merged_into_id" UUID,
    "shipped_at" TIMESTAMP(3),
    "declined_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feature_requests_status_score_idx" ON "feature_requests"("status", "weighted_score" DESC);
CREATE INDEX "feature_requests_author_tenant_idx" ON "feature_requests"("author_tenant_id");
CREATE INDEX "feature_requests_category_idx" ON "feature_requests"("category");
CREATE INDEX "feature_requests_embedding_idx" ON "feature_requests" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_merged_into_fkey"
    FOREIGN KEY ("merged_into_id") REFERENCES "feature_requests"("id") ON DELETE SET NULL;

CREATE TABLE "feature_request_votes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_request_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_request_votes_request_user_key" ON "feature_request_votes"("request_id", "user_id");
CREATE INDEX "feature_request_votes_user_idx" ON "feature_request_votes"("user_id");
CREATE INDEX "feature_request_votes_tenant_idx" ON "feature_request_votes"("tenant_id");

ALTER TABLE "feature_request_votes" ADD CONSTRAINT "feature_request_votes_request_fkey"
    FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE CASCADE;

CREATE TABLE "feature_request_comments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "body" TEXT NOT NULL,
    "is_admin_reply" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_request_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feature_request_comments_request_created_idx" ON "feature_request_comments"("request_id", "created_at");

ALTER TABLE "feature_request_comments" ADD CONSTRAINT "feature_request_comments_request_fkey"
    FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE CASCADE;

CREATE TABLE "feature_request_subscribers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_request_subscribers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_request_subscribers_request_user_key" ON "feature_request_subscribers"("request_id", "user_id");
