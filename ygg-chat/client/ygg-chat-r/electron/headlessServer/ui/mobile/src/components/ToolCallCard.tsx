import React, { useMemo, useState } from 'react'
import type { ToolGroup } from '../types'
import { toReadableToolResult } from '../messageParser'

interface ToolCallCardProps {
  group: ToolGroup
  defaultExpanded?: boolean
}

const findPathHint = (args: Record<string, unknown> | undefined): string | null => {
  if (!args) return null
  const key = ['path', 'filePath', 'cwd', 'searchPath'].find(candidate => typeof args[candidate] === 'string')
  if (!key) return null
  return String(args[key])
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({ group, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const pathHint = useMemo(() => findPathHint(group.args), [group.args])
  const hasError = group.results.some(result => Boolean(result.is_error))

  return (
    <div className='mobile-tool-card'>
      <div className={`mobile-tool-dot ${hasError ? 'error' : 'success'}`} />
      <button className='mobile-tool-header' onClick={() => setExpanded(value => !value)}>
        <span className='mobile-tool-chip'>{group.name || 'tool'}</span>
        {!expanded && pathHint ? <span className='mobile-tool-path'>{pathHint}</span> : null}
        <span className={`tool-chevron ${expanded ? 'open' : ''}`}>›</span>
      </button>

      <div className={`tool-expand-container ${expanded ? 'open' : ''}`}>
        <div className='tool-expand-content'>
          {group.args && Object.keys(group.args).length > 0 ? (
            <div className='mobile-tool-block'>
              {Object.entries(group.args).map(([key, value]) => (
                <div key={key} className='mobile-tool-kv'>
                  <span className='mobile-tool-k'>{key}:</span>{' '}
                  <span className='mobile-tool-v'>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {group.results.map((result, index) => (
            <div key={`${group.id}-result-${index}`} className={`mobile-tool-result ${result.is_error ? 'error' : 'success'}`}>
              <pre>{toReadableToolResult(result)}</pre>
              <span className='mobile-tool-status'>{result.is_error ? 'failed' : 'completed'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
