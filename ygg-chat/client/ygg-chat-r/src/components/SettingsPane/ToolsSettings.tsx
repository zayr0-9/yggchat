import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchCustomTools, fetchTools, updateToolEnabled } from '../../features/chats/chatActions'
// import { selectTools } from '../../features/chats/chatSelectors'
import { getAllTools } from '../../features/chats/toolDefinitions'
import { useAppDispatch } from '../../hooks/redux'
import { Button } from '../Button/button'

const LOCAL_API_BASE = 'http://127.0.0.1:3002/api'

export const ToolsSettings: React.FC = () => {
  const dispatch = useAppDispatch()
  // Use Redux tools as trigger for re-render, but get actual tools from toolDefinitions
  // This ensures we always see the merged list (built-in + custom)
  // const reduxTools = useAppSelector(selectTools)
  const tools = getAllTools()
  const [updatingTools, setUpdatingTools] = useState<Set<string>>(new Set())
  const [showDesktopModal, setShowDesktopModal] = useState(false)
  const [showCustomToolsHelp, setShowCustomToolsHelp] = useState(false)
  const [customToolsPath, setCustomToolsPath] = useState<string | null>(null)
  const [reloadingTools, setReloadingTools] = useState(false)
  const wslDistro = localStorage.getItem('ygg_wsl_distro') || ''

  const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'

  useEffect(() => {
    localStorage.setItem('ygg_wsl_distro', wslDistro)
  }, [wslDistro])

  useEffect(() => {
    // Tools are now initialized at store creation (store.ts)
    // Only fetch the custom tools directory path for the UI
    if (!isWebMode) {
      fetch(`${LOCAL_API_BASE}/custom-tools/directory`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.directory) {
            setCustomToolsPath(data.directory)
          }
        })
        .catch(err => {
          console.error('[ToolsSettings] Failed to fetch custom tools directory:', err)
        })
    }
  }, [isWebMode])

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
    // Show modal in web mode instead of toggling
    if (isWebMode) {
      setShowDesktopModal(true)
      return
    }

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

  const handleOpenCustomToolsFolder = async () => {
    setShowCustomToolsHelp(true)
    // Also open the folder in the system file explorer
    if (customToolsPath && window.electronAPI?.shell?.openPath) {
      try {
        await window.electronAPI.shell.openPath(customToolsPath)
      } catch (err) {
        console.error('[ToolsSettings] Failed to open custom tools folder:', err)
      }
    }
  }

  const handleReloadTools = async () => {
    setReloadingTools(true)
    try {
      const response = await fetch(`${LOCAL_API_BASE}/custom-tools/reload`, {
        method: 'POST',
      })
      const data = await response.json()

      if (data.success) {
        // Refresh the tools list after reload
        await dispatch(fetchCustomTools())
        await dispatch(fetchTools())
      }
    } catch (err) {
      console.error('[ToolsSettings] Failed to reload tools:', err)
    } finally {
      setReloadingTools(false)
    }
  }

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

      {/* WSL Configuration
      {!isWebMode && (
        <div className='pt-2 px-1'>
          <TextField
            label='WSL Distribution (Optional)'
            placeholder='e.g. Ubuntu-20.04'
            value={wslDistro}
            onChange={setWslDistro}
            helperText='Specify a WSL distribution to run tools within. Leave empty for default behavior.'
          />
        </div>
      )} */}

      {/* Individual Tools - Only show when Valkyrie is active and not in web mode */}
      {!isWebMode && (
        <div
          className={`transition-all duration-500 ease-in-out ${
            valkyrieActive ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className='space-y-4'>
            <div className='flex items-center justify-between mt-3 mb-3'>
              <h3 className='text-md font-medium text-stone-700 dark:text-stone-300'>Individual Tools</h3>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline2'
                  size='small'
                  onClick={handleReloadTools}
                  disabled={reloadingTools}
                  className='flex items-center gap-1.5 text-sm'
                >
                  <i className={`bx bx-refresh text-base ${reloadingTools ? 'animate-spin' : ''}`}></i>
                  {reloadingTools ? 'Reloading...' : 'Reload'}
                </Button>
                <Button
                  variant='outline2'
                  size='small'
                  onClick={handleOpenCustomToolsFolder}
                  className='flex items-center gap-1.5 text-sm'
                >
                  <i className='bx bx-folder-plus text-base'></i>
                  Custom Tools
                </Button>
              </div>
            </div>

            {/* Custom Tools Help View */}
            {showCustomToolsHelp && (
              <div className='bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/50 rounded-lg p-4 mb-4'>
                <div className='flex items-start justify-between mb-3'>
                  <h4 className='font-medium text-orange-800 dark:text-orange-200 flex items-center gap-2'>
                    <i className='bx bx-info-circle text-lg'></i>
                    Creating Custom Tools
                  </h4>
                  <button
                    onClick={() => setShowCustomToolsHelp(false)}
                    className='text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-200'
                  >
                    <i className='bx bx-x text-xl'></i>
                  </button>
                </div>

                <div className='text-sm text-orange-700 dark:text-orange-300 space-y-3'>
                  <p>Custom tools let you extend the AI's capabilities with your own functionality.</p>

                  <div>
                    <p className='font-medium mb-1'>Directory Structure:</p>
                    <code className='block bg-orange-100 dark:bg-orange-900/40 rounded px-2 py-1 text-xs font-mono'>
                      {customToolsPath || 'custom-tools/'}
                      <br />
                      &nbsp;&nbsp;my_tool/
                      <br />
                      &nbsp;&nbsp;&nbsp;&nbsp;definition.json
                      <br />
                      &nbsp;&nbsp;&nbsp;&nbsp;index.js
                    </code>
                  </div>

                  <div>
                    <p className='font-medium mb-1'>definition.json:</p>
                    <code className='block bg-orange-100 dark:bg-orange-900/40 rounded px-2 py-1 text-xs font-mono whitespace-pre'>
                      {`{
  "name": "my_tool",
  "enabled": true,
  "description": "What this tool does",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param1": { "type": "string" }
    },
    "required": ["param1"]
  }
}`}
                    </code>
                  </div>

                  <div>
                    <p className='font-medium mb-1'>index.js:</p>
                    <code className='block bg-orange-100 dark:bg-orange-900/40 rounded px-2 py-1 text-xs font-mono whitespace-pre'>
                      {`export async function execute(args, options) {
  // Your tool logic here
  return { success: true, result: "..." };
}`}
                    </code>
                  </div>

                  <div className='bg-orange-200/50 dark:bg-orange-800/30 rounded px-3 py-2 flex items-center gap-2'>
                    <i className='bx bx-revision text-lg'></i>
                    <span className='font-medium'>Restart the app after adding or modifying custom tools.</span>
                  </div>
                </div>
              </div>
            )}

            <div className='space-y-4 px-2 bg-transparent pb-6'>
              {tools.map(tool => (
                <div
                  key={tool.name}
                  className={`flex items-center justify-between p-3 rounded-lg border-1 drop-shadow-xl shadow-[0_6px_12px_1px_rgba(0,0,0,0.05),0_0px_2px_1px_rgba(0,0,0,0.02)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)] ${
                    tool.isCustom
                      ? 'border-orange-400 dark:border-orange-600/70'
                      : 'border-gray-300 dark:border-neutral-600'
                  }`}
                >
                  <div className='flex-1'>
                    <div className='font-medium text-stone-800 dark:text-stone-200 flex items-center gap-2'>
                      {tool.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      {tool.isCustom && (
                        <span className='text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300'>
                          Custom
                        </span>
                      )}
                    </div>
                    <div className='text-sm text-gray-600 dark:text-gray-400 mt-1'>{tool.description}</div>
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
      )}

      {/* Desktop App Feature Modal */}
      {showDesktopModal &&
        createPortal(
          <div
            className='fixed inset-0 z-[200] flex items-center justify-center'
            onClick={() => setShowDesktopModal(false)}
          >
            <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' />
            <div
              className='relative bg-white dark:bg-yBlack-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6'
              onClick={e => e.stopPropagation()}
            >
              <div className='flex items-center justify-between mb-4'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>Desktop App Feature</h3>
                <button
                  onClick={() => setShowDesktopModal(false)}
                  className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
                >
                  <i className='bx bx-x text-2xl'></i>
                </button>
              </div>
              <div className='text-gray-600 dark:text-gray-300 mb-6'>
                <p className='mb-3'>
                  Agent tools and AI capabilities are available exclusively in the{' '}
                  <strong>Yggdrasil Desktop App</strong>.
                </p>
                <p>
                  Download the desktop application to unlock advanced features including agent mode and tool execution.
                </p>
              </div>
              <div className='flex justify-end'>
                <Button variant='outline2' size='medium' onClick={() => setShowDesktopModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
