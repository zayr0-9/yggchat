import React from 'react'
import { createPortal } from 'react-dom'
import type { BaseModel } from '../../../../../shared/types'
import { Button } from '../Button/button'

interface ModelInfoModalProps {
  model: BaseModel | null
  isOpen: boolean
  onClose: () => void
}

export const ModelInfoModal: React.FC<ModelInfoModalProps> = ({ model, isOpen, onClose }) => {
  if (!isOpen || !model) return null

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'N/A'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'number') {
      // Format large numbers with commas
      if (Number.isInteger(value)) return value.toLocaleString()
      // Format decimals to 6 places for pricing
      return value.toFixed(6)
    }
    if (Array.isArray(value)) return value.join(', ') || 'N/A'
    return String(value)
  }

  const sections = [
    {
      title: 'Basic Information',
      items: [
        { label: 'ID', value: model.id },
        { label: 'Name', value: model.name },
        { label: 'Display Name', value: model.displayName },
        { label: 'Version', value: model.version },
        { label: 'Description', value: model.description },
      ],
    },
    {
      title: 'Context & Limits',
      items: [
        { label: 'Context Length', value: model.contextLength },
        { label: 'Max Completion Tokens', value: model.maxCompletionTokens },
        { label: 'Input Token Limit', value: model.inputTokenLimit },
        { label: 'Output Token Limit', value: model.outputTokenLimit },
        { label: 'Top Provider Context Length', value: model.topProviderContextLength },
      ],
    },
    {
      title: 'Pricing (per 1M tokens) in USD',
      items: [
        {
          label: 'Prompt Cost',
          value:
            '$' + (model.promptCost * 1000000).toFixed(2) + ' | ' + ' $' + model.promptCost.toFixed(8) + ' / token',
        },
        {
          label: 'Completion Cost',
          value:
            '$' +
            (model.completionCost * 1000000).toFixed(2) +
            ' | ' +
            ' $' +
            model.completionCost.toFixed(8) +
            ' / token',
        },
        {
          label: 'Request Cost',
          value: '$' + model.requestCost * 1000000,
        },
      ],
    },
    {
      title: 'Capabilities',
      items: [
        { label: 'Thinking/Reasoning', value: model.thinking },
        { label: 'Supports Images', value: model.supportsImages },
        { label: 'Supports Web Search', value: model.supportsWebSearch },
        { label: 'Supports Structured Outputs', value: model.supportsStructuredOutputs },
      ],
    },
    {
      title: 'Modalities',
      items: [
        { label: 'Input Modalities', value: model.inputModalities },
        { label: 'Output Modalities', value: model.outputModalities },
      ],
    },
    {
      title: 'Default Parameters',
      items: [
        { label: 'Default Temperature', value: model.defaultTemperature },
        { label: 'Default Top P', value: model.defaultTopP },
        { label: 'Default Frequency Penalty', value: model.defaultFrequencyPenalty },
      ],
    },
  ]

  return createPortal(
    <div
      className='fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        className='bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto thin-scrollbar'
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className='sticky top-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 flex items-center justify-between'>
          <h2 className='text-xl font-semibold text-neutral-900 dark:text-neutral-100'>Model Information</h2>
          <button
            onClick={onClose}
            className='text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors'
            aria-label='Close modal'
          >
            <i className='bx bx-x text-2xl' />
          </button>
        </div>

        {/* Content */}
        <div className='px-6 py-4 space-y-6'>
          {sections.map((section, idx) => (
            <div key={idx}>
              <h3 className='text-sm font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide mb-3'>
                {section.title}
              </h3>
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <tbody>
                    {section.items.map((item, itemIdx) => (
                      <tr
                        key={itemIdx}
                        className='border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors'
                      >
                        <td className='py-2.5 px-3 font-medium text-neutral-600 dark:text-neutral-400 w-1/3'>
                          {item.label}
                        </td>
                        <td className='py-2.5 px-3 text-neutral-900 dark:text-neutral-100 break-words'>
                          {formatValue(item.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className='sticky bottom-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 px-6 py-4 flex justify-end'>
          <Button variant='outline2' size='medium' onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
