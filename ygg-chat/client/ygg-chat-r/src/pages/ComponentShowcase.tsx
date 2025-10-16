// src/pages/ComponentShowcase.tsx
import React, { useState } from 'react'
import { Button, TextField } from '../components'

export const ComponentShowcase: React.FC = () => {
  // State to demonstrate controlled components
  const [textValue, setTextValue] = useState('')
  const [emailValue, setEmailValue] = useState('')
  //   const [message, setMessage] = useState('')
  //   const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  //   if (e.key === 'Enter' && !e.shiftKey) {
  //     e.preventDefault()
  //     // Handle send logic here or call your button component
  //   }
  // }

  // Handler for button clicks to show interactivity
  const handleButtonClick = (variant: string) => {
    alert(`You clicked the ${variant} button!`)
  }

  return (
    <div className='min-h-screen bg-gray-50 py-8'>
      <div className='max-w-4xl mx-auto px-4'>
        {/* Page Header */}
        <div className='mb-12 text-center'>
          <h1 className='text-4xl font-bold text-gray-900 mb-4'>Component Showcase</h1>
          <p className='text-lg text-gray-600'>A visual guide to our reusable UI components</p>
        </div>

        {/* Button Section */}
        <section className='mb-16'>
          <div className='bg-white rounded-lg shadow-sm border p-8'>
            <h2 className='text-2xl font-semibold text-gray-900 mb-6'>Button Component</h2>

            {/* Button Variants */}
            <div className='mb-8'>
              <h3 className='text-lg font-medium text-gray-700 mb-4'>Variants</h3>
              <div className='flex flex-wrap gap-4'>
                <Button variant='primary' onClick={() => handleButtonClick('primary')}>
                  Primary Button
                </Button>
                <Button variant='secondary' onClick={() => handleButtonClick('secondary')}>
                  Secondary Button
                </Button>
                <Button variant='outline' onClick={() => handleButtonClick('outline')}>
                  Outline Button
                </Button>
                <Button variant='danger' onClick={() => handleButtonClick('danger')}>
                  Danger Button
                </Button>
              </div>
            </div>

            {/* Button Sizes */}
            <div className='mb-8'>
              <h3 className='text-lg font-medium text-gray-700 mb-4'>Sizes</h3>
              <div className='flex flex-wrap items-center gap-4'>
                <Button size='small'>Small Button</Button>
                <Button size='medium'>Medium Button</Button>
                <Button size='large'>Large Button</Button>
              </div>
            </div>

            {/* Button States */}
            <div>
              <h3 className='text-lg font-medium text-gray-700 mb-4'>States</h3>
              <div className='flex flex-wrap gap-4'>
                <Button>Normal State</Button>
                <Button disabled>Disabled State</Button>
              </div>
            </div>
          </div>
        </section>

        {/* TextField Section */}
        <section className='mb-16'>
          <div className='bg-white rounded-lg shadow-sm border p-8'>
            <h2 className='text-2xl font-semibold text-gray-900 mb-6'>TextField Component</h2>

            {/* Basic Text Fields */}
            <div className='mb-8 space-y-6'>
              <h3 className='text-lg font-medium text-gray-700'>Basic Examples</h3>

              <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
                <TextField label='Name' placeholder='Enter your name' helperText='This is a basic text field' />

                <TextField
                  label='Email'
                  type='email'
                  placeholder='Enter your email'
                  value={emailValue}
                  onChange={setEmailValue}
                  helperText='This is a controlled component'
                />
              </div>
            </div>

            {/* Different Sizes */}
            <div className='mb-8 space-y-4'>
              <h3 className='text-lg font-medium text-gray-700'>Sizes</h3>
              <TextField label='Small Size' size='small' placeholder='Small text field' />
              <TextField label='Medium Size' size='medium' placeholder='Medium text field' />
              <TextField label='Large Size' size='large' placeholder='Large text field' />
            </div>

            {/* Different States */}
            <div className='mb-8 space-y-4'>
              <h3 className='text-lg font-medium text-gray-700'>States</h3>

              <TextField
                label='Required Field'
                placeholder='This field is required'
                required
                helperText='Required fields are marked with an asterisk'
              />

              <TextField
                label='Field with Error'
                placeholder='This field has an error'
                error='This field is required and cannot be empty'
              />

              <TextField
                label='Disabled Field'
                placeholder='This field is disabled'
                disabled
                value='Cannot edit this'
              />
            </div>

            {/* Interactive Demo */}
            <div className='border-t pt-8'>
              <h3 className='text-lg font-medium text-gray-700 mb-4'>Interactive Demo</h3>
              <div className='space-y-4'>
                <TextField
                  label='Type something here'
                  placeholder='Watch the value update below...'
                  value={textValue}
                  onChange={setTextValue}
                />
                <div className='p-4 bg-gray-100 rounded-lg'>
                  <p className='text-sm text-gray-600'>
                    Current value: <span className='font-mono'>{textValue || '(empty)'}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Usage Examples */}
        <section>
          <div className='bg-white rounded-lg shadow-sm border p-8'>
            <h2 className='text-2xl font-semibold text-gray-900 mb-6'>Combined Example</h2>
            <p className='text-gray-600 mb-6'>Here's how the components work together in a realistic form:</p>

            <form className='space-y-6' onSubmit={e => e.preventDefault()}>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
                <TextField label='First Name' placeholder='Enter your first name' required />
                <TextField label='Last Name' placeholder='Enter your last name' required />
              </div>

              <TextField
                label='Email Address'
                type='email'
                placeholder='your.email@example.com'
                required
                helperText="We'll never share your email with anyone else"
              />

              <TextField label='Password' type='password' placeholder='Create a secure password' required />

              <div className='flex gap-4 pt-4'>
                <Button type='submit' variant='primary'>
                  Create Account
                </Button>
                <Button type='button' variant='outline'>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
