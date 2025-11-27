import React from 'react'
import { Button } from '../Button/button'

interface ToolAutoApproveIndicatorProps {
  onDisable: () => void
}

export const ToolAutoApproveIndicator: React.FC<ToolAutoApproveIndicatorProps> = ({ onDisable }) => {
  return (
    <div className='rounded-2xl flex items-center gap-3 py-2 px-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 shadow-sm'>
      <div className='flex items-center gap-2 flex-1'>
        <i className='bx bx-shield-quarter text-amber-600 dark:text-amber-400 text-lg'></i>
        <span className='text-sm font-medium text-amber-800 dark:text-amber-300'>
          Auto-approving tool executions
        </span>
      </div>
      <Button
        variant='outline2'
        size='small'
        onClick={onDisable}
        className='text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 border-amber-300 dark:border-amber-900/50'
        aria-label='Disable auto-approve'
      >
        <i className='bx bx-x text-lg'></i>
      </Button>
    </div>
  )
}
