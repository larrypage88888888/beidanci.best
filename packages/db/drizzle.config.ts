import { defineConfig } from 'drizzle-kit';

/** 后续如需从 schema 自动生成迁移：pnpm --filter @app/db generate */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './migrations',
});
