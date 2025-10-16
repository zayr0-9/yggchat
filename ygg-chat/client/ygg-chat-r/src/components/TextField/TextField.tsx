// src/components/TextField.tsx
import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import React, { useState } from 'react'

interface TextFieldProps {
  label?: string
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  type?: 'text' | 'email' | 'password' | 'number'
  disabled?: boolean
  error?: string
  helperText?: string
  required?: boolean
  size?: 'small' | 'medium' | 'large'
  className?: string
  showSearchIcon?: boolean
  onSearchClick?: () => void
}

export const TextField: React.FC<TextFieldProps> = ({
  label,
  placeholder,
  value,
  onChange,
  onKeyDown,
  type = 'text',
  disabled = false,
  error,
  helperText,
  required = false,
  size = 'medium',
  className = '',
  showSearchIcon = false,
  onSearchClick,
}) => {
  // We'll use internal state if no value/onChange is provided (uncontrolled component)
  const [internalValue, setInternalValue] = useState('')

  // Determine if this is a controlled or uncontrolled component
  const isControlled = value !== undefined
  const inputValue = isControlled ? value : internalValue

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value

    if (isControlled && onChange) {
      onChange(newValue)
    } else {
      setInternalValue(newValue)
    }
  }

  // Base input styles that apply to all text fields
  const baseInputStyles =
    'w-full px-4 py-3 rounded-xl transition-all duration-200 overflow-hidden bg-neutral-50 dark:bg-neutral-900 bg-gray-800 text-stone-800 dark:text-stone-200 placeholder-neutral-700 dark:placeholder-neutral-200 border-1 border-gray-300 outline-none focus:border-gray-400 dark:border-neutral-600 dark:focus:border-neutral-500'

  // Size variants control padding and text size
  const sizeStyles = {
    small: 'px-3 py-1.5 text-sm',
    medium: 'px-4 py-2 text-base',
    large: 'px-5 py-3 text-lg',
  }

  // State-based styles change based on error state and disabled state
  const stateStyles = error
    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
    : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'

  const disabledStyles = disabled ? 'bg-gray-100 cursor-not-allowed opacity-60' : 'bg-white'

  // Combine all input styles
  const inputClasses = `
    ${baseInputStyles}
    ${sizeStyles[size]}
    ${stateStyles}
    ${disabledStyles}
    ${showSearchIcon ? 'pr-10' : ''}
    ${className}
  `.trim()

  // Label styles with required indicator
  const labelStyles = 'block text-base font-medium text-gray-700 dark:text-gray-300 mb-2'

  return (
    <div className='w-full'>
      {/* Label section - only show if label is provided */}
      {label && (
        <label className={labelStyles}>
          {label}
          {required && <span className='text-red-500 ml-1'>*</span>}
        </label>
      )}

      {/* Input field with optional end adornment */}
      <div className='relative'>
        <input
          type={type}
          value={inputValue}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={inputClasses}
        />
        {showSearchIcon && (
          <button
            type='button'
            onClick={onSearchClick}
            disabled={disabled}
            aria-label='Search'
            className='absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-100 focus:outline-none'
          >
            <i className='bx bx-search text-xl pt-1.5' aria-hidden='true'></i>
          </button>
        )}
      </div>

      {/* Helper text or error message */}
      {error && <p className='mt-1 text-sm text-red-600'>{error}</p>}
      {!error && helperText && <p className='mt-1 text-sm text-gray-500'>{helperText}</p>}
    </div>
  )
}
