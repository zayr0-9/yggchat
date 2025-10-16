import React, { useEffect, useState } from 'react'
import { fetchTools, updateToolEnabled } from '../../features/chats/chatActions'
import { selectTools } from '../../features/chats/chatSelectors'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { Button } from '../Button/button'

export const ToolsSettings: React.FC = () => {
  const dispatch = useAppDispatch()
  const tools = useAppSelector(selectTools)
  const [updatingTools, setUpdatingTools] = useState<Set<string>>(new Set())

  useEffect(() => {
    // Fetch tools when component mounts
    dispatch(fetchTools())
  }, [dispatch])

  const handleToggle = async (toolName: string, currentEnabled: boolean) => {
    setUpdatingTools(prev => new Set(prev).add(toolName))

    try {
      await dispatch(
        updateToolEnabled({
          toolName,
          enabled: !currentEnabled,
        })
      ).unwrap()
    } catch (error) {
      console.error('Failed to update tool:', error)
    } finally {
      setUpdatingTools(prev => {
        const newSet = new Set(prev)
        newSet.delete(toolName)
        return newSet
      })
    }
  }

  const handleValkyrieToggle = async () => {
    const enableAll = !someToolsEnabled // If no tools enabled, enable all; if some/all enabled, disable all
    const toolsToUpdate = tools.filter(tool => tool.enabled !== enableAll)

    // Mark all tools as updating
    setUpdatingTools(new Set(toolsToUpdate.map(tool => tool.name)))

    try {
      // Update all tools in parallel
      await Promise.all(
        toolsToUpdate.map(tool =>
          dispatch(
            updateToolEnabled({
              toolName: tool.name,
              enabled: enableAll,
            })
          ).unwrap()
        )
      )
    } catch (error) {
      console.error('Failed to update tools:', error)
    } finally {
      // Clear all updating states
      setUpdatingTools(new Set())
    }
  }

  const someToolsEnabled = tools.some(tool => tool.enabled)
  const isUpdatingAny = updatingTools.size > 0
  const valkyrieActive = someToolsEnabled

  if (!tools || tools.length === 0) {
    return <div className='text-gray-500 dark:text-gray-400 text-sm'>Loading tools...</div>
  }

  return (
    <div className='space-y-4'>
      {/* Valkyrie Master Toggle */}
      <div
        className={`${
          valkyrieActive
            ? 'bg-gradient-to-r dark:from-gray-700 dark:to-gray-500 border-gray-200 dark:border-gray-500 drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
            : 'bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-700'
        } rounded-lg p-4 border transition-colors`}
      >
        <div className='flex items-center justify-between'>
          <div>
            <h3
              className={`text-lg font-semibold flex items-center ${
                valkyrieActive ? 'text-purple-800 dark:text-neutral-200' : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              Valkyrie
            </h3>
            <p
              className={`text-sm mt-1 ${
                valkyrieActive ? 'text-purple-600 dark:text-neutral-200' : 'text-gray-500 dark:text-gray-500'
              }`}
            >
              {valkyrieActive ? 'AI tools are active' : 'AI tools are disabled'}
            </p>
          </div>
          <Button
            variant={valkyrieActive ? 'outline2' : 'outline2'}
            size='small'
            onClick={handleValkyrieToggle}
            disabled={isUpdatingAny}
            className='min-w-[40px] flex items-center justify-center'
          >
            {isUpdatingAny ? (
              '...'
            ) : (
              <i
                className={`bx bx-power-off text-lg active:scale-95 transition-transform duration-300 ${
                  valkyrieActive ? '' : 'rotate-180'
                }`}
              ></i>
            )}
          </Button>
        </div>
      </div>

      {/* Individual Tools - Only show when Valkyrie is active */}
      <div
        className={`overflow-hidden transition-all duration-500 ease-in-out ${
          valkyrieActive ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className='space-y-4'>
          <h3 className='text-md mt-3 font-medium text-stone-700 dark:text-stone-300 mb-3'>Individual Tools</h3>

          <div className='space-y-4 px-2'>
            {tools.map(tool => (
              <div
                key={tool.name}
                className='flex items-center justify-between p-3 outline-neutral-200 outline-1  dark:bg-neutral-900 rounded-lg border-1 border-gray-300 dark:border-neutral-600 drop-shadow-xl shadow-[0_6px_12px_1px_rgba(0,0,0,0.05),0_0px_2px_1px_rgba(0,0,0,0.02)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)] '
              >
                <div className='flex-1'>
                  <div className='font-medium text-stone-800 dark:text-stone-200'>
                    {tool.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </div>
                  <div className='text-sm text-gray-600 dark:text-gray-400 mt-1'>{tool.tool.description}</div>
                </div>

                <Button
                  variant={tool.enabled ? 'outline2' : 'outline2'}
                  size='medium'
                  onClick={() => handleToggle(tool.name, tool.enabled)}
                  disabled={updatingTools.has(tool.name)}
                  className='ml-4 min-w-[40px] flex items-center justify-center'
                >
                  {updatingTools.has(tool.name) ? (
                    '...'
                  ) : tool.enabled ? (
                    <i className='bx bx-check text-xl active:scale-95'></i>
                  ) : (
                    <i className='bx bx-x text-xl active:scale-95'></i>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
