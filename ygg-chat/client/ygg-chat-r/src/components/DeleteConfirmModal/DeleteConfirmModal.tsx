import React from 'react'
import { Button } from '../Button/button'

interface DeleteConfirmModalProps {
  isOpen: boolean
  title?: string
  description?: string
  dontAskAgain?: boolean
  showDontAskAgain?: boolean
  dontAskAgainLabel?: string
  confirmLabel?: string
  cancelLabel?: string
  onDontAskAgainChange?: (checked: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  title = 'Delete message?',
  description = 'This action cannot be undone.',
  dontAskAgain = false,
  showDontAskAgain = true,
  dontAskAgainLabel = "Don't ask again this session",
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onDontAskAgainChange,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/50' onClick={onCancel}>
      <div
        className='bg-white dark:bg-yBlack-900 rounded-lg shadow-xl p-6 w-[90%] max-w-sm'
        onClick={e => e.stopPropagation()}
      >
        <h3 className='text-[20px] font-semibold mb-6 text-neutral-900 dark:text-neutral-100'>{title}</h3>
        <p className='text-[14px] text-neutral-700 dark:text-neutral-300 mb-4'>{description}</p>

        {showDontAskAgain && onDontAskAgainChange && (
          <label className='flex items-center gap-2 mb-4 text-sm text-neutral-700 dark:text-neutral-300'>
            <input type='checkbox' checked={dontAskAgain} onChange={e => onDontAskAgainChange(e.target.checked)} />
            {dontAskAgainLabel}
          </label>
        )}

        <div className='flex justify-end gap-2 mt-8'>
          <Button variant='outline2' onClick={onCancel} className='active:scale-90'>
            {cancelLabel}
          </Button>
          <Button
            variant='outline2'
            className='bg-red-600 hover:bg-red-700 border-red-700 text-white active:scale-90'
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
