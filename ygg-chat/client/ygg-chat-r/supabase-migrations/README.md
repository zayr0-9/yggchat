# Electron Allowlist Setup

This directory contains database migrations for restricting Electron app OAuth to login-only mode while allowing normal signup/login in web mode.

## Overview

- **Web Mode**: Normal OAuth flow - users can sign up and log in
- **Electron Mode**: Login-only - only pre-approved users can authenticate

## Setup Instructions

### Step 1: Run the Migration

Run the SQL migration in your Supabase project:

**Option A: Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of `001_electron_allowlist.sql`
4. Paste and run the SQL

**Option B: Supabase CLI**
```bash
supabase db push --file ./supabase-migrations/001_electron_allowlist.sql
```

### Step 2: Add Users to Allowlist

Add authorized users to the allowlist table. You have several options:

**Option A: SQL Query (Manual)**
```sql
-- Add a user by email (they must already exist in auth.users)
INSERT INTO public.electron_allowlist (user_id, email, notes)
SELECT id, email, 'Initial admin user'
FROM auth.users
WHERE email = 'user@example.com';
```

**Option B: Supabase Dashboard**
1. Go to Table Editor
2. Select `electron_allowlist` table
3. Click "Insert row"
4. Enter user_id and email (must match existing auth.users)

**Option C: Programmatic (Admin Function)**
```typescript
// Admin-only function to add users
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Service role key required
)

async function addToAllowlist(email: string, notes?: string) {
  // Find user by email
  const { data: user, error: userError } = await supabase.auth.admin.listUsers()
  const targetUser = user?.users.find(u => u.email === email)

  if (!targetUser) {
    throw new Error(`User not found: ${email}`)
  }

  // Add to allowlist
  const { error } = await supabase
    .from('electron_allowlist')
    .insert({
      user_id: targetUser.id,
      email: targetUser.email,
      notes: notes || 'Added programmatically'
    })

  if (error) throw error

  console.log(`Added ${email} to Electron allowlist`)
}
```

### Step 3: Build for Electron

When building for Electron, ensure the `BUILD_TARGET` environment variable is set:

```bash
# Development
BUILD_TARGET=electron npm run dev:electron

# Production build
BUILD_TARGET=electron npm run build:electron
```

## How It Works

1. **Web Build** (`BUILD_TARGET=web` or default)
   - OAuth allows both signup and login
   - No allowlist checks performed
   - Normal Supabase authentication flow

2. **Electron Build** (`BUILD_TARGET=electron`)
   - OAuth callback is intercepted
   - User ID is checked against `electron_allowlist` table
   - If not in allowlist:
     - User is immediately signed out
     - Error message displayed: "Access Denied: Electron access requires authorization"
   - If in allowlist:
     - Login proceeds normally

## Database Schema

```sql
CREATE TABLE public.electron_allowlist (
  user_id UUID PRIMARY KEY,           -- References auth.users(id)
  email TEXT NOT NULL UNIQUE,         -- User email
  created_at TIMESTAMPTZ DEFAULT NOW(), -- When added to allowlist
  created_by UUID,                    -- Who added them (optional)
  notes TEXT                          -- Admin notes
);
```

## Security Considerations

1. **Row Level Security (RLS)** is enabled
   - Users can only view their own allowlist status
   - Service role has full access for admin operations

2. **Foreign Key Constraint**
   - `user_id` must reference existing `auth.users(id)`
   - Cascade delete: if user is deleted, allowlist entry is removed

3. **Email Validation**
   - Email must match the auth.users email
   - Unique constraint prevents duplicates

## Troubleshooting

### User can't log in to Electron app

1. Check if user exists in `auth.users`:
   ```sql
   SELECT id, email FROM auth.users WHERE email = 'user@example.com';
   ```

2. Check if user is in allowlist:
   ```sql
   SELECT * FROM public.electron_allowlist WHERE email = 'user@example.com';
   ```

3. Add user to allowlist if missing (see Step 2 above)

### Web app users can't sign up

- This should not happen - web builds bypass allowlist checks
- Verify `BUILD_TARGET` is NOT set to `electron` for web builds
- Check browser console for `[Login] Electron mode: ...` messages (should not appear in web mode)

## Maintenance

### View all allowlisted users
```sql
SELECT
  a.user_id,
  a.email,
  a.created_at,
  a.notes,
  u.created_at as user_created_at
FROM public.electron_allowlist a
JOIN auth.users u ON u.id = a.user_id
ORDER BY a.created_at DESC;
```

### Remove user from allowlist
```sql
DELETE FROM public.electron_allowlist
WHERE email = 'user@example.com';
```

### Bulk add users
```sql
INSERT INTO public.electron_allowlist (user_id, email, notes)
SELECT id, email, 'Bulk import'
FROM auth.users
WHERE email IN (
  'user1@example.com',
  'user2@example.com',
  'user3@example.com'
);
```
