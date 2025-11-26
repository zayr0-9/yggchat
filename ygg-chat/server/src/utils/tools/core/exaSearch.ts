const fetchFn = globalThis.fetch

interface ExaSearchResult {
  title: string | null
  url: string
  snippet?: string | null
  publishedDate?: string | null
  author?: string | null
  highlights?: string[]
  highlightScores?: number[]
  summary?: string | null
  image?: string | null
  favicon?: string | null
  subpages?: Array<{
    id?: string
    url: string
    title?: string | null
    author?: string | null
    publishedDate?: string | null
    summary?: string | null
    highlights?: string[]
  }>
}

interface ExaSearchOptions {
  numResults?: number
  type?: 'auto' | 'neural' | 'fast' | 'deep'
  additionalQueries?: string[]
  category?: 'company' | 'research paper' | 'news' | 'pdf' | 'github' | 'tweet' | 'personal site' | 'linkedin profile' | 'financial report'
  userLocation?: string
  includeDomains?: string[]
  excludeDomains?: string[]
  startCrawlDate?: string
  endCrawlDate?: string
  startPublishedDate?: string
  endPublishedDate?: string
  includeText?: string[]
  excludeText?: string[]
  context?: boolean
  moderation?: boolean
}

interface ExaSearchResponse {
  requestId?: string
  resolvedSearchType?: string
  searchType?: string
  results?: Array<{
    title?: string
    url: string
    text?: string
    highlights?: string[]
    highlightScores?: number[]
    publishedDate?: string
    author?: string
    summary?: string
    image?: string
    favicon?: string
    id?: string
    subpages?: Array<{
      id?: string
      url: string
      title?: string
      author?: string
      publishedDate?: string
      text?: string
      summary?: string
      highlights?: string[]
    }>
  }>
  totalCount?: number
  context?: string
}

export async function exaSearch(
  query: string,
  options: ExaSearchOptions = {}
): Promise<{
  success: boolean
  query: string
  results?: ExaSearchResult[]
  total_results?: number
  searchType?: string
  resolvedSearchType?: string
  context?: string
  requestId?: string
  error?: string
}> {
  const apiKey = process.env.EXA_API_KEY

  if (!apiKey) {
    return {
      success: false,
      query,
      error: 'EXA_API_KEY environment variable is not set',
    }
  }

  if (!query || query.trim().length === 0) {
    return {
      success: false,
      query,
      error: 'Search query cannot be empty',
    }
  }

  if (!fetchFn) {
    return {
      success: false,
      query,
      error: 'Fetch API is not available in this environment',
    }
  }

  try {
    const response = await fetchFn('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: query.trim(),
        numResults: Math.min(Math.max(options.numResults ?? 10, 1), 100),
        type: options.type ?? 'auto',
        additionalQueries: options.additionalQueries,
        category: options.category,
        userLocation: options.userLocation,
        includeDomains: options.includeDomains,
        excludeDomains: options.excludeDomains,
        startCrawlDate: options.startCrawlDate,
        endCrawlDate: options.endCrawlDate,
        startPublishedDate: options.startPublishedDate,
        endPublishedDate: options.endPublishedDate,
        includeText: options.includeText,
        excludeText: options.excludeText,
        context: options.context,
        moderation: options.moderation,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        query,
        error: `Exa API error: ${response.status} ${response.statusText} - ${errorText}`,
      }
    }

    const data = (await response.json()) as ExaSearchResponse

    const normalizedResults: ExaSearchResult[] = (data.results || []).map(result => ({
      title: result.title ?? null,
      url: result.url,
      snippet: result.text ?? null,
      publishedDate: result.publishedDate ?? null,
      author: result.author ?? null,
      highlights: result.highlights,
      highlightScores: result.highlightScores,
      summary: result.summary ?? null,
      image: result.image ?? null,
      favicon: result.favicon ?? null,
      subpages: result.subpages?.map(subpage => ({
        id: subpage.id,
        url: subpage.url,
        title: subpage.title ?? null,
        author: subpage.author ?? null,
        publishedDate: subpage.publishedDate ?? null,
        summary: subpage.summary ?? null,
        highlights: subpage.highlights,
      })),
    }))

    return {
      success: true,
      query,
      results: normalizedResults,
      total_results: normalizedResults.length,
      searchType: data.searchType,
      resolvedSearchType: data.resolvedSearchType,
      context: data.context,
      requestId: data.requestId,
    }
  } catch (error) {
    return {
      success: false,
      query,
      error: error instanceof Error ? error.message : 'Unknown error occurred during Exa search',
    }
  }
}
