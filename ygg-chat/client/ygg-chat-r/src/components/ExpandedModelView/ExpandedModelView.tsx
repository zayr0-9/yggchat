import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BaseModel } from '../../../../../shared/types'
import { COMPANY_PREFIXES, COMPANY_TAB_ORDER, NEW_MODELS, TOP_MODELS } from '../../config/modelLists'
import { Button } from '../Button/button'

interface ExpandedModelViewProps {
  isOpen: boolean
  onClose: () => void
  models: BaseModel[]
  selectedModelName?: string
  onSelect: (modelName: string) => void
  disabledOptions?: string[]
}

type TabId = 'top' | 'new' | 'image-gen' | 'all' | string // string for company names

interface Tab {
  id: TabId
  label: string
}

export const ExpandedModelView: React.FC<ExpandedModelViewProps> = ({
  isOpen,
  onClose,
  models,
  selectedModelName,
  onSelect,
  disabledOptions = [],
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('top')
  const [searchTerm, setSearchTerm] = useState('')

  // Build tabs: Top, New, Image Gen, Companies..., All
  const tabs: Tab[] = useMemo(() => {
    const baseTabs: Tab[] = [
      { id: 'top', label: 'Top' },
      { id: 'new', label: 'New' },
      { id: 'image-gen', label: 'Image Gen' },
    ]

    // Add company tabs in order
    const companyTabs = COMPANY_TAB_ORDER.map(company => ({
      id: company,
      label: company,
    }))

    return [...baseTabs, ...companyTabs, { id: 'all', label: 'All' }]
  }, [])

  // Filter models based on active tab and search
  const filteredModels = useMemo(() => {
    let result: BaseModel[] = []

    switch (activeTab) {
      case 'top':
        // Show models in TOP_MODELS list, preserving order
        result = TOP_MODELS.map(name => models.find(m => m.name === name)).filter(Boolean) as BaseModel[]
        break
      case 'new':
        // Show models in NEW_MODELS list, preserving order
        result = NEW_MODELS.map(name => models.find(m => m.name === name)).filter(Boolean) as BaseModel[]
        break
      case 'image-gen':
        // Show models that can generate images (outputModalities includes 'image')
        result = models.filter(m => m.outputModalities?.includes('image'))
        break
      case 'all':
        result = models
        break
      default:
        // Company tab - filter by prefix
        const prefix = COMPANY_PREFIXES[activeTab]
        if (prefix) {
          result = models.filter(m => m.name.startsWith(prefix))
        }
        break
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      result = result.filter(
        m =>
          m.name.toLowerCase().includes(term) ||
          m.displayName?.toLowerCase().includes(term) ||
          m.description?.toLowerCase().includes(term)
      )
    }

    return result
  }, [activeTab, models, searchTerm])

  // Format context length for display
  const formatContextLength = (length: number): string => {
    if (!length) return ''
    if (length >= 1000000) return `${(length / 1000000).toFixed(1)}M`
    if (length >= 1000) return `${Math.round(length / 1000)}K`
    return String(length)
  }

  const handleModelSelect = (modelName: string) => {
    if (disabledOptions.includes(modelName)) return
    onSelect(modelName)
    onClose()
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className='fixed inset-0 z-[150] flex items-center justify-center bg-black/50 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        className='bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col overflow-hidden'
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className='shrink-0 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 flex items-center justify-between'>
          <h2 className='text-xl font-semibold text-neutral-900 dark:text-neutral-100'>Select Model</h2>
          <button
            onClick={onClose}
            className='text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors'
            aria-label='Close modal'
          >
            <i className='bx bx-x text-2xl' />
          </button>
        </div>

        {/* Tabs */}
        <div className='shrink-0 border-b border-neutral-200 dark:border-neutral-800 px-4 overflow-x-auto no-scrollbar'>
          <div className='flex gap-1 py-2'>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className='shrink-0 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800'>
          <div className='relative'>
            <i className='bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400' />
            <input
              type='text'
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder='Search models...'
              className='w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600'
              autoFocus
            />
          </div>
        </div>

        {/* Model List */}
        <div className='flex-1 overflow-y-auto thin-scrollbar px-4 py-2'>
          {filteredModels.length === 0 ? (
            <div className='text-center py-8 text-neutral-500 dark:text-neutral-400'>
              {activeTab === 'new' && NEW_MODELS.length === 0
                ? 'No new models configured. Edit config/modelLists.ts to add models.'
                : activeTab === 'top' && TOP_MODELS.length === 0
                  ? 'No top models configured. Edit config/modelLists.ts to add models.'
                  : activeTab === 'image-gen'
                    ? 'No image generation models available.'
                    : 'No models found'}
            </div>
          ) : (
            <div className='space-y-1'>
              {filteredModels.map(model => {
                const isSelected = model.name === selectedModelName
                const isDisabled = disabledOptions.includes(model.name)

                return (
                  <button
                    key={model.name}
                    onClick={() => handleModelSelect(model.name)}
                    disabled={isDisabled}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
                      isSelected
                        ? 'bg-neutral-200 dark:bg-neutral-700'
                        : isDisabled
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <div className='flex items-start justify-between gap-4'>
                      <div className='flex-1 min-w-0'>
                        {/* Model name */}
                        <div className='flex items-center gap-2'>
                          <span className='font-medium text-neutral-900 dark:text-neutral-100 truncate'>
                            {model.displayName || model.name}
                          </span>
                          {isSelected && (
                            <span className='text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'>
                              Selected
                            </span>
                          )}
                          {isDisabled && <i className='bx bx-lock-alt text-neutral-400' />}
                        </div>
                        {/* Model ID */}
                        <div className='text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5'>
                          {model.name}
                        </div>
                      </div>

                      {/* Capabilities & Context */}
                      <div className='flex items-center gap-3 shrink-0'>
                        {/* Capability icons */}
                        <div className='flex items-center gap-1.5'>
                          {model.thinking && (
                            <span
                              className='text-purple-600 dark:text-purple-400'
                              title='Thinking/Reasoning'
                            >
                              <i className='bx bx-brain text-lg' />
                            </span>
                          )}
                          {model.supportsImages && (
                            <span
                              className='text-blue-600 dark:text-blue-400'
                              title='Image Support'
                            >
                              <i className='bx bx-image text-lg' />
                            </span>
                          )}
                          {model.supportsWebSearch && (
                            <span
                              className='text-green-600 dark:text-green-400'
                              title='Web Search'
                            >
                              <i className='bx bx-globe text-lg' />
                            </span>
                          )}
                          {model.supportsStructuredOutputs && (
                            <span
                              className='text-orange-600 dark:text-orange-400'
                              title='Structured Outputs'
                            >
                              <i className='bx bx-code-block text-lg' />
                            </span>
                          )}
                          {model.outputModalities?.includes('image') && (
                            <span
                              className='text-pink-600 dark:text-pink-400'
                              title='Image Generation'
                            >
                              <i className='bx bx-palette text-lg' />
                            </span>
                          )}
                        </div>

                        {/* Context length badge */}
                        {model.contextLength > 0 && (
                          <span className='text-xs px-2 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'>
                            {formatContextLength(model.contextLength)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='shrink-0 border-t border-neutral-200 dark:border-neutral-800 px-6 py-4 flex items-center justify-between'>
          <span className='text-sm text-neutral-500 dark:text-neutral-400'>
            {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''}
          </span>
          <Button variant='outline2' size='medium' onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
