/**
 * Legacy logger re-export.
 *
 * The canonical logger now lives in server/services/logger.ts and includes
 * correlation ID injection via AsyncLocalStorage.
 *
 * This file exists solely for backward compatibility with the 28 service files
 * that import from "../logger" instead of "../services/logger".
 *
 * New code should import from "./services/logger" directly.
 */
export { logger, createChildLogger } from "./services/logger";
