import React from 'react'
import { Button } from '../Button/button'

interface ToolAutoApproveIndicatorProps {
  onDisable: () => void
}

export const ToolAutoApproveIndicator: React.FC<ToolAutoApproveIndicatorProps> = ({ onDisable }) => {
  return (
    <div className='rounded-2xl flex items-center gap-3 py-2 px-4 bg-neutral-100/40 dark:bg-blue-400/30 border border-neutral-200 dark:border-neutral-700/50 shadow-sm'>
      <div className='flex items-center gap-2 flex-1'>
        <i className='bx bx-shield-quarter text-blue-600 dark:text-blue-400 text-lg'></i>
        <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>Auto-approving tool executions</span>
      </div>
      <Button
        variant='outline2'
        size='small'
        onClick={onDisable}
        className='text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 border-blue-300 dark:border-blue-900/50'
        aria-label='Disable auto-approve'
      >
        <i className='bx bx-x text-lg'></i>
      </Button>
    </div>
  )
}
