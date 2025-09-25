import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

// Explicitly load environment variables
dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

// This check will give a clear error if the URL is not found
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set or not accessible!");
}

export default defineConfig({
  schema: "./server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});