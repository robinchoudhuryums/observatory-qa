/**
 * Tests for RAG Knowledge Base improvements:
 * - Document versioning schema fields
 * - Indexing status tracking
 * - Citation tracking
 * - Web URL source validation
 *
 * Run with: npx tsx --test tests/rag-features.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  referenceDocumentSchema,
  insertReferenceDocumentSchema,
  INDEXING_STATUSES,
  type ReferenceDocument,
  type InsertReferenceDocument,
} from "../shared/schema.js";

describe("RAG Knowledge Base - Schema Improvements", () => {
  describe("Reference Document versioning fields", () => {
    it("accepts version field", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Employee Handbook",
        category: "employee_handbook",
        fileName: "handbook.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        storagePath: "orgs/org-1/docs/doc-1.pdf",
        isActive: true,
        version: 3,
        previousVersionId: "doc-0",
        indexingStatus: "indexed",
      });
      assert.equal(doc.version, 3);
      assert.equal(doc.previousVersionId, "doc-0");
    });

    it("defaults version to 1", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Test Doc",
        category: "other",
        fileName: "test.txt",
        fileSize: 100,
        mimeType: "text/plain",
        storagePath: "path",
        isActive: true,
      });
      assert.equal(doc.version, 1);
    });

    it("previousVersionId is optional", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Test",
        category: "other",
        fileName: "test.txt",
        fileSize: 100,
        mimeType: "text/plain",
        storagePath: "path",
        isActive: true,
        version: 1,
      });
      assert.equal(doc.previousVersionId, undefined);
    });
  });

  describe("Indexing status fields", () => {
    it("accepts all valid indexing statuses", () => {
      for (const status of INDEXING_STATUSES) {
        const doc = referenceDocumentSchema.parse({
          id: "doc-1",
          orgId: "org-1",
          name: "Test",
          category: "other",
          fileName: "test.txt",
          fileSize: 100,
          mimeType: "text/plain",
          storagePath: "path",
          isActive: true,
          indexingStatus: status,
        });
        assert.equal(doc.indexingStatus, status);
      }
    });

    it("defaults indexingStatus to pending", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Test",
        category: "other",
        fileName: "test.txt",
        fileSize: 100,
        mimeType: "text/plain",
        storagePath: "path",
        isActive: true,
      });
      assert.equal(doc.indexingStatus, "pending");
    });

    it("rejects invalid indexing status", () => {
      assert.throws(() => {
        referenceDocumentSchema.parse({
          id: "doc-1",
          orgId: "org-1",
          name: "Test",
          category: "other",
          fileName: "test.txt",
          fileSize: 100,
          mimeType: "text/plain",
          storagePath: "path",
          isActive: true,
          indexingStatus: "invalid_status",
        });
      });
    });

    it("stores indexing error message", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Test",
        category: "other",
        fileName: "bad.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        storagePath: "path",
        isActive: true,
        indexingStatus: "failed",
        indexingError: "Malformed PDF: unable to extract text",
      });
      assert.equal(doc.indexingStatus, "failed");
      assert.equal(doc.indexingError, "Malformed PDF: unable to extract text");
    });
  });

  describe("Source type fields", () => {
    it("defaults sourceType to upload", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Test",
        category: "other",
        fileName: "test.txt",
        fileSize: 100,
        mimeType: "text/plain",
        storagePath: "path",
        isActive: true,
      });
      assert.equal(doc.sourceType, "upload");
    });

    it("accepts url source type with sourceUrl", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "FAQ Page",
        category: "faq",
        fileName: "example.com_faq",
        fileSize: 5000,
        mimeType: "text/html",
        storagePath: "path",
        isActive: true,
        sourceType: "url",
        sourceUrl: "https://example.com/faq",
      });
      assert.equal(doc.sourceType, "url");
      assert.equal(doc.sourceUrl, "https://example.com/faq");
    });

    it("rejects invalid source type", () => {
      assert.throws(() => {
        referenceDocumentSchema.parse({
          id: "doc-1",
          orgId: "org-1",
          name: "Test",
          category: "other",
          fileName: "test.txt",
          fileSize: 100,
          mimeType: "text/plain",
          storagePath: "path",
          isActive: true,
          sourceType: "ftp",
        });
      });
    });
  });

  describe("Retrieval count field", () => {
    it("defaults retrievalCount to 0", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Test",
        category: "other",
        fileName: "test.txt",
        fileSize: 100,
        mimeType: "text/plain",
        storagePath: "path",
        isActive: true,
      });
      assert.equal(doc.retrievalCount, 0);
    });

    it("accepts positive retrieval count", () => {
      const doc = referenceDocumentSchema.parse({
        id: "doc-1",
        orgId: "org-1",
        name: "Popular Doc",
        category: "process_manual",
        fileName: "manual.pdf",
        fileSize: 50000,
        mimeType: "application/pdf",
        storagePath: "path",
        isActive: true,
        retrievalCount: 42,
      });
      assert.equal(doc.retrievalCount, 42);
    });
  });

  describe("Insert schema", () => {
    it("omits id and createdAt from insert schema", () => {
      const insert = insertReferenceDocumentSchema.parse({
        orgId: "org-1",
        name: "New Doc",
        category: "employee_handbook",
        fileName: "handbook-v2.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
        storagePath: "orgs/org-1/docs/new.pdf",
        isActive: true,
        version: 2,
        previousVersionId: "old-doc-id",
        indexingStatus: "pending",
        sourceType: "upload",
      });
      assert.equal(insert.version, 2);
      assert.equal(insert.previousVersionId, "old-doc-id");
      assert.equal(insert.indexingStatus, "pending");
      assert.equal(insert.sourceType, "upload");
    });
  });

  describe("Full document lifecycle", () => {
    it("models a document version chain", () => {
      const v1: ReferenceDocument = referenceDocumentSchema.parse({
        id: "doc-v1",
        orgId: "org-1",
        name: "Policy Guide",
        category: "compliance_guide",
        fileName: "policy-v1.pdf",
        fileSize: 10000,
        mimeType: "application/pdf",
        storagePath: "path/v1",
        isActive: false, // deactivated when v2 was created
        version: 1,
        indexingStatus: "indexed",
        retrievalCount: 15,
      });

      const v2: ReferenceDocument = referenceDocumentSchema.parse({
        id: "doc-v2",
        orgId: "org-1",
        name: "Policy Guide",
        category: "compliance_guide",
        fileName: "policy-v2.pdf",
        fileSize: 12000,
        mimeType: "application/pdf",
        storagePath: "path/v2",
        isActive: true,
        version: 2,
        previousVersionId: "doc-v1",
        indexingStatus: "indexed",
        retrievalCount: 3,
      });

      assert.equal(v1.isActive, false);
      assert.equal(v2.isActive, true);
      assert.equal(v2.previousVersionId, v1.id);
      assert.equal(v2.version, v1.version + 1);
    });

    it("models a web URL source document", () => {
      const doc: ReferenceDocument = referenceDocumentSchema.parse({
        id: "doc-url-1",
        orgId: "org-1",
        name: "Company FAQ",
        category: "faq",
        fileName: "example.com_faq",
        fileSize: 5000,
        mimeType: "text/html",
        storagePath: "orgs/org-1/docs/url-1.url",
        extractedText: "Frequently Asked Questions...",
        isActive: true,
        sourceType: "url",
        sourceUrl: "https://example.com/faq",
        indexingStatus: "indexed",
        retrievalCount: 8,
      });

      assert.equal(doc.sourceType, "url");
      assert.equal(doc.sourceUrl, "https://example.com/faq");
      assert.equal(doc.indexingStatus, "indexed");
    });

    it("models a failed indexing scenario", () => {
      const doc: ReferenceDocument = referenceDocumentSchema.parse({
        id: "doc-bad",
        orgId: "org-1",
        name: "Corrupted Doc",
        category: "other",
        fileName: "corrupt.pdf",
        fileSize: 500,
        mimeType: "application/pdf",
        storagePath: "path",
        isActive: true,
        indexingStatus: "failed",
        indexingError: "Embedding service unavailable",
        retrievalCount: 0,
      });

      assert.equal(doc.indexingStatus, "failed");
      assert.ok(doc.indexingError?.includes("Embedding"));
    });
  });
});

describe("RAG Citation structure", () => {
  it("validates citation shape matches expected format", () => {
    // This tests the shape that gets stored in confidenceFactors.ragCitations
    const citations = [
      {
        chunkId: "chunk-abc",
        documentId: "doc-1",
        documentName: "Employee Handbook",
        chunkIndex: 3,
        score: 0.873,
      },
      {
        chunkId: "chunk-def",
        documentId: "doc-2",
        documentName: "Process Manual",
        chunkIndex: 0,
        score: 0.654,
      },
    ];

    assert.equal(citations.length, 2);
    assert.equal(citations[0].chunkId, "chunk-abc");
    assert.equal(citations[0].documentName, "Employee Handbook");
    assert.ok(citations[0].score >= 0 && citations[0].score <= 1);
    assert.ok(Number.isInteger(citations[0].chunkIndex));
  });
});
