// src/components/Button.tsx
import React from 'react'

type ButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children' | 'onClick' | 'type' | 'disabled'
> & {
  className?: string
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'tertiary' | 'outline' | 'danger' | 'outline2'
  size?: 'smaller' | 'small' | 'medium' | 'large' | 'extraLarge' | 'circle'
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  rounded?: 'full' | 'lg' | 'none'
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  rounded = 'lg',
  ...rest
}) => {
  // Base styles that all buttons share
  const baseStyles =
    'inline-flex items-center justify-center gap-1 font-medium leading-none transition-colors duration-200 focus:outline-none'

  // Variant styles define the color scheme
  const variantStyles = {
    primary:
      'bg-indigo-400 text-white hover:bg-indigo-500 dark:bg-yPink-200 dark:hover:bg-yPink-300 focus:ring-1 dark:focus:ring-yPink-300',
    secondary:
      'bg-indigo-300 hover:bg-indigo-400 dark:bg-secondary-500 text-neutral-50 dark:text-white dark:hover:bg-secondary-600 focus:ring-1 dark:focus:ring-secondary-400 dark:focus:secondary-500',
    tertiary:
      'bg-indigo-300 hover:bg-indigo-400 dark:bg-yBlack-900 text-neutral-50 dark:text-white dark:hover:bg-yBlack-500 focus:ring-1 dark:focus:ring-yBlack-500 dark:focus:yBlack-500',
    outline:
      'border-2 border-neutral-400 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800',
    outline2: ' dark:bg-yBlack-900 text-neutral-700 dark:text-neutral-300 hover:bg-stone-200 dark:hover:bg-neutral-700',
    danger:
      'bg-rose-400 dark:bg-yPink-700 dark:border-2 dark:border-yPink-200 text-white dark:hover:bg-yPink-600 hover:bg-rose-500 focus:ring-red-500',
  }

  // Size styles control padding and text size
  const sizeStyles = {
    smaller: 'px-1.5 py-1 text-[12px]',
    small: 'px-3 py-1.5 text-[14px]',
    medium: 'px-3 py-2 text-base',
    large:
      'px-2 py-2 sm:px-1.5 sm:py-2 md:px-1.5 md:py-2 lg:px-2 lg:py-2 xl:px-3 xl:py-3 2xl:px-3 2xl:py-3 3xl:px-4 3xl:py-3 4xl:px-4 4xl:py-4 text-[14px] sm:text-[12px] md:text-[14px] lg:text-[16px] xl:text-[16px] 2xl:text-[16px] 3xl:text-[20px] 4xl:text-[22px]',
    extraLarge: 'px-6 py-6 text-lg',
    circle: 'px-3 py-3 text-lg',
  }

  // Disabled styles override other styles when button is disabled
  const disabledStyles = 'opacity-50 cursor-not-allowed'

  // Combine all styles based on props
  const buttonClasses = `
    ${baseStyles}
    ${variantStyles[variant]}
    ${sizeStyles[size]}
    ${disabled ? disabledStyles : ''}
    ${className}
    ${rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-lg' : 'rounded-none'}
  `.trim()

  return (
    <button type={type} className={`${buttonClasses}`} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  )
}
