# Deployment Guide: Vercel (Client) + Railway (Server)

This guide will walk you through deploying your Yggdrasil Chat monorepo to Vercel (frontend) and Railway (backend).

## 📋 Prerequisites

- Git repository (GitHub, GitLab, or Bitbucket)
- [Vercel account](https://vercel.com/signup)
- [Railway account](https://railway.app/)
- **Node.js 20.x or higher** (required for dependencies like `better-sqlite3`)
- Supabase project set up
- Stripe account (for payments)
- Redis instance (for Railway rate limiting) - can use Railway's Redis service

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────┐
│         Monorepo Structure                  │
│  /Webdrasil/ygg-chat/                      │
│  ├── client/ygg-chat-r/  ← Vercel         │
│  ├── server/             ← Railway         │
│  └── shared/             ← Used by both    │
└─────────────────────────────────────────────┘
```

**Key Point**: Both Vercel and Railway will set their root directory to `/Webdrasil/ygg-chat` so they can access the `shared/` folder. The build commands navigate to the appropriate subdirectories.

---

## 🔄 Breaking the Circular Dependency

**Important**: You have a chicken-and-egg problem:

- Railway needs `FRONTEND_URL` (Vercel URL)
- Vercel needs `VITE_API_URL` (Railway URL)

**Solution**: Deploy Railway FIRST with a temporary permissive CORS setting (`FRONTEND_URL=*`), then lock it down after Vercel is deployed.

---

## 🚀 Part 1: Deploy Server to Railway (Without Frontend URL)

### Step 1: Create New Railway Project

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your repository
5. Railway will auto-detect the project

### Step 2: Configure Railway Service

In the Railway project settings:

**Root Directory**: `/Webdrasil/ygg-chat` (IMPORTANT: This allows access to the `shared/` folder)

The `railway.json` file will handle the build and start commands automatically:

- **Build Command**: `cd server && npm install && npm run build`
- **Start Command**: `cd server && npm start` (runs `node dist/server/src/index.js`)

**Note**: The server's `package.json` start command is configured to match where TypeScript outputs files when using `rootDir: "../"` in tsconfig.json.

**Important**: You'll also need to set a Node.js version environment variable (see next step).

### Step 3: Add Railway Environment Variables

Add these environment variables in Railway's dashboard:

```bash
# Node.js Version (CRITICAL - fixes better-sqlite3 build errors)
NIXPACKS_NODE_VERSION=20

# Node Environment
NODE_ENV=production

# Frontend URL - TEMPORARILY set to wildcard (we'll update this in Part 3)
FRONTEND_URL=*

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Environment Mode
VITE_ENVIRONMENT=web

# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_HIGH=price_...
STRIPE_PRICE_ID_MID=price_...
STRIPE_PRICE_ID_LOW=price_...

# Redis Configuration (REQUIRED - for rate limiting)
# Use Railway's internal Redis URL (from Redis service variables)
REDIS_URL=redis://default:your-password@redis.railway.internal:6379

# OpenRouter (if using)
OPENROUTER_API_KEY=your_openrouter_key

# Other LLM API Keys
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
GOOGLE_API_KEY=your_google_key
```

### Step 4: Add Redis Service (Required for Web Mode)

1. In your Railway project, click **"New"** → **"Database"** → **"Add Redis"**
2. Railway will automatically create a Redis instance
3. **IMPORTANT**: Copy the **internal Redis URL** from the Redis service:
   - Click on your Redis service
   - Go to **"Variables"** tab
   - Look for the variable that contains `redis.railway.internal`
   - Example: `redis://default:password@redis.railway.internal:6379`
4. **Manually add** `REDIS_URL` to your **server service** environment variables:
   - Go back to your server service (not Redis service)
   - Add `REDIS_URL` with the internal Redis URL you copied
5. Railway does NOT automatically set this variable - you must copy it manually
6. Use the **internal URL** (ends with `.railway.internal`), NOT the external proxy URL

### Step 5: Deploy and Get Railway URL

1. Railway will automatically deploy after you add environment variables
2. Wait for the deployment to complete (monitor the build logs)
3. Once deployed, **copy your Railway service URL** (e.g., `https://your-app.up.railway.app`)
4. **Critical**: Save this URL - you need it for the next step!

**Note**: Your server is now deployed with permissive CORS (`FRONTEND_URL=*`). This is temporary and will be secured in Part 3.

---

## 🎨 Part 2: Deploy Client to Vercel

### Step 1: Create New Vercel Project

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New"** → **"Project"**
3. Import your Git repository
4. Select your repository

### Step 2: Configure Vercel Project

**IMPORTANT**: In the Vercel project settings:

- **Framework Preset**: Other (don't use Vite preset)
- **Root Directory**: `/Webdrasil/ygg-chat` ✅ (This is the monorepo root!)
- Leave **Build Command** and **Install Command** empty (handled by `vercel.json`)

The `vercel.json` configuration handles:

- Build command: `cd client/ygg-chat-r && npm install && npm run build`
- Output directory: `client/ygg-chat-r/dist`

### Step 3: Add Vercel Environment Variables

Add these environment variables in Vercel's dashboard (Settings → Environment Variables):

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Environment Mode
VITE_ENVIRONMENT=web

# Stripe Configuration
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...

# API URL (Your Railway server URL from Part 1)
VITE_API_URL=https://your-app.up.railway.app/api
```

**Critical**: Set `VITE_API_URL` to your Railway server URL + `/api` suffix!

### Step 4: Deploy

1. Click **"Deploy"**
2. Vercel will build and deploy your client
3. Once deployed, copy your Vercel URL (e.g., `https://your-app.vercel.app`)

---

## 🔐 Part 3: Secure Railway with Vercel URL test push

Now that you have your Vercel URL, **lock down CORS** by updating Railway:

1. Open your Railway project
2. Go to **Variables** tab
3. **Update** the `FRONTEND_URL` environment variable with your actual Vercel URL:
   ```
   FRONTEND_URL=https://your-app.vercel.app
   ```
   (Remove the wildcard `*` and use your exact Vercel URL)
4. Railway will automatically redeploy with strict CORS configuration
5. Wait for redeployment to complete

**Security Note**: This step changes from permissive CORS (accepts all origins) to strict CORS (only accepts requests from your Vercel domain). This is critical for production security.

---

## 🔧 Part 4: Configure Stripe Webhooks

Your server needs to receive Stripe webhook events:

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"**
3. Set **Endpoint URL** to: `https://your-railway-url.up.railway.app/api/stripe/webhook`
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the **Signing secret** (starts with `whsec_`)
6. Add it to Railway as `STRIPE_WEBHOOK_SECRET`

---

## ✅ Part 5: Verify Deployment

### Test Client

1. Visit your Vercel URL
2. Open browser DevTools → Network tab
3. Check that API calls are going to your Railway URL
4. Test authentication with Supabase

### Test Server

1. Visit `https://your-railway-url.up.railway.app/api/tools`
2. You should see a JSON response with available tools
3. Check Railway logs for any errors

### Test CORS

1. Open your Vercel app
2. Try making an API request
3. If you see CORS errors, verify:
   - `FRONTEND_URL` is set correctly in Railway
   - The URL matches exactly (including `https://` and no trailing slash)

---

## 🔐 Security Checklist

- [ ] All environment variables set in both Vercel and Railway
- [ ] `FRONTEND_URL` in Railway matches your Vercel domain exactly
- [ ] `VITE_API_URL` in Vercel points to Railway `/api` endpoint
- [ ] Stripe webhook secret configured in Railway
- [ ] Redis configured for rate limiting
- [ ] Supabase RLS (Row Level Security) policies are set up
- [ ] API keys are using production values (not test keys)

---

## 📊 Monitoring

### Railway Logs

- View logs in Railway dashboard under the **"Deployments"** tab
- Set up alerts for errors

### Vercel Logs

- View function logs in Vercel dashboard under **"Deployments"** → select deployment → **"Functions"**

### Supabase Logs

- Monitor auth and database logs in Supabase dashboard

---

## 🐛 Troubleshooting

### Issue: Railway build fails with "EBADENGINE Unsupported engine"

**Error**: `npm ERR! EBADENGINE Unsupported engine` or `better-sqlite3` build failure

**Root Cause**: Railway defaults to Node.js 18, but your dependencies require Node.js 20+

**Solution** (choose ONE method):

**Method 1: Environment Variable (RECOMMENDED)**

- Add `NIXPACKS_NODE_VERSION=20` to Railway environment variables
- This is the simplest and most reliable method
- Railway will use Node.js 20 for the build

**Method 2: .nvmrc file**

- Create `.nvmrc` file in `/Webdrasil/ygg-chat/` with content: `20`
- Railway auto-detects this file
- Works well for local development too

**Method 3: package.json engines**

- Add to your `server/package.json`:
  ```json
  "engines": {
    "node": "20.x"
  }
  ```

**After applying any method**:

- Redeploy on Railway
- Check build logs to confirm "Node.js 20.x" is being used
- Build should complete successfully

### Issue: Railway crashes with "Cannot find module '/app/server/dist/index.js'"

**Error**: `Error: Cannot find module '/app/server/dist/index.js'` during startup

**Root Cause**: TypeScript's `rootDir: "../"` configuration preserves directory structure in output

**Explanation**:

- The `server/tsconfig.json` has `rootDir: "../"` (points to monorepo root)
- This is intentional - needed for `@shared/*` imports from the shared folder
- TypeScript compiles `server/src/index.ts` → `server/dist/server/src/index.js`
- The directory structure from rootDir is preserved in the output

**Solution**:

- Update `server/package.json` start command to match actual output path:
  ```json
  "start": "node dist/server/src/index.js"
  ```
  Instead of: `"start": "node dist/index.js"`
- Also update the `main` field to: `"dist/server/src/index.js"`
- Railway will automatically redeploy after pushing this change

### Issue: "ValidationError: Custom keyGenerator appears to use request IP without calling the ipKeyGenerator helper"

**Error**: `ERR_ERL_KEY_GEN_IPV6` validation error from express-rate-limit

**Root Cause**: express-rate-limit v8.x requires `ipKeyGenerator` helper for IPv6 safety

**Solution**:

- This has been fixed in the codebase
- Update `server/src/middleware/rateLimiter.ts` to use `ipKeyGenerator` from express-rate-limit
- The fix is included in the latest version - just pull and redeploy

### Issue: "I can't deploy because I don't have the URLs yet!"

**Solution**: This is the circular dependency problem! Follow this exact order:

1. Deploy Railway **first** with `FRONTEND_URL=*` (wildcard)
2. Get your Railway URL
3. Deploy Vercel with `VITE_API_URL=<railway-url>/api`
4. Get your Vercel URL
5. Update Railway's `FRONTEND_URL` to your exact Vercel URL

### Issue: "CORS Error" in browser console

**Solution**:

- Check that `FRONTEND_URL` in Railway matches your Vercel URL exactly (no trailing slash!)
- Ensure Railway has redeployed after updating `FRONTEND_URL` from `*` to the actual URL
- Check Railway logs for CORS warning messages
- If you're still testing, you can temporarily use `FRONTEND_URL=*` but **never** do this in production

### Issue: "Cannot connect to server"

**Solution**:

- Verify `VITE_API_URL` in Vercel environment variables
- Check Railway deployment status
- Test Railway endpoint directly: `curl https://your-railway-url.up.railway.app/api/tools`

### Issue: "Shared types not found" during build

**Solution**:

- Verify root directory is set to `/Webdrasil/ygg-chat` (not the subdirectory)
- Check that build commands in `vercel.json` and `railway.json` are correct
- Clear build cache and redeploy

### Issue: Stripe webhooks not working

**Solution**:

- Verify webhook URL in Stripe dashboard
- Check `STRIPE_WEBHOOK_SECRET` environment variable
- Test webhook with Stripe CLI: `stripe trigger checkout.session.completed`

### Issue: Redis connection errors or "MaxRetriesPerRequestError"

**Error**:

- `Connecting to Redis via host/port (localhost:6379, db=0)`
- `MaxRetriesPerRequestError: Reached the max retries per request limit`
- Server keeps reconnecting to Redis

**Root Cause**: `REDIS_URL` environment variable is not set or incorrect

**Solution**:

1. **Add Redis service** if you haven't already:
   - In Railway, click "New" → "Database" → "Add Redis"

2. **Copy the internal Redis URL**:
   - Click on your Redis service in Railway
   - Go to "Variables" tab
   - Find the variable containing `redis.railway.internal`
   - Copy the full URL: `redis://default:password@redis.railway.internal:6379`

3. **Set REDIS_URL in your server service**:
   - Go to your server service (NOT the Redis service)
   - Click "Variables" tab
   - Add new variable: `REDIS_URL=redis://default:password@redis.railway.internal:6379`
   - Use your actual password from step 2

4. **Important notes**:
   - Railway does NOT automatically share Redis URLs between services
   - You must manually copy the URL from Redis service to server service
   - Use the **internal URL** (`.railway.internal`), not the external proxy
   - Internal URL is faster and doesn't incur bandwidth charges

5. **Verify**:
   - Check Railway logs after redeploy
   - Should see: `🔌 Connecting to Redis via REDIS_URL`
   - Should NOT see: `Connecting to Redis via host/port (localhost:6379...)`

---

## 🔄 Continuous Deployment

Both Vercel and Railway support automatic deployments:

- **Push to main branch** → triggers deployment on both platforms
- **Pull requests** → Vercel creates preview deployments automatically
- **Rollback** → Both platforms allow instant rollback to previous deployments

---

## 📈 Scaling Considerations

### Railway

- Automatically scales based on traffic
- Monitor memory and CPU usage
- Consider upgrading plan for higher limits

### Vercel

- Serverless functions auto-scale
- Monitor function execution time
- Consider upgrading for higher bandwidth

---

## 🎉 You're Done!

Your app is now deployed:

- **Frontend**: `https://your-app.vercel.app`
- **Backend**: `https://your-app.up.railway.app`

Users can now access your production Yggdrasil Chat application!

---

## 📞 Support

If you encounter issues:

1. Check Railway and Vercel logs first
2. Review environment variables
3. Test endpoints individually
4. Check this guide's troubleshooting section

## 🔗 Useful Links

- [Vercel Documentation](https://vercel.com/docs)
- [Railway Documentation](https://docs.railway.app/)
- [Supabase Documentation](https://supabase.com/docs)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
