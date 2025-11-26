const fetchFn = globalThis.fetch

export interface ExaCodeContextOptions {
  tokensNum?: string | number
}

interface ExaCodeContextResponse {
  requestId?: string
  query?: string
  response?: string
  resultsCount?: number
  outputTokens?: number
  costDollars?: Record<string, number>
}

interface ExaCodeContextResult {
  success: boolean
  query: string
  codeContext?: string
  resultsCount?: number
  outputTokens?: number
  costDollars?: Record<string, number>
  error?: string
}

export async function exaCodeContext(
  query: string,
  options: ExaCodeContextOptions = {}
): Promise<ExaCodeContextResult> {
  const apiKey = process.env.EXA_API_KEY

  if (!apiKey) {
    return {
      success: false,
      query,
      error: 'EXA_API_KEY missing',
    }
  }

  if (!query?.trim()) {
    return {
      success: false,
      query,
      error: 'Query required',
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
    const response = await fetchFn('https://api.exa.ai/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: query.trim(),
        tokensNum: options.tokensNum ?? 'dynamic',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        query,
        error: `Exa Code API: ${response.status} - ${errorText}`,
      }
    }

    const data = (await response.json()) as ExaCodeContextResponse

    return {
      success: true,
      query,
      codeContext: data.response,
      resultsCount: data.resultsCount,
      outputTokens: data.outputTokens,
      costDollars: data.costDollars,
    }
  } catch (error) {
    return {
      success: false,
      query,
      error: error instanceof Error ? error.message : 'Exa Code error',
    }
  }
}
