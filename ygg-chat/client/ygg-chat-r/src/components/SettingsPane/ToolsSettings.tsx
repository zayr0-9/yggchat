import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchCustomTools, fetchTools, updateToolEnabled } from '../../features/chats/chatActions'
// import { selectTools } from '../../features/chats/chatSelectors'
import { getAllTools } from '../../features/chats/toolDefinitions'
import { useAppDispatch } from '../../hooks/redux'
import { localApi } from '../../utils/api'

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
      localApi
        .get<{ success?: boolean; directory?: string }>('/custom-tools/directory')
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
      const data = await localApi.post<{ success?: boolean }>('/custom-tools/reload')

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
    <div className='space-y-4 sm:space-y-6 lg:space-y-10 pb-16'>
      {/* Valkyrie Master Toggle */}
      <div
        className={`bg-gradient-to-br ${
          valkyrieActive
            ? 'bg-neutral-100 dark:bg-neutral-800 border-neutral-300 dark:border-white/10'
            : 'bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-white/5'
        } rounded-xl sm:rounded-2xl lg:rounded-3xl p-3 px-4 sm:p-2 sm:px-4 lg:p-3 lg:px-6 border transition-all duration-300`}
      >
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0'>
            <h2
              className={`text-sm sm:text-base lg:text-lg font-medium flex items-center gap-1.5 sm:gap-2 lg:gap-2.5 flex-wrap ${
                valkyrieActive ? 'text-neutral-800 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-500'
              }`}
            >
              Valkyrie Engine
              {/* <span className='font-mono text-[8px] sm:text-[9px] lg:text-[10px] bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 sm:px-2 py-0.5 rounded border border-blue-200 dark:border-blue-500/20'>
                v3.4.0
              </span> */}
            </h2>
            <p
              className={`text-[11px] sm:text-xs lg:text-[13px] mt-0.5 sm:mt-1 ${
                valkyrieActive ? 'text-neutral-500 dark:text-neutral-500' : 'text-neutral-400 dark:text-neutral-600'
              }`}
            >
              {valkyrieActive ? 'Core AI tool coordination systems are online.' : 'AI tools are disabled'}
            </p>
          </div>
          <button
            onClick={handleValkyrieToggle}
            disabled={isUpdatingAny}
            className={`w-9 h-9 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full border flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
              valkyrieActive
                ? 'border-blue-300 dark:border-blue-500/30 text-blue-500 bg-blue-50 dark:bg-blue-500/10 hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]'
                : 'border-neutral-300 dark:border-white/10 text-neutral-400 dark:text-neutral-500 bg-transparent hover:text-blue-500 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/5'
            }`}
          >
            {isUpdatingAny ? (
              <span className='text-xs sm:text-sm'>...</span>
            ) : (
              <svg
                className='w-4 h-4 sm:w-[18px] sm:h-[18px] lg:w-5 lg:h-5'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
                strokeWidth={2}
              >
                <path d='M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10' />
              </svg>
            )}
          </button>
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
            valkyrieActive ? 'opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
          }`}
        >
          <div className='space-y-2 sm:space-y-3 lg:space-y-4'>
            {/* Tool List Header */}
            <div className='flex items-end justify-between'>
              <span className='font-mono border rounded-lg p-1 border-neutral-200 dark:border-white/10 text-[14px] sm:text-[14px] lg:text-[14px] text-neutral-400 dark:text-neutral-600 uppercase tracking-[0.1em] sm:tracking-[0.15em]'>
                Individual Nodes
              </span>
              <div className='flex items-center gap-2 sm:gap-3 lg:gap-4'>
                <button
                  onClick={handleReloadTools}
                  disabled={reloadingTools}
                  className='font-mono  border rounded-lg p-1 border-neutral-200 dark:border-white/10 text-[14px] sm:text-[14px] lg:text-[14px] text-neutral-400 dark:text-neutral-600 uppercase tracking-[0.1em] sm:tracking-[0.15em] hover:text-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer flex items-center gap-1 sm:gap-1.5'
                >
                  {reloadingTools && (
                    <svg
                      className='w-2.5 h-2.5 sm:w-3 sm:h-3 animate-spin'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                    >
                      <path d='M4 12a8 8 0 018-8v4l4-4-4-4v4a8 8 0 100 16 8 8 0 008-8h-4' strokeWidth={2} />
                    </svg>
                  )}
                  {reloadingTools ? 'Reloading' : 'Reload'}
                </button>
                <button
                  onClick={handleOpenCustomToolsFolder}
                  className='font-mono border rounded-lg p-1 border-neutral-200 dark:border-white/10 text-[14px] sm:text-[14px] lg:text-[14px] text-neutral-400 dark:text-neutral-600 uppercase tracking-[0.1em] sm:tracking-[0.15em] hover:text-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer'
                >
                  + Custom Apps
                </button>
              </div>
            </div>

            {/* Custom Tools Help View */}
            {showCustomToolsHelp && (
              <div className='bg-amber-50 dark:bg-neutral-800 border border-amber-200 dark:border-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-5 mb-1 sm:mb-2'>
                <div className='flex items-start justify-between mb-2 sm:mb-3 lg:mb-4'>
                  <h4 className='text-xs sm:text-sm lg:text-[15px] font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1.5 sm:gap-2'>
                    <svg
                      className='w-4 h-4 sm:w-[18px] sm:h-[18px] lg:w-5 lg:h-5'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                      strokeWidth={2}
                    >
                      <path d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' />
                    </svg>
                    Creating Custom Tools
                  </h4>
                  <button
                    onClick={() => setShowCustomToolsHelp(false)}
                    className='text-amber-600 dark:text-neutral-500 hover:text-amber-800 dark:hover:text-neutral-300 transition-colors'
                  >
                    <svg
                      className='w-4 h-4 sm:w-[18px] sm:h-[18px] lg:w-5 lg:h-5'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                      strokeWidth={2}
                    >
                      <path d='M6 18L18 6M6 6l12 12' />
                    </svg>
                  </button>
                </div>

                <div className='text-[11px] sm:text-xs lg:text-sm text-amber-700 dark:text-neutral-400 space-y-2 sm:space-y-3 lg:space-y-4'>
                  <p>Custom tools let you extend the AI's capabilities with your own functionality.</p>

                  <div>
                    <p className='font-medium mb-1 sm:mb-2 text-amber-800 dark:text-neutral-300'>
                      Directory Structure:
                    </p>
                    <code className='block bg-amber-100 dark:bg-neutral-900 rounded-lg sm:rounded-xl px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 lg:py-3 text-[10px] sm:text-[11px] lg:text-xs font-mono text-amber-800 dark:text-neutral-400 border border-amber-200 dark:border-white/5'>
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
                    <p className='font-medium mb-1 sm:mb-2 text-amber-800 dark:text-neutral-300'>definition.json:</p>
                    <code className='block bg-amber-100 dark:bg-neutral-900 rounded-lg sm:rounded-xl px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 lg:py-3 text-[10px] sm:text-[11px] lg:text-xs font-mono whitespace-pre text-amber-800 dark:text-neutral-400 border border-amber-200 dark:border-white/5 overflow-x-auto'>
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
                    <p className='font-medium mb-1 sm:mb-2 text-amber-800 dark:text-neutral-300'>index.js:</p>
                    <code className='block bg-amber-100 dark:bg-neutral-900 rounded-lg sm:rounded-xl px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 lg:py-3 text-[10px] sm:text-[11px] lg:text-xs font-mono whitespace-pre text-amber-800 dark:text-neutral-400 border border-amber-200 dark:border-white/5 overflow-x-auto'>
                      {`export async function execute(args, options) {
  // Your tool logic here
  return { success: true, result: "..." };
}`}
                    </code>
                  </div>

                  <div className='bg-amber-100 dark:bg-neutral-900 rounded-lg sm:rounded-xl px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 lg:py-3 flex items-center gap-2 sm:gap-3 border border-amber-200 dark:border-white/5'>
                    <svg
                      className='w-4 h-4 sm:w-[18px] sm:h-[18px] lg:w-5 lg:h-5 text-amber-600 dark:text-amber-500 flex-shrink-0'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                      strokeWidth={2}
                    >
                      <path d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' />
                    </svg>
                    <span className='font-medium text-amber-800 dark:text-amber-400'>
                      Restart the app after adding or modifying custom tools.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Tool Cards */}
            <div className='space-y-1.5 sm:space-y-4 pb-4 sm:pb-6'>
              {tools.map(tool => (
                <div
                  key={tool.name}
                  onClick={() => handleToggle(tool.name, tool.enabled)}
                  className={`group flex items-center justify-between p-2.5 px-3 sm:p-3 sm:px-4 lg:p-4 lg:px-5 rounded-xl sm:rounded-2xl border cursor-pointer transition-all duration-300 hover:-translate-y-0.5 ${
                    tool.enabled
                      ? 'bg-neutral-100 dark:bg-neutral-800/50 border-neutral-200 dark:border-white/10 hover:bg-neutral-150 dark:hover:bg-neutral-800 hover:border-neutral-300 dark:hover:border-white/15'
                      : 'bg-neutral-50 dark:bg-neutral-900/50 border-neutral-200 dark:border-white/5 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:border-neutral-300 dark:hover:border-white/10'
                  }`}
                >
                  {/* Tool Identity */}
                  <div className='flex items-center gap-2.5 sm:gap-3 lg:gap-5 min-w-0'>
                    {/* Icon Box */}
                    <div
                      className={`w-8 h-8 sm:w-9 sm:h-9 lg:w-11 lg:h-11 rounded-lg sm:rounded-xl border flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
                        tool.enabled
                          ? tool.isCustom
                            ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20 text-orange-500'
                            : 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-500'
                          : tool.isCustom
                            ? 'bg-neutral-100 dark:bg-white/[0.03] border-neutral-200 dark:border-white/10 text-neutral-400 dark:text-neutral-600 group-hover:text-orange-500 group-hover:bg-orange-50 dark:group-hover:bg-orange-500/10 group-hover:border-orange-200 dark:group-hover:border-orange-500/20'
                            : 'bg-neutral-100 dark:bg-white/[0.03] border-neutral-200 dark:border-white/10 text-neutral-400 dark:text-neutral-600 group-hover:text-blue-500 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 group-hover:border-blue-200 dark:group-hover:border-blue-500/20'
                      }`}
                    >
                      <svg
                        className='w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-[18px] lg:h-[18px]'
                        fill='none'
                        viewBox='0 0 24 24'
                        stroke='currentColor'
                        strokeWidth={2}
                      >
                        <path d='M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' />
                      </svg>
                    </div>
                    {/* Tool Meta */}
                    <div className='min-w-0'>
                      <h3 className='text-xs sm:text-[13px] lg:text-[15px] font-medium text-neutral-800 dark:text-neutral-200 truncate'>
                        {tool.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </h3>
                      <p className='text-[10px] sm:text-[11px] lg:text-xs text-neutral-500 dark:text-neutral-500 mt-0 sm:mt-0.5 max-w-[150px] sm:max-w-[250px] lg:max-w-[400px] truncate'>
                        {tool.description}
                      </p>
                    </div>
                  </div>

                  {/* Status Indicator */}
                  <div className='flex items-center gap-2 sm:gap-4 lg:gap-6 flex-shrink-0'>
                    <span className='font-mono text-[8px] sm:text-[9px] lg:text-[10px] text-neutral-400 dark:text-neutral-600 uppercase hidden sm:block'>
                      {tool.isCustom ? 'Custom' : 'Plugin'}
                    </span>
                    <div
                      className={`w-6 h-6 sm:w-7 sm:h-7 lg:w-8 lg:h-8 rounded-full border flex items-center justify-center transition-all duration-200 ${
                        updatingTools.has(tool.name)
                          ? 'border-neutral-300 dark:border-white/10 text-neutral-400'
                          : tool.enabled
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-500'
                            : 'border-neutral-200 dark:border-white/5 text-red-400 opacity-30'
                      }`}
                    >
                      {updatingTools.has(tool.name) ? (
                        <span className='text-[10px] sm:text-xs'>...</span>
                      ) : tool.enabled ? (
                        <svg
                          className='w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-[18px] lg:h-[18px]'
                          fill='none'
                          viewBox='0 0 24 24'
                          stroke='currentColor'
                          strokeWidth={3}
                        >
                          <path d='m5 13 4 4L19 7' />
                        </svg>
                      ) : (
                        <svg
                          className='w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-[18px] lg:h-[18px]'
                          fill='none'
                          viewBox='0 0 24 24'
                          stroke='currentColor'
                          strokeWidth={3}
                        >
                          <path d='M18 6L6 18M6 6l12 12' />
                        </svg>
                      )}
                    </div>
                  </div>
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
            <div className='absolute inset-0 bg-black/50' />
            <div
              className='relative bg-white dark:bg-neutral-900 rounded-xl sm:rounded-2xl lg:rounded-3xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.6)] border border-neutral-200 dark:border-white/10 max-w-md w-full mx-3 sm:mx-4 p-4 sm:p-5 lg:p-6'
              onClick={e => e.stopPropagation()}
            >
              <div className='flex items-center justify-between mb-3 sm:mb-4'>
                <h3 className='text-sm sm:text-base lg:text-lg font-medium text-neutral-800 dark:text-neutral-200'>
                  Desktop App Feature
                </h3>
                <button
                  onClick={() => setShowDesktopModal(false)}
                  className='w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors'
                >
                  <svg
                    className='w-4 h-4 sm:w-5 sm:h-5'
                    fill='none'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                    strokeWidth={2}
                  >
                    <path d='M6 18L18 6M6 6l12 12' />
                  </svg>
                </button>
              </div>
              <div className='text-neutral-600 dark:text-neutral-400 text-xs sm:text-sm space-y-2 sm:space-y-3 mb-4 sm:mb-6'>
                <p>
                  Agent tools and AI capabilities are available exclusively in the{' '}
                  <strong className='text-neutral-800 dark:text-neutral-200'>Yggdrasil Desktop App</strong>.
                </p>
                <p>
                  Download the desktop application to unlock advanced features including agent mode and tool execution.
                </p>
              </div>
              <div className='flex justify-end'>
                <button
                  onClick={() => setShowDesktopModal(false)}
                  className='px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl border border-neutral-300 dark:border-white/10 text-neutral-700 dark:text-neutral-300 text-xs sm:text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors'
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
