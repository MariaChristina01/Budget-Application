# Everyday Budget

A budget tracker with Supabase email/password sign-in. The Node API verifies each session, and Supabase row-level security keeps each account's data private.

## Supabase setup

1. Run the latest [`server/supabase-schema.sql`](server/supabase-schema.sql) in the Supabase SQL Editor. It sets up user data, recurring bills, installment reminders, and the avatars bucket. It is safe to rerun.
2. Enable **Email** sign-in under Supabase Authentication providers.
3. Keep local development URLs in Supabase Authentication URL Configuration (`http://localhost:5173/**`). Add your deployed site URL there after deploying.
4. Put these settings in the project root `.env` (never commit it):

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   PORT=3001
   ```

The publishable key is used with each signed-in user's access token; the app does not need a service-role key.

## Run locally

Requires Node.js 22 or newer.

    npm run setup
    npm run dev

Open http://localhost:5173. For one-process mode, run `npm start` and open http://localhost:3001.

## Deploy to Render

The root [`render.yaml`](render.yaml) configures a single web service that builds the client and serves it from the API server.

1. Push this project to a GitHub repository. Keep `.env` out of the repository; it is already ignored.
2. In Render, choose **New > Blueprint**, connect the repository, and create the service from `render.yaml`.
3. When prompted, enter the Supabase project URL for both `SUPABASE_URL` and `VITE_SUPABASE_URL`, and the publishable key for both corresponding key variables.
4. After Render gives you the `https://...onrender.com` URL, open Supabase Authentication URL Configuration. Set **Site URL** to that address and add the exact address to **Redirect URLs** (and keep `http://localhost:5173/**` for development).
5. Open the Render HTTPS address on your phone and sign in. Use the browser menu's **Add to Home Screen** option to add a shortcut.

The free Render service sleeps after 15 minutes without traffic, so its first visit after a quiet period can take about a minute to wake up. See [Render's free service limits](https://render.com/docs/free).

## Features

- Monthly income and expense tracking with automatic or custom budgets
- Recurring bill reminders and dated SPayLater installment reminders
- Screenshot OCR for installment amounts and due dates, with a review step
- Spending insights, transaction search and filters, and CSV export
- Supabase account sign-in, profile pictures, and per-user row-level security

## Project files

- `server/index.js`: API and production static file hosting
- `server/supabase-schema.sql`: user-owned tables and storage policies
- `client/src/supabase.js`: browser Supabase client
- `client/src/App.jsx`: account, budget, bill, and reminder interface
