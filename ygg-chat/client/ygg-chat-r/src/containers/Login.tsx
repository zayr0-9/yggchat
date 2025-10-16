import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/')
    }
  }, [user, navigate])

  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    setLoading(true)
    setError(null)

    try {
      if (!supabase) {
        throw new Error('Supabase client not available. Please check your environment configuration.')
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      })
      if (error) throw error
    } catch (error: any) {
      setError(error.message || 'An error occurred')
      setLoading(false)
    }
  }

  const handleLocalMode = () => {
    // TODO: Implement local-only mode logic

    navigate('/homePage')
  }

  return (
    <div className='min-h-screen flex items-center justify-center bg-gray-50 dark:bg-yBlack-900 py-12 px-4 sm:px-6 lg:px-8'>
      <div className='max-w-md w-full space-y-8'>
        <div>
          <h2 className='mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white'>
            Sign in to your account
          </h2>
          <p className='mt-2 text-center text-sm text-gray-600 dark:text-gray-400'>
            Choose your preferred sign-in method
          </p>
        </div>

        {error && (
          <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded'>
            {error}
          </div>
        )}

        <div className='space-y-6 justify-center items-center align-middle'>
          <div className='space-y-8'>
            <Button
              onClick={() => handleOAuthLogin('github')}
              disabled={loading}
              variant='outline2'
              size='large'
              className='w-full inline-flex justify-center items-center'
            >
              <svg className='w-5 h-5' fill='currentColor' viewBox='0 0 24 24'>
                <path
                  fillRule='evenodd'
                  d='M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z'
                  clipRule='evenodd'
                />
              </svg>
              <span className='ml-3'>Continue with GitHub</span>
            </Button>

            <div className='relative'>
              <div className='absolute inset-0 flex items-center'>
                <div className='w-full border-t border-2 border-stone-300 dark:border-stone-500' />
              </div>
              <div className='relative flex justify-center text-sm'>
                <span className='px-1.5 py-1 bg-gray-50 dark:bg-yBlack-900 border-2 dark:text-stone-300 border:stone-700 dark:border-stone-400 rounded-full text-gray-500'>
                  Or
                </span>
              </div>
            </div>

            <Button
              onClick={() => handleOAuthLogin('google')}
              disabled={loading}
              variant='outline2'
              className='w-full inline-flex justify-center items-center'
              size='large'
            >
              <svg className='w-5 h-5' viewBox='0 0 24 24'>
                <path
                  fill='currentColor'
                  d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
                />
                <path
                  fill='currentColor'
                  d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
                />
                <path
                  fill='currentColor'
                  d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
                />
                <path
                  fill='currentColor'
                  d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
                />
              </svg>
              <span className='ml-3'>Continue with Google</span>
            </Button>

            <div className='relative'>
              <div className='absolute inset-0 flex items-center'>
                <div className='w-full border-t border-2 border-stone-300 dark:border-stone-500' />
              </div>
              <div className='relative flex justify-center text-sm'>
                <span className='py-1 px-1.5 bg-gray-50 dark:bg-yBlack-900 border-2 dark:text-stone-300 border:stone-700 dark:border-stone-400 rounded-full text-gray-500'>
                  Or
                </span>
              </div>
            </div>

            <Button
              onClick={handleLocalMode}
              disabled={loading}
              variant='outline2'
              className='w-full inline-flex justify-center items-center'
              size='large'
            >
              <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
                />
              </svg>
              <span className='ml-3'>Continue in Local Mode</span>
            </Button>
          </div>
          <p className='text-xs text-center text-gray-500 dark:text-gray-400 mt-4'>
            Local mode runs entirely on your device without cloud authentication
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login
