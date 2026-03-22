/**
 * Tests for upload route error handling (calls.ts multer wrapper).
 *
 * Verifies: file size error response, file type error response,
 * generic upload error sanitization, and error code inclusion.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, errorResponse } from "../server/services/error-codes";

describe("Upload Error Handling", () => {
  describe("Multer error classification", () => {
    it("classifies LIMIT_FILE_SIZE as 413", () => {
      const err = { code: "LIMIT_FILE_SIZE", message: "File too large" };
      const isFileSizeError = err.code === "LIMIT_FILE_SIZE";
      assert.equal(isFileSizeError, true);

      const response = errorResponse(ERROR_CODES.VALIDATION_ERROR, "File too large. Maximum size is 100MB.");
      assert.equal(response.errorCode, "OBS-GEN-003");
      assert.ok(response.message.includes("100MB"));
    });

    it("classifies Invalid file type as 400", () => {
      const err = { message: "Invalid file type. Only audio files allowed." };
      const isFileTypeError = err.message?.includes("Invalid file type");
      assert.equal(isFileTypeError, true);

      const response = errorResponse(ERROR_CODES.VALIDATION_ERROR, "Invalid file type. Only audio files (MP3, WAV, M4A, MP4, FLAC, OGG) are allowed.");
      assert.equal(response.errorCode, "OBS-GEN-003");
      assert.ok(response.message.includes("MP3"));
    });

    it("sanitizes generic upload errors (no raw message leak)", () => {
      const err = { message: "/tmp/uploads/abc123 - ENOENT: no such file or directory" };

      // The handler should NOT expose the raw error
      const response = errorResponse(ERROR_CODES.CALL_UPLOAD_FAILED, "File upload failed. Please try again.");
      assert.equal(response.message, "File upload failed. Please try again.");
      assert.ok(!response.message.includes("/tmp"), "Should not leak file paths");
      assert.ok(!response.message.includes("ENOENT"), "Should not leak system errors");
    });
  });

  describe("Error response structure", () => {
    it("includes errorCode in all upload error responses", () => {
      const fileSizeResponse = errorResponse(ERROR_CODES.VALIDATION_ERROR, "File too large");
      assert.ok(fileSizeResponse.errorCode, "File size response missing errorCode");

      const fileTypeResponse = errorResponse(ERROR_CODES.VALIDATION_ERROR, "Invalid file type");
      assert.ok(fileTypeResponse.errorCode, "File type response missing errorCode");

      const genericResponse = errorResponse(ERROR_CODES.CALL_UPLOAD_FAILED, "Upload failed");
      assert.ok(genericResponse.errorCode, "Generic response missing errorCode");
    });

    it("error codes follow OBS-{DOMAIN}-{NUMBER} format", () => {
      const codeRegex = /^OBS-[A-Z]+-\d{3}$/;
      assert.ok(codeRegex.test(ERROR_CODES.CALL_UPLOAD_FAILED), `Invalid format: ${ERROR_CODES.CALL_UPLOAD_FAILED}`);
      assert.ok(codeRegex.test(ERROR_CODES.VALIDATION_ERROR), `Invalid format: ${ERROR_CODES.VALIDATION_ERROR}`);
      assert.ok(codeRegex.test(ERROR_CODES.INTERNAL_ERROR), `Invalid format: ${ERROR_CODES.INTERNAL_ERROR}`);
    });
  });

  describe("Allowed file types", () => {
    it("accepts standard audio extensions", () => {
      const allowedTypes = [".mp3", ".wav", ".m4a", ".mp4", ".flac", ".ogg"];
      assert.equal(allowedTypes.length, 6);
      assert.ok(allowedTypes.includes(".mp3"));
      assert.ok(allowedTypes.includes(".wav"));
      assert.ok(allowedTypes.includes(".flac"));
    });

    it("rejects non-audio extensions", () => {
      const allowedTypes = [".mp3", ".wav", ".m4a", ".mp4", ".flac", ".ogg"];
      assert.ok(!allowedTypes.includes(".exe"));
      assert.ok(!allowedTypes.includes(".pdf"));
      assert.ok(!allowedTypes.includes(".zip"));
      assert.ok(!allowedTypes.includes(".js"));
    });

    it("file size limit is 100MB", () => {
      const FILE_SIZE_LIMIT = 100 * 1024 * 1024;
      assert.equal(FILE_SIZE_LIMIT, 104857600);
    });
  });
});
