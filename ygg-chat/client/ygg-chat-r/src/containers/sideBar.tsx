import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConversationId, Project } from '../../../../shared/types'
import { Button } from '../components'
import SearchList from '../components/SearchList/SearchList'
import { chatSliceActions } from '../features/chats'
import { activeConversationIdSet } from '../features/conversations'
import { searchActions, selectSearchLoading, selectSearchQuery, selectSearchResults } from '../features/search'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { useRecentConversations } from '../hooks/useQueries'

interface SideBarProps {
  limit?: number
  className?: string
  projects?: Project[]
  activeConversationId?: ConversationId | null
}

const SideBar: React.FC<SideBarProps> = ({ limit = 8, className = '', projects = [], activeConversationId = null }) => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  // Fetch recent conversations using React Query (cached for 5 minutes)
  const { data: conversations = [], isLoading: loading, error: queryError } = useRecentConversations(limit)
  const error = queryError ? String(queryError) : null

  // Search functionality
  const searchLoading = useAppSelector(selectSearchLoading)
  const searchResults = useAppSelector(selectSearchResults)
  const searchQuery = useAppSelector(selectSearchQuery)

  // Drawer collapse state with localStorage persistence
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('sidebar:collapsed') : null
      return stored === 'true'
    } catch {
      return false
    }
  })

  // Theme state
  const [themeMode, setThemeMode] = useState<'Light' | 'Dark' | 'System'>(() => {
    if (typeof window === 'undefined') return 'Light'
    const saved = localStorage.getItem('theme')
    return saved === 'dark' ? 'Dark' : saved === 'light' ? 'Light' : saved === 'system' ? 'System' : 'System'
  })

  // Persist collapse state
  useEffect(() => {
    try {
      localStorage.setItem('sidebar:collapsed', String(isCollapsed))
    } catch {}
  }, [isCollapsed])

  // Apply theme immediately when user toggles preference
  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const isDark = themeMode === 'Dark' || (themeMode === 'System' && media.matches)
    document.documentElement.classList.toggle('dark', isDark)
  }, [themeMode])

  // Persist theme preference
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('theme', themeMode === 'Dark' ? 'dark' : themeMode === 'Light' ? 'light' : 'system')
  }, [themeMode])

  const cycleTheme = () => {
    setThemeMode(prev => (prev === 'Light' ? 'Dark' : prev === 'Dark' ? 'System' : 'Light'))
  }

  const handleSelect = (id: ConversationId) => {
    const conversation = conversations.find(c => c.id === id)
    dispatch(chatSliceActions.conversationSet(id))
    dispatch(activeConversationIdSet(id))
    navigate(`/chat/${conversation?.project_id || 'unknown'}/${id}`)
  }

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev)
  }

  const handleSearchChange = (value: string) => {
    dispatch(searchActions.queryChanged(value))
  }

  const handleSearchSubmit = () => {
    if (searchQuery.trim()) {
      dispatch(searchActions.performSearch(searchQuery))
    }
  }

  const handleResultClick = (conversationId: string, messageId: string) => {
    const conversation = conversations.find(c => c.id === conversationId)
    dispatch(chatSliceActions.conversationSet(conversationId))
    navigate(`/chat/${conversation?.project_id || 'unknown'}/${conversationId}#${messageId}`)
  }

  return (
    <aside
      className={`h-screen bg-white dark:bg-yBlack-800 shadow-lg border-r border-neutral-200 dark:border-neutral-700 flex flex-col transition-all duration-300 ease-in-out flex-shrink-0 ${isCollapsed ? 'w-16' : 'w-110'} ${className}`}
      aria-label='Recent conversations'
    >
      {/* Toggle Button */}
      <div className='flex items-center justify-between p-3'>
        {!isCollapsed && (
          <h2 className='text-sm font-semibold text-neutral-700 dark:text-neutral-200 truncate'>Recent Chats</h2>
        )}
        <Button
          variant='outline2'
          size='medium'
          onClick={toggleCollapse}
          className={`${isCollapsed ? 'mx-auto' : ''} transition-transform duration-200`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i
            className={`bx ${isCollapsed ? 'bx-chevron-right' : 'bx-chevron-left'} text-2xl transition-transform duration-200 active:scale-90`}
            aria-hidden='true'
          ></i>
        </Button>
      </div>

      {/* Search Section */}
      {!isCollapsed && (
        <div className='p-2 relative z-50'>
          <SearchList
            value={searchQuery}
            onChange={handleSearchChange}
            onSubmit={handleSearchSubmit}
            results={searchResults}
            loading={searchLoading}
            onResultClick={handleResultClick}
            placeholder='Search messages...'
            dropdownVariant='neutral'
          />
        </div>
      )}

      {/* Conversations List */}
      <div className='flex-1 overflow-y-auto overflow-x-hidden p-2 thin-scrollbar'>
        {loading && (
          <div
            className={`text-xs text-gray-500 dark:text-gray-300 px-2 py-1 ${isCollapsed ? 'text-center' : ''}`}
            title={isCollapsed ? 'Loading...' : undefined}
          >
            {isCollapsed ? '...' : 'Loading...'}
          </div>
        )}
        {error && (
          <div
            className={`text-xs text-red-600 dark:text-red-400 px-2 py-1 ${isCollapsed ? 'text-center' : ''}`}
            role='alert'
            title={isCollapsed ? error : undefined}
          >
            {isCollapsed ? '!' : error}
          </div>
        )}
        {conversations.map(conv => {
          const isActive = activeConversationId === conv.id
          const projectName = conv.project_id ? projects.find(p => p.id === conv.project_id)?.name : undefined

          return (
            <div key={conv.id} className='mb-1.5 group relative'>
              <div
                role='button'
                tabIndex={0}
                onClick={() => handleSelect(conv.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleSelect(conv.id)
                  }
                }}
                className={`w-full text-left rounded-lg transition-all duration-200 cursor-pointer ${
                  isCollapsed
                    ? 'py-2 flex items-center hover:scale-90 justify-center'
                    : 'hover:bg-stone-100 hover:ring-neutral-100 hover:ring-2 dark:hover:ring-neutral-800  dark:hover:ring-0 dark:hover:bg-neutral-800'
                } ${isActive ? 'bg-indigo-100 dark:bg-indigo-900/40 border-l-4 border-indigo-500' : ''}`}
                title={isCollapsed ? conv.title || `Conversation ${conv.id}` : undefined}
              >
                {isCollapsed ? (
                  <Button variant='outline2' size='circle' rounded='full' className='h-10 w-10 text-sm font-semibold'>
                    {conv.title ? conv.title.charAt(0).toUpperCase() : '#'}
                  </Button>
                ) : (
                  <div className='flex flex-col gap-2 py-2 mx-2'>
                    <span className='text-sm font-medium text-neutral-900 dark:text-stone-200 truncate'>
                      {conv.title || `Conversation ${conv.id}`}
                    </span>
                    {projectName && (
                      <span className='text-xs text-neutral-600 dark:text-stone-300 truncate'>
                        Project: {projectName}
                      </span>
                    )}
                    {conv.updated_at && (
                      <span className='text-xs text-neutral-500 dark:text-neutral-400 text-right'>
                        {new Date(conv.updated_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Tooltip for collapsed state */}
              {isCollapsed && (
                <div className='absolute left-full ml-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50'>
                  <div className='bg-neutral-900 dark:bg-neutral-700 text-white dark:text-neutral-100 px-3 py-2 rounded-lg shadow-lg text-sm whitespace-nowrap max-w-xs'>
                    <div className='font-medium'>{conv.title || `Conversation ${conv.id}`}</div>
                    {projectName && <div className='text-xs opacity-80 mt-1'>Project: {projectName}</div>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {conversations.length === 0 && !loading && !error && (
          <div className={`text-xs text-neutral-500 dark:text-neutral-400 px-2 py-1 ${isCollapsed ? 'hidden' : ''}`}>
            No recent conversations
          </div>
        )}
      </div>
      <div className='flex items-center justify-start py-2 px-2'>
        <Button
          variant='outline2'
          size='smaller'
          onClick={cycleTheme}
          rounded='full'
          title={`Theme: ${themeMode} (click to change)`}
          aria-label={`Theme: ${themeMode}`}
          className='group'
        >
          <i
            className={`bx ${themeMode === 'System' ? 'bx-desktop' : themeMode === 'Dark' ? 'bx-moon' : 'bx-sun'} text-3xl p-1 transition-transform duration-100 group-active:scale-90 pointer-events-none`}
            aria-hidden='true'
          ></i>
        </Button>
        {!isCollapsed && <div className='flex flex-4 items-center justify-start text-lg dark:text-stone-300'>{themeMode}</div>}
      </div>
      <div className='flex items-center justify-start py-2 px-2'>
        {/* <div className='flex items-center justify-center gap-2'>
          <div className='flex flex-1 items-center justify-center text-lg dark:text-stone-300'>
            <Button
              variant='outline2'
              size='large'
              rounded='full'
              className='h-12 w-12 text-sm font-semibold'
              onClick={() => navigate('/payment')}
            >
              <i className='bx bx-user-circle text-3xl hover:scale-104 active:scale-95 p-4'></i>
            </Button>
          </div>
          <div className='flex flex-4 items-center justify-start text-lg dark:text-stone-300'>
            {!isCollapsed && <h3> User Name </h3>}
          </div>
        </div> */}
      </div>
    </aside>
  )
}

export default SideBar
