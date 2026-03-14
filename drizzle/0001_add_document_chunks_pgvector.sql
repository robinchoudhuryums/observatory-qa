-- Enable pgvector extension (requires superuser or extension already installed)
-- Neon PostgreSQL has pgvector pre-installed; just CREATE EXTENSION.
CREATE EXTENSION IF NOT EXISTS vector;

-- Document chunks table for RAG (Retrieval-Augmented Generation)
-- Stores chunked text with vector embeddings for semantic search.
CREATE TABLE IF NOT EXISTS "document_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "document_id" text NOT NULL REFERENCES "reference_documents"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "text" text NOT NULL,
  "section_header" varchar(500),
  "token_count" integer NOT NULL,
  "char_start" integer NOT NULL,
  "char_end" integer NOT NULL,
  "embedding" vector(1024),
  "created_at" timestamp DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS "doc_chunks_org_id_idx" ON "document_chunks" ("org_id");
CREATE INDEX IF NOT EXISTS "doc_chunks_document_id_idx" ON "document_chunks" ("document_id");

-- HNSW index for fast approximate nearest neighbor search on embeddings
-- ef_construction=128 and m=16 are good defaults for ~100K vectors
CREATE INDEX IF NOT EXISTS "doc_chunks_embedding_idx"
  ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
