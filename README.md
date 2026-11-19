# BCAS Library Management System

A full-stack library management web application for Batangas College of Arts and Sciences (BCAS), built with Next.js (App Router), Tailwind CSS v4, Supabase, and `@opennextjs/cloudflare` for Cloudflare Workers deployment.

## Local Development

1. Copy `.env.example` to `.env.local` and configure your Supabase keys:
   ```env
   NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="your-supabase-publishable-key"
   ```
2. Install dependencies and start the development server:
   ```bash
   npm install
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000).

## Deploying to Cloudflare Workers

This project uses `@opennextjs/cloudflare` (`wrangler.jsonc` + `open-next.config.ts`) to bundle Next.js into `.open-next/worker.js` and `.open-next/assets`.

### Option 1: Cloudflare Dashboard (Git Integration — Workers Builds)

1. Push the full project (including `wrangler.jsonc`, `open-next.config.ts`, `package.json`, and `package-lock.json`) to the root of your GitHub repository.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create → Workers → Connect to Git** and select your repository.
3. Configure the build settings:
   - **Root directory**: `/` (or the subfolder containing `package.json` and `wrangler.jsonc`)
   - **Build command**: `npm run build:cf`
   - **Deploy command**: `npx wrangler deploy`
4. Add your **Environment Variables** (under **Settings → Variables and Secrets** and **Build variables**):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. Click **Save and Deploy**.

### Option 2: CLI Deploy (from your local machine)

```bash
npm install
npx wrangler login
npm run deploy
```

> **Note:** Running `npx wrangler deploy` without first running `npm run build:cf` will fail because `.open-next/worker.js` and `.open-next/assets` are generated during the OpenNext build step.