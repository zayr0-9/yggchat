import { Browser, BrowserContext, chromium, Page } from 'playwright'

// Browser session management
class BrowserSession {
  private static instance: BrowserSession
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private lastUsed: number = 0
  private readonly TIMEOUT = 5 * 60 * 1000 // 5 minutes

  static getInstance(): BrowserSession {
    if (!BrowserSession.instance) {
      BrowserSession.instance = new BrowserSession()
    }
    return BrowserSession.instance
  }

  async getBrowser(options: {
    headless: boolean
    userAgent: string
    viewport: { width: number; height: number }
    useUserProfile?: boolean
    userDataDir?: string
    useBrave?: boolean
    executablePath?: string
  }): Promise<{ browser: Browser; context: BrowserContext }> {
    const now = Date.now()

    // Close browser if it's been idle too long
    if (this.browser && this.context && now - this.lastUsed > this.TIMEOUT) {
      await this.close()
    }

    // Create new browser if needed
    if (!this.browser || !this.context) {
      const launchOptions: any = {
        headless: options.headless,
        args: options.headless
          ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
          : [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-blink-features=AutomationControlled',
            ],
      }

      // Add user data directory for existing browser profile
      const userDataDir = options.userDataDir || process.env.BRAVE_USER_DATA_DIR
      if (options.useUserProfile && userDataDir) {
        launchOptions.args.push(`--user-data-dir=${userDataDir}`)
      }

      // Set executable path for Brave browser
      if (options.useBrave || options.executablePath) {
        const bravePath = options.executablePath || this.getBravePath()
        if (bravePath) {
          launchOptions.executablePath = bravePath
        }
      }

      this.browser = await chromium.launch(launchOptions)

      this.context = await this.browser.newContext({
        userAgent: options.userAgent,
        viewport: options.viewport,
        ...(options.headless
          ? {}
          : {
              extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
              },
            }),
      })
    }

    this.lastUsed = now
    return { browser: this.browser, context: this.context }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
    }
  }

  private getBravePath(): string | null {
    const { platform } = process
    const { existsSync } = require('fs')

    const paths = {
      linux: [
        '/usr/bin/brave-browser',
        '/usr/bin/brave',
        '/snap/bin/brave',
        '/opt/brave.com/brave/brave-browser',
        '/usr/bin/brave-browser-stable',
      ],
      darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
      win32: [
        `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${process.env.PROGRAMFILES}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${process.env['PROGRAMFILES(X86)']}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      ],
    }

    const platformPaths = paths[platform as keyof typeof paths] || []

    for (const path of platformPaths) {
      if (existsSync(path)) {
        return path
      }
    }

    return null
  }
}

const browserSession = BrowserSession.getInstance()

interface BrowseWebOptions {
  waitForSelector?: string
  timeout?: number
  userAgent?: string
  viewport?: { width: number; height: number }
  waitForNetworkIdle?: boolean
  extractImages?: boolean
  extractLinks?: boolean
  extractMetadata?: boolean
  headless?: boolean
  useUserProfile?: boolean
  userDataDir?: string
  retries?: number
  retryDelay?: number
  useBrave?: boolean
  executablePath?: string
}

interface ExtractedContent {
  title: string
  url: string
  content: string
  metadata?: {
    description?: string
    author?: string
    publishDate?: string
    siteName?: string
    type?: string
  }
  headings?: Array<{
    level: number
    text: string
    id?: string
  }>
  links?: Array<{
    text: string
    href: string
    type: 'internal' | 'external'
  }>
  images?: Array<{
    src: string
    alt: string
    title?: string
  }>
  textChunks?: Array<{
    text: string
    type: 'paragraph' | 'heading' | 'list' | 'quote'
    priority: number
  }>
  allText?: string
}

interface BrowseWebResult {
  success: boolean
  data?: ExtractedContent
  error?: string
  url: string
}

/**
 * Internal function to attempt browsing with better error handling
 */
async function attemptBrowse(url: string, options: BrowseWebOptions, attempt: number = 1): Promise<BrowseWebResult> {
  const {
    waitForSelector,
    timeout = 30000,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport = { width: 1280, height: 720 },
    waitForNetworkIdle = true,
    extractImages = true,
    extractLinks = true,
    extractMetadata = true,
    headless = true,
    useUserProfile = false,
    userDataDir,
    retries = 2,
    retryDelay = 1000,
    useBrave = false,
    executablePath,
  } = options

  let page: Page | null = null

  try {
    // Validate URL
    new URL(url)

    // Get persistent browser session
    const { browser, context } = await browserSession.getBrowser({
      headless,
      userAgent,
      viewport,
      useUserProfile,
      userDataDir,
      useBrave,
      executablePath,
    })

    page = await context.newPage()

    // Add stealth measures for non-headless mode
    if (!headless) {
      await page.addInitScript(() => {
        // Remove webdriver property
        delete ((globalThis as any).window as any).navigator.webdriver

        // Override the plugins property to use a custom getter
        Object.defineProperty((globalThis as any).navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        })

        // Override the languages property to use a custom getter
        Object.defineProperty((globalThis as any).navigator, 'languages', {
          get: () => ['en-US', 'en'],
        })

        // Override the permissions property to use a custom getter
        Object.defineProperty((globalThis as any).navigator, 'permissions', {
          get: () => ({
            query: () => Promise.resolve({ state: 'granted' }),
          }),
        })
      })
    }

    // Set timeout
    page.setDefaultTimeout(timeout)

    // Navigate to the page with progressive fallbacks
    try {
      await page.goto(url, {
        waitUntil: waitForNetworkIdle ? 'networkidle' : 'load',
        timeout,
      })
    } catch (error) {
      // If networkidle fails, try with just 'load'
      if (waitForNetworkIdle) {
        console.log(`Attempt ${attempt}: networkidle failed, trying with 'load'`)
        await page.goto(url, {
          waitUntil: 'load',
          timeout,
        })
      } else {
        throw error
      }
    }

    // Wait for specific selector if provided, or Twitter-specific content
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout })
    } else if (url.includes('twitter.com') || url.includes('x.com')) {
      // Wait for Twitter content to load
      try {
        await page.waitForSelector('[data-testid="tweetText"], [data-testid="tweet"], article[data-testid="tweet"]', {
          timeout: Math.min(timeout, 15000),
        })
      } catch {
        // Continue if Twitter selectors don't appear - might be a different page type
      }
    }

    // Extract content using our readability-like algorithm
    const extractedContent = await page.evaluate(
      options => {
        const { extractImages, extractLinks, extractMetadata } = options

        // Helper function to get text content and clean it
        function getCleanText(element: Element): string {
          return (element as any).textContent?.trim().replace(/\s+/g, ' ') || ''
        }

        // Helper function to determine if element is likely to be main content
        function getContentScore(element: Element): number {
          let score = 0
          const tagName = (element as any).tagName.toLowerCase()
          const className = (element as any).className.toLowerCase()
          const id = (element as any).id.toLowerCase()

          // Tag-based scoring
          if (['article', 'main', 'section'].includes(tagName)) score += 5
          if (['div', 'p'].includes(tagName)) score += 1
          if (['nav', 'header', 'footer', 'aside'].includes(tagName)) score -= 3
          if (['script', 'style', 'noscript'].includes(tagName)) score -= 5

          // Class/ID-based scoring
          if (/content|article|post|main|body|tweet|status/.test(className + id)) score += 3
          if (/nav|menu|sidebar|comment|ad|advertisement|footer|header/.test(className + id)) score -= 2

          // Twitter/X specific scoring
          if (/tweet|status|primaryColumn/.test(className + id)) score += 5
          if ((element as any).getAttribute && (element as any).getAttribute('data-testid') === 'tweetText') score += 10

          // Text length scoring
          const textLength = getCleanText(element).length
          if (textLength > 100) score += Math.min(textLength / 100, 3)

          // Paragraph count scoring
          const paragraphs = (element as any).querySelectorAll('p')
          score += Math.min(paragraphs.length, 5)

          return score
        }

        // Extract all text content from the page
        function extractAllTextContent() {
          const textElements = [
            'p',
            'span',
            'div',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'li',
            'td',
            'th',
            'blockquote',
            'pre',
            'code',
            'em',
            'strong',
            'b',
            'i',
            'u',
            'mark',
            'small',
            'sub',
            'sup',
            'article',
            'section',
            'main',
            'aside',
            'nav',
            'header',
            'footer',
            'time',
            'address',
            'figcaption',
            'caption',
            'label',
            'legend',
            'summary',
            'details',
          ]

          const allTextContent: string[] = []
          const processedElements = new Set()

          // Get all elements that might contain text
          const allElements = ((globalThis as any).document as any).querySelectorAll(textElements.join(', '))

          Array.from(allElements).forEach((element: any) => {
            // Skip if we've already processed this element or its parent
            if (processedElements.has(element)) return

            const text = getCleanText(element)
            if (text && text.length > 3) {
              // Only include meaningful text
              // Check if this text is already included in a parent element
              let isChildText = false
              for (const existingText of allTextContent) {
                if (existingText.includes(text) && existingText.length > text.length + 10) {
                  isChildText = true
                  break
                }
              }

              if (!isChildText) {
                allTextContent.push(text)
                processedElements.add(element)

                // Mark all child text elements as processed to avoid duplication
                const childTextElements = element.querySelectorAll(textElements.join(', '))
                Array.from(childTextElements).forEach((child: any) => {
                  processedElements.add(child)
                })
              }
            }
          })

          return allTextContent.join('\\n\\n')
        }

        // Find the main content container (fallback for other extractions)
        function findMainContent(): Element {
          return ((globalThis as any).document as any).body
        }

        // Extract metadata
        function extractPageMetadata() {
          if (!extractMetadata) return undefined

          const getMetaContent = (name: string): string | undefined => {
            const meta =
              ((globalThis as any).document as any).querySelector(`meta[name="${name}"]`) ||
              ((globalThis as any).document as any).querySelector(`meta[property="${name}"]`) ||
              ((globalThis as any).document as any).querySelector(`meta[property="og:${name}"]`) ||
              ((globalThis as any).document as any).querySelector(`meta[name="twitter:${name}"]`)
            return meta?.getAttribute('content') || undefined
          }

          return {
            description: getMetaContent('description'),
            author: getMetaContent('author'),
            publishDate: getMetaContent('article:published_time') || getMetaContent('date'),
            siteName: getMetaContent('site_name') || getMetaContent('og:site_name'),
            type: getMetaContent('type') || getMetaContent('og:type'),
          }
        }

        // Extract headings with hierarchy
        function extractHeadings(container: Element) {
          const headings: Array<{ level: number; text: string; id?: string }> = []
          const headingElements = (container as any).querySelectorAll('h1, h2, h3, h4, h5, h6')

          headingElements.forEach((heading: any) => {
            const level = parseInt((heading as any).tagName.charAt(1))
            const text = getCleanText(heading)
            const id = (heading as any).id || undefined

            if (text) {
              headings.push({ level, text, id })
            }
          })

          return headings
        }

        // Extract links
        function extractPageLinks(container: Element) {
          if (!extractLinks) return undefined

          const links: Array<{ text: string; href: string; type: 'internal' | 'external' }> = []
          const linkElements = (container as any).querySelectorAll('a[href]')
          const currentDomain = ((globalThis as any).window as any).location.hostname

          linkElements.forEach((link: any) => {
            const href = (link as any).getAttribute('href')
            const text = getCleanText(link)

            if (href && text && href !== '#') {
              let fullHref = href
              try {
                const url = new URL(href, ((globalThis as any).window as any).location.href)
                fullHref = url.href
                const isInternal = url.hostname === currentDomain
                links.push({
                  text: text.substring(0, 100), // Limit text length
                  href: fullHref,
                  type: isInternal ? 'internal' : 'external',
                })
              } catch {
                // Skip invalid URLs
              }
            }
          })

          return links
        }

        // Extract images
        function extractPageImages(container: Element) {
          if (!extractImages) return undefined

          const images: Array<{ src: string; alt: string; title?: string }> = []
          const imgElements = (container as any).querySelectorAll('img[src]')

          imgElements.forEach((img: any) => {
            const src = (img as any).getAttribute('src')
            const alt = (img as any).getAttribute('alt') || ''
            const title = (img as any).getAttribute('title')

            if (src) {
              try {
                const fullSrc = new URL(src, ((globalThis as any).window as any).location.href).href
                images.push({
                  src: fullSrc,
                  alt,
                  title: title || undefined,
                })
              } catch {
                // Skip invalid URLs
              }
            }
          })

          return images
        }

        // Create text chunks with priority
        function createTextChunks(container: Element) {
          const chunks: Array<{ text: string; type: 'paragraph' | 'heading' | 'list' | 'quote'; priority: number }> = []

          // Process different element types
          const elements = (container as any).querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, div')

          elements.forEach((element: any, index: number) => {
            const text = getCleanText(element)
            if (text.length < 20) return // Skip very short text

            const tagName = (element as any).tagName.toLowerCase()
            let type: 'paragraph' | 'heading' | 'list' | 'quote' = 'paragraph'
            let priority = 1

            if (/^h[1-6]$/.test(tagName)) {
              type = 'heading'
              priority = 6 - parseInt(tagName.charAt(1)) // h1 = 5, h2 = 4, etc.
            } else if (tagName === 'li') {
              type = 'list'
              priority = 2
            } else if (tagName === 'blockquote') {
              type = 'quote'
              priority = 2
            } else if (tagName === 'p') {
              priority = 3
            }

            // Boost priority for elements near the top
            if (index < 10) priority += 1

            chunks.push({ text, type, priority })
          })

          // Sort by priority (higher first)
          chunks.sort((a, b) => b.priority - a.priority)

          return chunks
        }

        // Main extraction logic
        const mainContent = findMainContent()
        const title = ((globalThis as any).document as any).title
        const url = ((globalThis as any).window as any).location.href

        // Remove script and style elements from main content
        const scriptsAndStyles = (mainContent as any).querySelectorAll('script, style, noscript')
        scriptsAndStyles.forEach((el: any) => el.remove())

        // Extract comprehensive text content from all text elements
        const allTextContent = extractAllTextContent()

        // Also extract traditional content for other features
        const content = getCleanText(mainContent)

        return {
          title,
          url,
          content: allTextContent.substring(0, 50000), // Use comprehensive text extraction
          metadata: extractPageMetadata(),
          headings: extractHeadings(mainContent),
          links: extractPageLinks(mainContent),
          images: extractPageImages(mainContent),
          textChunks: createTextChunks(mainContent).slice(0, 50), // Limit chunks
          allText: allTextContent.substring(0, 50000), // Include full text extraction
        }
      },
      { extractImages, extractLinks, extractMetadata }
    )

    // Close the page but keep browser/context alive
    await page.close()

    return {
      success: true,
      data: extractedContent,
      url,
    }
  } catch (error) {
    // Close the page on error but keep browser/context alive
    if (page) {
      try {
        await page.close()
      } catch {
        // Ignore close errors
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred while browsing',
      url,
    }
  }
}

/**
 * Browse a web page and extract its content using Playwright and Readability-like algorithms
 * Includes retry logic for better reliability
 */
export async function browseWeb(url: string, options: BrowseWebOptions = {}): Promise<BrowseWebResult> {
  const { retries = 2, retryDelay = 1000 } = options

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const result = await attemptBrowse(url, options, attempt)
      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt <= retries) {
        console.log(`Attempt ${attempt} failed for ${url}: ${lastError.message}. Retrying in ${retryDelay}ms...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))

        // Increase timeout for subsequent attempts
        options.timeout = (options.timeout || 30000) + 10000
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${retries + 1} attempts. Last error: ${lastError?.message || 'Unknown error'}`,
    url,
  }
}

// Export cleanup function for graceful shutdown
export async function closeBrowserSession(): Promise<void> {
  await browserSession.close()
}
