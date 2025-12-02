/**
 * OOB (Out-of-Band) Authentication Routes
 * 
 * Handles the OAuth callback and token exchange for Electron/CLI apps
 * that can't use deep links reliably.
 * 
 * Flow:
 * 1. User initiates OAuth in Electron
 * 2. Browser completes OAuth and redirects to /auth/callback
 * 3. Callback page extracts tokens and POSTs to /api/auth/oob/store
 * 4. Server stores tokens in Redis and returns a short code
 * 5. User enters code in Electron
 * 6. Electron calls /api/auth/oob/exchange to get tokens
 */

import express from 'express'
import { checkIssueRateLimit, exchangeOOBCode, storeOOBTokens } from '../utils/oobTokenStore'

const router = express.Router()

/**
 * GET /auth/callback
 * 
 * Supabase redirects here after OAuth completion.
 * Serves an HTML page that:
 * 1. Extracts tokens from URL hash
 * 2. POSTs tokens to server
 * 3. Displays the verification code to user
 */
router.get('/callback', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yggdrasil - Sign In Complete</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .container {
      text-align: center;
      padding: 2.5rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 420px;
      width: 100%;
    }
    .logo {
      font-size: 2rem;
      margin-bottom: 1.5rem;
    }
    .code {
      font-size: 2.5rem;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      letter-spacing: 0.15em;
      background: rgba(255, 255, 255, 0.1);
      padding: 1rem 1.5rem;
      border-radius: 12px;
      margin: 1.5rem 0;
      user-select: all;
      cursor: pointer;
      transition: background 0.2s;
    }
    .code:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .loading {
      color: #888;
      font-size: 1.1rem;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 1rem auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .error {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.1);
      padding: 1rem;
      border-radius: 8px;
      margin-top: 1rem;
    }
    .success {
      color: #22c55e;
      font-size: 1.1rem;
      margin-bottom: 0.5rem;
    }
    .hint {
      color: #888;
      font-size: 0.9rem;
      margin-top: 1rem;
    }
    .copy-hint {
      font-size: 0.8rem;
      color: #666;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🌳</div>
    
    <div id="loading">
      <div class="spinner"></div>
      <p class="loading">Completing sign-in...</p>
    </div>
    
    <div id="result" style="display:none">
      <p class="success">✓ Sign-in successful!</p>
      <p>Enter this code in Yggdrasil:</p>
      <div class="code" id="code" title="Click to copy"></div>
      <p class="copy-hint">Click code to copy</p>
      <p class="hint">This code expires in 5 minutes</p>
    </div>
    
    <div id="error" style="display:none" class="error"></div>
  </div>
  
  <script>
    (async () => {
      const loadingEl = document.getElementById('loading');
      const resultEl = document.getElementById('result');
      const errorEl = document.getElementById('error');
      const codeEl = document.getElementById('code');
      
      try {
        // Extract tokens from URL hash (Supabase implicit flow)
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        
        if (!access_token || !refresh_token) {
          // Check for error in params
          const error = params.get('error_description') || params.get('error');
          throw new Error(error || 'Authentication failed - no tokens received');
        }
        
        // Store tokens on server and get verification code
        const res = await fetch('/api/auth/oob/store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token, refresh_token })
        });
        
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to generate verification code');
        }
        
        const { code } = await res.json();
        
        // Show the code
        loadingEl.style.display = 'none';
        resultEl.style.display = 'block';
        codeEl.textContent = code;
        
        // Copy to clipboard on click
        codeEl.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(code);
            codeEl.style.background = 'rgba(34, 197, 94, 0.2)';
            setTimeout(() => {
              codeEl.style.background = '';
            }, 500);
          } catch (e) {
            // Fallback for older browsers
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(codeEl);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        });
        
        // Clear URL hash for security
        history.replaceState(null, '', window.location.pathname);
        
      } catch (err) {
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = err.message;
        console.error('OOB Auth Error:', err);
      }
    })();
  </script>
</body>
</html>`)
})

/**
 * POST /api/auth/oob/store
 * 
 * Store tokens in Redis and return a verification code.
 * Called by the callback page after extracting tokens from URL.
 */
router.post('/oob/store', async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || ''

    // Rate limit code issuance per IP
    if (!(await checkIssueRateLimit(ip))) {
      return res.status(429).json({ error: 'Too many code requests. Please try again later.' })
    }

    const { access_token, refresh_token } = req.body

    if (!access_token || !refresh_token) {
      return res.status(400).json({ error: 'Missing tokens' })
    }

    const code = await storeOOBTokens(access_token, refresh_token)
    console.log(`[OOB Auth] Generated code for IP ${ip}`)

    res.json({ code })
  } catch (error) {
    console.error('[OOB Auth] Error storing tokens:', error)
    res.status(500).json({ error: 'Failed to generate verification code' })
  }
})

/**
 * POST /api/auth/oob/exchange
 * 
 * Exchange verification code for tokens.
 * Called by Electron app when user enters the code.
 */
router.post('/oob/exchange', async (req, res) => {
  try {
    const { code } = req.body

    if (!code) {
      return res.status(400).json({ error: 'Missing verification code' })
    }

    const tokens = await exchangeOOBCode(code)

    if (!tokens) {
      return res.status(400).json({ error: 'Invalid or expired code' })
    }

    console.log('[OOB Auth] Code exchanged successfully')
    res.json(tokens)
  } catch (error) {
    console.error('[OOB Auth] Error exchanging code:', error)
    res.status(500).json({ error: 'Failed to verify code' })
  }
})

export default router
