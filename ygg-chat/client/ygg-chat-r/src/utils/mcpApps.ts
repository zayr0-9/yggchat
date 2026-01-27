export type McpUiCsp = {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

export type McpUiPermissions = {
  camera?: {}
  microphone?: {}
  geolocation?: {}
  clipboardWrite?: {}
}

export type McpUiMeta = {
  csp?: McpUiCsp
  permissions?: McpUiPermissions
  domain?: string
  prefersBorder?: boolean
}

export type McpUiResource = {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  _meta?: {
    ui?: McpUiMeta
  }
}

const joinDomains = (domains?: string[]) => (Array.isArray(domains) && domains.length > 0 ? domains.join(' ') : '')

export const buildCspValue = (csp?: McpUiCsp): string => {
  const resourceDomains = joinDomains(csp?.resourceDomains)
  const connectDomains = joinDomains(csp?.connectDomains)
  const frameDomains = joinDomains(csp?.frameDomains)
  const baseUriDomains = joinDomains(csp?.baseUriDomains)

  const resourceSuffix = resourceDomains ? ` ${resourceDomains}` : ''
  const connectValue = connectDomains ? `'self' ${connectDomains}` : "'none'"
  const frameValue = frameDomains ? frameDomains : "'none'"
  const baseUriValue = baseUriDomains ? baseUriDomains : "'self'"

  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'${resourceSuffix}`,
    `style-src 'self' 'unsafe-inline'${resourceSuffix}`,
    `img-src 'self' data:${resourceSuffix}`,
    `font-src 'self'${resourceSuffix}`,
    `media-src 'self' data:${resourceSuffix}`,
    `connect-src ${connectValue}`,
    `frame-src ${frameValue}`,
    "object-src 'none'",
    `base-uri ${baseUriValue}`,
  ].join('; ')
}

const escapeAttribute = (value: string) => value.replace(/"/g, '&quot;')

export const injectCspMeta = (html: string, cspValue: string): string => {
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(cspValue)}">`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, match => `${match}\n${metaTag}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, match => `${match}\n<head>${metaTag}</head>`)
  }
  return `<!DOCTYPE html><html><head>${metaTag}</head><body>${html}</body></html>`
}

export const decodeResourceHtml = (resource: McpUiResource): string | null => {
  if (typeof resource.text === 'string') return resource.text
  if (typeof resource.blob === 'string') {
    try {
      return atob(resource.blob)
    } catch {
      return null
    }
  }
  return null
}

export const buildIframeAllow = (permissions?: McpUiPermissions, baseAllow?: string): string => {
  const allowParts: string[] = []
  if (baseAllow) allowParts.push(baseAllow)
  if (permissions?.camera) allowParts.push('camera')
  if (permissions?.microphone) allowParts.push('microphone')
  if (permissions?.geolocation) allowParts.push('geolocation')
  if (permissions?.clipboardWrite) allowParts.push('clipboard-write')
  return allowParts.join('; ')
}
