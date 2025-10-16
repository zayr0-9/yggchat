import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, TextField } from '../components'

interface EnvVariable {
  key: string
  value: string
}

const Settings: React.FC = () => {
  const navigate = useNavigate()
  const [envVars, setEnvVars] = useState<EnvVariable[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetchEnvVars()
  }, [])

  const fetchEnvVars = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/settings/env')
      if (!response.ok) {
        throw new Error('Failed to fetch environment variables')
      }
      const data = await response.json()

      // Convert object to array of key-value pairs
      const vars = Object.entries(data).map(([key, value]) => ({
        key,
        value: value as string,
      }))
      setEnvVars(vars)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load environment variables')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      // Convert array back to object, filtering out empty keys
      const envObject = envVars.reduce(
        (acc, { key, value }) => {
          if (key.trim()) {
            acc[key.trim()] = value
          }
          return acc
        },
        {} as Record<string, string>
      )

      const response = await fetch('/api/settings/env', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envObject),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save environment variables')
      }

      setSuccess('Environment variables saved successfully!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save environment variables')
    } finally {
      setSaving(false)
    }
  }

  const handleAddVariable = () => {
    setEnvVars([...envVars, { key: '', value: '' }])
  }

  const handleRemoveVariable = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
  }

  const handleKeyChange = (index: number, key: string) => {
    const updated = [...envVars]
    updated[index].key = key
    setEnvVars(updated)
  }

  const handleValueChange = (index: number, value: string) => {
    const updated = [...envVars]
    updated[index].value = value
    setEnvVars(updated)
  }

  if (loading) {
    return (
      <div className='bg-neutral-100 min-h-screen dark:bg-yBlack-900'>
        <div className='p-6 max-w-4xl mx-auto'>
          <div className='flex items-center justify-center min-h-[200px]'>
            <p className='text-stone-600 dark:text-stone-400'>Loading environment variables...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='bg-neutral-100 min-h-screen dark:bg-yBlack-900'>
      <div className='p-6 max-w-5xl mx-auto'>
        {/* Header */}
        <div className='flex items-center justify-between mb-6 py-4'>
          <h1 className='text-2xl font-semibold text-stone-800 dark:text-stone-200'>Environment Variables</h1>
          <Button variant='secondary' onClick={() => navigate('/')} className='group'>
            <p className='transition-transform duration-100 group-active:scale-95'>Back to Home</p>
          </Button>
        </div>

        <div className='space-y-6'>
          {/* Description */}
          <div className='p-4 rounded-lg border border-blue-200 dark:border-sky-800'>
            <p className='text-sm text-blue-800 dark:text-blue-200'>
              Configure environment variables for your application. Changes require a server restart to take effect.
            </p>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className='p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg'>
              <p className='text-sm text-red-800 dark:text-red-200'>{error}</p>
            </div>
          )}

          {success && (
            <div className='p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg'>
              <p className='text-sm text-green-800 dark:text-green-200'>{success}</p>
            </div>
          )}

          {/* Environment Variables List */}
          <div className='space-y-4'>
            {envVars.map((envVar, index) => (
              <div
                key={index}
                className='flex gap-4 items-start p-4 bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
              >
                <div className='flex-1'>
                  <TextField
                    label='Variable Name'
                    placeholder='VARIABLE_NAME'
                    value={envVar.key}
                    onChange={value => handleKeyChange(index, value)}
                  />
                </div>
                <div className='flex-1'>
                  <TextField
                    label='Value'
                    placeholder='variable_value'
                    value={envVar.value}
                    onChange={value => handleValueChange(index, value)}
                  />
                </div>
                <div className='pt-7'>
                  <Button variant='danger' size='small' onClick={() => handleRemoveVariable(index)} className='group'>
                    <i className='bx bx-trash text-lg group-active:scale-95'></i>
                  </Button>
                </div>
              </div>
            ))}

            {envVars.length === 0 && (
              <div className='text-center py-8 text-stone-500 dark:text-stone-400'>
                No environment variables configured. Click "Add Variable" to get started.
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className='flex gap-4 justify-end'>
            <Button variant='primary' size='large' onClick={handleAddVariable} className='group'>
              <p className='transition-transform duration-100 group-active:scale-95'>Add Variable</p>
            </Button>
            <Button variant='primary' onClick={handleSave} disabled={saving} className='group'>
              {saving ? (
                'Saving...'
              ) : (
                <p className='transition-transform duration-100 group-active:scale-95'>Save Changes</p>
              )}
            </Button>
          </div>

          {/* Warning */}
          <div className='p-4 bg-yellow-50 dark:bg-secondary-600 rounded-lg border border-yellow-200 dark:border-secondary-800'>
            <p className='text-sm text-yellow-800 dark:text-neutral-200'>
              <strong>Warning:</strong> Be careful when editing environment variables. Invalid values may cause the
              application to malfunction. Always backup your .env file before making changes.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings
