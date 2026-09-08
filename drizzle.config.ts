import { defineConfig } from "drizzle-kit";
import { DB_FILE_NAME } from "./config";

export default defineConfig({
  out: "./database/migrations",
  schema: "./database/tables.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: DB_FILE_NAME,
  },
});
