import React from 'react'
import { ToolCall } from '../../features/chats/chatTypes'
import { Button } from '../Button/button'

interface ToolPermissionDialogProps {
  toolCall: ToolCall
  onGrant: () => void
  onDeny: () => void
  onAllowAll: () => void
}

export const ToolPermissionDialog: React.FC<ToolPermissionDialogProps> = ({
  toolCall,
  onGrant,
  onDeny,
  onAllowAll,
}) => {
  return (
    <div className='absolute bottom-[100%] left-0 right-0 mx-4 mt-1 mb-2 z-30'>
      <div className='bg-white dark:bg-neutral-900 rounded-xl shadow-lg border border-neutral-200 dark:border-neutral-700 p-4 animate-in slide-in-from-bottom-2 fade-in duration-200'>
        <div className='flex items-start gap-4'>
          <div className='flex-shrink-0 p-2 rounded-lg bg-amber-100 thin-scrollbar dark:bg-neutral-900/30 text-amber-600 dark:text-amber-400 shadow-[0px_2px_7px_2.5px_rgba(0,0,0,0.10)] dark:shadow-[0px_0px_16px_-2px_rgba(0,0,0,0.45)]'>
            <i className='bx bx-shield-quarter text-xl'></i>
          </div>

          <div className='flex-1 min-w-0'>
            <h3 className='font-medium text-neutral-900 dark:text-neutral-100'>Permission Required</h3>
            <p className='text-sm text-neutral-600 dark:text-neutral-400 mt-1'>
              Valkyrie wants to execute
              <span className='font-mono text-amber-600 dark:text-blue-500 mx-1'>{toolCall.name}</span>
            </p>

            {/* Arguments Preview */}
            <div className='mt-3 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-700/50 p-2 max-h-32 overflow-y-auto thin-scrollbar'>
              <pre className='text-xs font-mono text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap break-all'>
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>

            <div className='flex items-center gap-3 mt-4 justify-end'>
              <Button
                variant='outline2'
                size='small'
                onClick={onDeny}
                className='text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/50'
              >
                Deny
              </Button>
              <Button
                variant='outline'
                size='small'
                onClick={onGrant}
                className='text-neutral-600 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700/50'
              >
                Allow Execution
              </Button>
              <Button
                variant='outline2'
                size='small'
                onClick={onAllowAll}
                className='text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 border-amber-300 dark:border-amber-900/50'
              >
                <i className='bx bx-shield-quarter mr-1'></i>
                Allow All
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
