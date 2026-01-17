import React, { useState } from 'react'
import { VoiceSettings } from './VoiceSettings'

export const VoiceSettingsSection: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className='space-y-2'>
      <button
        type='button'
        onClick={() => setIsOpen(!isOpen)}
        className='flex items-center justify-between w-full text-left'
      >
        <span className='text-md font-medium text-stone-700 dark:text-stone-200'>Voice Input</span>
        <i
          className={`bx bx-chevron-down text-xl text-neutral-500 dark:text-neutral-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className='pt-2'>
          <VoiceSettings />
        </div>
      </div>
    </div>
  )
}
