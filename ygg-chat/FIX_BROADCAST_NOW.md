# 🔧 FINAL FIX: Enable Broadcast Reception

## The Problem

Your server logs show:
- ✅ Trigger firing (messages in `realtime.messages` table)
- ✅ Server connected to Realtime (subscription active)
- ❌ Server NOT receiving broadcasts (no "⚡ Broadcast trigger" logs)

**Root cause:** Missing SELECT policy on `realtime.messages` table.

`realtime.broadcast_changes()` uses **private channels** which need BOTH:
1. ✅ INSERT policy (we have this - for trigger to send)
2. ❌ SELECT policy (MISSING - for server to receive)

---

## The Fix (2 Minutes)

### Step 1: Run This Migration

**Supabase Dashboard → SQL Editor → New Query**

Copy and paste:
```
supabase-migrations/005_add_realtime_select_policy.sql
```

Click **"Run"**

Should see:
```
NOTICE: Created SELECT policy: allow_broadcast_select
Success. No rows returned
```

### Step 2: Verify Policies Exist

Run this in SQL Editor:
```sql
SELECT policyname, cmd AS operation
FROM pg_policies
WHERE schemaname = 'realtime' AND tablename = 'messages'
ORDER BY cmd;
```

**Expected output:**
```
policyname              | operation
------------------------|----------
allow_broadcast_insert  | INSERT
allow_broadcast_select  | SELECT
```

If you see both, the fix is complete! ✅

### Step 3: Restart Server

```bash
# Stop server (Ctrl+C)
cd Webdrasil/ygg-chat/server
npm run dev
```

### Step 4: Test It

**Send a chat message** and watch the logs.

**You should NOW see:**
```
⚡ Broadcast trigger: Reconciling generation gen_xxx immediately
🔄 Reconciling generation gen_xxx (run uuid-here)
💰 Credit calculation for gen_xxx: { ... }
✅ Applied refund of X credits
```

This should appear **immediately** after the message (not 5 minutes later).

---

## If It Still Doesn't Work

### Debug Query #1: Check Messages Are Being Created

```sql
SELECT topic, event, inserted_at, payload
FROM realtime.messages
ORDER BY inserted_at DESC
LIMIT 3;
```

Should show recent `topic='reconciliation'` entries when you send messages.

### Debug Query #2: Check RLS Policies

```sql
SELECT policyname, cmd, roles::text[], qual::text, with_check::text
FROM pg_policies
WHERE schemaname = 'realtime' AND tablename = 'messages';
```

Should show TWO policies (INSERT and SELECT).

### Debug Query #3: Manual Trigger Test

```sql
-- Find a running provider_run
SELECT id, status FROM provider_runs WHERE status = 'running' LIMIT 1;

-- Update it to trigger broadcast
UPDATE provider_runs
SET status = 'succeeded'
WHERE id = 'ID-FROM-ABOVE';

-- Immediately check server logs for "⚡ Broadcast trigger"
```

---

## Why This Fix Should Work

**From Supabase Documentation:**
> "Functions using realtime.broadcast_changes() will use a private channel and need broadcast authorization RLS policies to be met."
> "You can control client access to Realtime Broadcast and Presence by adding Row Level Security policies to the realtime.messages table."

**What we had:**
- INSERT policy ✅ (trigger can write messages)
- SELECT policy ❌ (server can't read messages)

**What we now have:**
- INSERT policy ✅
- SELECT policy ✅
- **Server can now receive broadcasts!** 🎉

---

## Timeline of Changes

1. **003_realtime_broadcast_trigger.sql** - Original (broken, missing `private` param)
2. **004_fix_realtime_broadcast.sql** - Fixed trigger, added INSERT policy
3. **005_add_realtime_select_policy.sql** - **THIS FIX** - Added SELECT policy

---

## Expected Results

### Before This Fix
```
[Trigger fires] → [Message inserted in realtime.messages] → ❌ Server can't read it
```

### After This Fix
```
[Trigger fires] → [Message inserted in realtime.messages] → ✅ Server receives broadcast → ⚡ Instant reconciliation!
```

---

## Confirmation

After running the migration and restarting the server, you should see:

1. **In Supabase logs** (Dashboard → Logs → Realtime):
   - Broadcast messages being received

2. **In server logs**:
   ```
   ⚡ Broadcast trigger: Reconciling generation gen_xxx immediately
   ```

3. **In API usage** (Dashboard → Logs → API):
   - Fewer `/provider_runs_pending_reconciliation` requests
   - Down from 60/hour to 12/hour

---

## If This STILL Doesn't Work

Then the issue might be:

1. **Supabase Realtime not enabled**
   - Dashboard → Settings → API → Enable Realtime (toggle ON)

2. **Firewall/network blocking WebSocket**
   - Check if server can connect to `wss://[your-project].supabase.co/realtime/v1`

3. **supabase-js version too old**
   - Check: `npm list @supabase/supabase-js`
   - Should be: v2.44.0 or later

4. **Fall back to polling mode**
   - Server already does this automatically (every 5 minutes)
   - Still 80% better than original 60-second polling

Let me know what happens after running the migration! 🚀
