export interface LocalFileEntry {
  name: string
  isDirectory: boolean
  path: string
  relativePath?: string
}

export interface LocalFileListingResponse {
  path: string
  files: LocalFileEntry[]
}

export interface LocalFileSearchResponse extends LocalFileListingResponse {
  query: string
  truncated: boolean
  respectingGitignore: boolean
}
