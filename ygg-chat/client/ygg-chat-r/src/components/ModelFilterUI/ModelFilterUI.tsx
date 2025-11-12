import React, { useState } from 'react'
import type { ModelFilters, ModelSortOptions } from '../../hooks/useQueries'

interface ModelFilterUIProps {
  filters: ModelFilters
  sortOptions?: ModelSortOptions
  onFiltersChange: (filters: ModelFilters) => void
  onSortChange: (sortOptions: ModelSortOptions) => void
  onClearFilters: () => void
}

export const ModelFilterUI: React.FC<ModelFilterUIProps> = ({
  filters,
  sortOptions = {},
  onFiltersChange,
  onSortChange,
  onClearFilters,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [sortBy, setSortBy] = useState<'promptCost' | 'completionCost' | null>(sortOptions.sortBy || null)
  const [sortOrder, setSortOrder] = useState<'low-to-high' | 'high-to-low'>(sortOptions.sortOrder || 'low-to-high')
  const [contextLengthMax, setContextLengthMax] = useState<number>(filters.contextLengthMax || 0)

  const handleToggleFilter = (key: keyof ModelFilters, value: boolean) => {
    onFiltersChange({
      ...filters,
      [key]: filters[key] === value ? undefined : value,
    })
  }

  const hasActiveFilters = Object.values(filters).some(v => v !== undefined) || sortBy !== null

  return (
    <div className='space-y-2'>
      {/* Advanced Options Toggle */}
      <button
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className='w-full text-left px-1 py-1.5 text-[12px] font-semibold text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors flex items-center gap-1'
      >
        <i className={`bx bx-chevron-${advancedOpen ? 'down' : 'right'} text-[14px]`} />
        Advanced
      </button>

      {advancedOpen && (
        <>
          {/* Capabilities Section - Collapsible */}
          <div className='border-t border-neutral-200 dark:border-neutral-800 pt-2'>
            <button
              onClick={() => setCapabilitiesOpen(!capabilitiesOpen)}
              className='w-full text-left px-1 py-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors flex items-center gap-1'
            >
              <i className={`bx bx-chevron-${capabilitiesOpen ? 'down' : 'right'} text-[12px]`} />
              Capabilities
            </button>

            {capabilitiesOpen && (
              <div className='pl-2 space-y-1 pb-2'>
                <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                  <input
                    type='checkbox'
                    checked={filters.thinking === true}
                    onChange={() => handleToggleFilter('thinking', true)}
                    className='w-3 h-3 rounded'
                  />
                  <span>Thinking/Reasoning</span>
                </label>

                <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                  <input
                    type='checkbox'
                    checked={filters.supportsImages === true}
                    onChange={() => handleToggleFilter('supportsImages', true)}
                    className='w-3 h-3 rounded'
                  />
                  <span>Image Support</span>
                </label>

                <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                  <input
                    type='checkbox'
                    checked={filters.supportsWebSearch === true}
                    onChange={() => handleToggleFilter('supportsWebSearch', true)}
                    className='w-3 h-3 rounded'
                  />
                  <span>Web Search</span>
                </label>

                <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                  <input
                    type='checkbox'
                    checked={filters.supportsStructuredOutputs === true}
                    onChange={() => handleToggleFilter('supportsStructuredOutputs', true)}
                    className='w-3 h-3 rounded'
                  />
                  <span>Structured Outputs</span>
                </label>
              </div>
            )}
          </div>

          {/* Sort by Price Section - Collapsible */}
          <div className='border-t border-neutral-200 dark:border-neutral-800 pt-2'>
            <button
              onClick={() => setPriceOpen(!priceOpen)}
              className='w-full text-left px-1 py-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors flex items-center gap-1'
            >
              <i className={`bx bx-chevron-${priceOpen ? 'down' : 'right'} text-[12px]`} />
              Sort by Price
            </button>

            {priceOpen && (
              <div className='pl-2 space-y-2 pb-2'>
                <div className='space-y-1'>
                  <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                    <input
                      type='radio'
                      name='sortBy'
                      checked={sortBy === 'promptCost'}
                      onChange={() => {
                        setSortBy('promptCost')
                        onSortChange({ sortBy: 'promptCost', sortOrder })
                      }}
                      className='w-3 h-3'
                    />
                    <span>Prompt Cost</span>
                  </label>

                  <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                    <input
                      type='radio'
                      name='sortBy'
                      checked={sortBy === 'completionCost'}
                      onChange={() => {
                        setSortBy('completionCost')
                        onSortChange({ sortBy: 'completionCost', sortOrder })
                      }}
                      className='w-3 h-3'
                    />
                    <span>Completion Cost</span>
                  </label>
                </div>

                {sortBy && (
                  <div className='space-y-1 pt-1 border-t border-neutral-200 dark:border-neutral-800'>
                    <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                      <input
                        type='radio'
                        name='sortOrder'
                        checked={sortOrder === 'low-to-high'}
                        onChange={() => {
                          setSortOrder('low-to-high')
                          onSortChange({ sortBy, sortOrder: 'low-to-high' })
                        }}
                        className='w-3 h-3'
                      />
                      <span>Low to High</span>
                    </label>

                    <label className='flex items-center gap-2 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'>
                      <input
                        type='radio'
                        name='sortOrder'
                        checked={sortOrder === 'high-to-low'}
                        onChange={() => {
                          setSortOrder('high-to-low')
                          onSortChange({ sortBy, sortOrder: 'high-to-low' })
                        }}
                        className='w-3 h-3'
                      />
                      <span>High to Low</span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Context Length Section - Collapsible */}
          <div className='border-t border-neutral-200 dark:border-neutral-800 pt-2'>
            <button
              onClick={() => setContextOpen(!contextOpen)}
              className='w-full text-left px-1 py-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors flex items-center gap-1'
            >
              <i className={`bx bx-chevron-${contextOpen ? 'down' : 'right'} text-[12px]`} />
              Context Length
            </button>

            {contextOpen && (
              <div className='pl-2 space-y-2 pb-2'>
                <div className='space-y-1'>
                  <label className='text-[11px] text-neutral-600 dark:text-neutral-400'>
                    Minimum: {(contextLengthMax / 1000).toFixed(0)}K tokens
                  </label>
                  <input
                    type='range'
                    min='0'
                    max='2000000'
                    step='10000'
                    value={contextLengthMax}
                    onChange={e => {
                      const val = Number(e.target.value)
                      setContextLengthMax(val)
                      onFiltersChange({
                        ...filters,
                        contextLengthMax: val,
                      })
                    }}
                    className='w-full h-1.5 bg-neutral-300 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer'
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Clear Filters Button - Only show when filters are active */}
      {hasActiveFilters && (
        <button
          onClick={() => {
            onClearFilters()
            setSortBy(null)
            setSortOrder('low-to-high')
          }}
          className='w-full px-2 py-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors border-t border-neutral-200 dark:border-neutral-800 mt-2 pt-2'
        >
          Clear Filters
        </button>
      )}
    </div>
  )
}
