import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../Button/button'

interface FreeGenerationsModalProps {
  isOpen: boolean
  onClose: () => void
}

export const FreeGenerationsModal: React.FC<FreeGenerationsModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate()

  if (!isOpen) return null

  const handleUpgrade = () => {
    onClose()
    navigate('/payment')
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200'>
      <div className='bg-white dark:bg-yBlack-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 p-6 max-w-md w-full mx-4 animate-in slide-in-from-bottom-4 duration-300'>
        <div className='flex flex-col items-center text-center'>
          {/* Icon */}
          <div className='flex-shrink-0 p-4 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 mb-4'>
            <i className='bx bx-gift text-4xl'></i>
          </div>

          {/* Title */}
          <h2 className='text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2'>Free Generations Used</h2>

          {/* Description */}
          <p className='text-neutral-600 dark:text-neutral-400 mb-6'>
            You've used all of your 50 free generations! Upgrade now to continue using Yggdrasil with unlimited access
            to all models and features.
          </p>

          {/* Benefits */}
          <div className='w-full bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-4 mb-12 text-left'>
            <h3 className='text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3'>
              With a subscription you get:
            </h3>
            <ul className='space-y-2 text-sm text-neutral-600 dark:text-neutral-400'>
              <li className='flex items-center gap-2'>
                <i className='bx bx-check text-green-500 text-lg'></i>
                <span>More AI generations</span>
              </li>
              <li className='flex items-center gap-2'>
                <i className='bx bx-check text-green-500 text-lg'></i>
                <span>Access to all premium models</span>
              </li>
              <li className='flex items-center gap-2'>
                <i className='bx bx-check text-green-500 text-lg'></i>
                <span>Priority support</span>
              </li>
              <li className='flex items-center gap-2'>
                <i className='bx bx-check text-green-500 text-lg'></i>
                <span>Advanced features</span>
              </li>
            </ul>
          </div>

          {/* Actions */}
          <div className='flex flex-col sm:flex-row items-center gap-2 w-full'>
            <Button
              variant='outline2'
              size='medium'
              onClick={onClose}
              className='w-full sm:w-auto text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700'
            >
              Maybe Later
            </Button>
            <Button variant='outline2' size='medium' onClick={handleUpgrade} className='w-full sm:w-auto  border-0'>
              <i className='bx bx-rocket mr-2'></i>
              View Plans
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
