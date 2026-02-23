import React from 'react'
import { ToolCall } from '../../features/chats/chatTypes'

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
  const formattedArgs = JSON.stringify(toolCall.arguments, null, 2)

  return (
    <div className='mx-1 rounded-[16px] bg-neutral-100/85 py-1 px-1.5 shadow-[0_3px_5px_0px_rgba(0,0,0,0.05)] dark:shadow-[0_7px_12px_0px_rgba(0,0,0,0.25)] backdrop-blur-sm animate-in slide-in-from-bottom-2 fade-in duration-200 dark:border-neutral-700 dark:bg-neutral-900'>
      {/* Header */}
      <div className='flex items-center px-1'>
        <div className='min-w-0 flex flex-1 mb-1 items-center gap-2'>
          <h3 className='text-sm font-mono text-neutral-800 dark:text-neutral-100'>Permission requested</h3>
          <span className='truncate font-mono text-blue-600 dark:text-orange-400'>{toolCall.name}</span>
        </div>

        <div className='rounded-md bg-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'>
          tool
        </div>
      </div>

      {/* Terminal-style command preview */}
      <div className='relative mt-1 overflow-y-auto rounded-lg bg-neutral-100 dark:bg-black px-3 py-2 thin-scrollbar dark:border-neutral-700 sm:max-h-8 md:max-h-10 lg:max-h-18 xl:max-h-28 2xl:max-h-32'>
        <div className='pointer-events-none font-mono absolute right-0 top-2 text-[12px] uppercase tracking-[0.14em] text-neutral-600'>
          COMMAND
        </div>

        <pre className='whitespace-pre-wrap break-all text-[10px] leading-5 text-neutral-300 font-mono'>
          <span className='text-blue-700 dark:text-neutral-300'>{formattedArgs}</span>
        </pre>
      </div>

      {/* Actions */}
      <div className='mt-2 grid grid-cols-3 gap-2 rounded-xl bg-white/[0.02] p-1'>
        <button
          type='button'
          onClick={onDeny}
          className='rounded-lg bg-red-600 dark:bg-red-900/90 px-2.5 py-1.5 text-[11px] font-medium text-neutral-200 transition-colors hover:bg-red-800'
        >
          Deny
        </button>
        <button
          type='button'
          onClick={onGrant}
          className='rounded-lg bg-neutral-200 dark:bg-neutral-300 px-2.5 py-1.5 text-[11px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 dark:bg-neutral-800/90 dark:text-neutral-100 dark:hover:bg-neutral-700'
        >
          Allow Once
        </button>
        <button
          type='button'
          onClick={onAllowAll}
          className='rounded-lg bg-neutral-200 dark:bg-neutral-800/90 px-2.5 py-1.5 text-[11px] font-medium hover:bg-neutral-50 text-blue-800 dark:text-orange-300 transition-colors dark:hover:bg-neutral-700'
        >
          Always Allow
        </button>
      </div>
    </div>
  )
}
