import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LocalUserProfile, MobileCustomTool } from '../types'
import { ProfilePicker } from './ProfilePicker'
import { ToolTogglePanel } from './ToolTogglePanel'
import { Badge, Button, Input, Select } from './ui'

interface MobileHeaderProps {
  modelName: string
  statusText: string
  users: LocalUserProfile[]
  selectedUserId: string | null
  onModelChange: (value: string) => void
  onUserSelect: (userId: string) => void
  selectorsDisabled?: boolean
  openAiAuthenticated: boolean
  openAiBusy: boolean
  hasPendingOpenAiFlow: boolean
  onOpenAiLoginStart: () => void
  onOpenAiLoginComplete: () => void
  onOpenAiLogout: () => void
  customTools: MobileCustomTool[]
  customToolBusyNames: string[]
  customToolsLoading: boolean
  onRefreshCustomTools: () => void
  onToggleCustomTool: (toolName: string, enabled: boolean) => void
  activeConversationId: string | null
  conversationCwdInput: string
  onConversationCwdInputChange: (value: string) => void
  onSaveConversationCwd: () => void
  savingConversationCwd: boolean
  onOpenProjectConversationPicker: () => void
  canOpenProjectConversationPicker: boolean
  onOpenBranchTree: () => void
  canOpenBranchTree: boolean
  onOpenPathPicker: () => void
  canOpenPathPicker: boolean
}

const MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.1', 'gpt-5.2', 'gpt-4o']

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  modelName,
  statusText,
  users,
  selectedUserId,
  onModelChange,
  onUserSelect,
  selectorsDisabled = false,
  openAiAuthenticated,
  openAiBusy,
  hasPendingOpenAiFlow,
  onOpenAiLoginStart,
  onOpenAiLoginComplete,
  onOpenAiLogout,
  customTools,
  customToolBusyNames,
  customToolsLoading,
  onRefreshCustomTools,
  onToggleCustomTool,
  activeConversationId,
  conversationCwdInput,
  onConversationCwdInputChange,
  onSaveConversationCwd,
  savingConversationCwd,
  onOpenProjectConversationPicker,
  canOpenProjectConversationPicker,
  onOpenBranchTree,
  canOpenBranchTree,
  onOpenPathPicker,
  canOpenPathPicker,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (!settingsOpen) return

    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = previousBodyOverflow
      window.removeEventListener('keydown', handleEscape)
    }
  }, [settingsOpen])

  const settingsPortal =
    settingsOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className='mobile-settings-portal-root'>
            <button
              type='button'
              aria-label='Close settings panel'
              className='mobile-settings-portal-backdrop'
              onClick={() => setSettingsOpen(false)}
            />

            <section className='mobile-settings-portal' role='dialog' aria-modal='true' aria-label='Chat settings'>
              <header className='mobile-settings-portal-header'>
                <div>
                  <h2>Chat settings</h2>
                  <p>Pick model + profile, then continue chatting.</p>
                </div>
                <Button variant='outline' size='sm' onClick={() => setSettingsOpen(false)}>
                  Done
                </Button>
              </header>

              <div className='mobile-settings-portal-body'>
                <div className='mobile-settings-select-grid'>
                  <label className='mobile-settings-field'>
                    <span>Model</span>
                    <Select
                      value={modelName}
                      onChange={event => onModelChange(event.target.value)}
                      disabled={selectorsDisabled}
                    >
                      {MODEL_OPTIONS.map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </Select>
                  </label>

                  <ProfilePicker
                    users={users}
                    selectedUserId={selectedUserId}
                    onSelect={onUserSelect}
                    disabled={selectorsDisabled}
                    compact
                  />
                </div>

                <div className='mobile-settings-auth-row'>
                  <Badge className={`mobile-auth-pill ${openAiAuthenticated ? 'connected' : 'disconnected'}`} variant='outline'>
                    OpenAI {openAiAuthenticated ? 'connected' : 'not connected'}
                  </Badge>

                  {!openAiAuthenticated ? (
                    <>
                      <Button onClick={onOpenAiLoginStart} disabled={openAiBusy} variant='secondary' size='sm'>
                        Sign in OpenAI
                      </Button>
                      <Button
                        onClick={onOpenAiLoginComplete}
                        disabled={openAiBusy || !hasPendingOpenAiFlow}
                        variant='outline'
                        size='sm'
                      >
                        Complete sign-in
                      </Button>
                    </>
                  ) : (
                    <Button onClick={onOpenAiLogout} disabled={openAiBusy} variant='outline' size='sm'>
                      Sign out OpenAI
                    </Button>
                  )}
                </div>

                <div className='mobile-conversation-cwd mobile-conversation-cwd--in-settings'>
                  <label htmlFor='conversation-cwd-input'>Conversation working directory (cwd)</label>
                  <div className='mobile-conversation-cwd-row'>
                    <Input
                      id='conversation-cwd-input'
                      type='text'
                      value={conversationCwdInput}
                      onChange={event => onConversationCwdInputChange(event.target.value)}
                      placeholder='e.g. D:\\projects\\my-repo'
                      disabled={!activeConversationId || selectorsDisabled || savingConversationCwd}
                    />
                    <Button
                      onClick={onSaveConversationCwd}
                      disabled={!activeConversationId || selectorsDisabled || savingConversationCwd}
                      variant='outline'
                      size='sm'
                    >
                      {savingConversationCwd ? 'Saving…' : 'Save cwd'}
                    </Button>
                  </div>
                  <span className='mobile-conversation-cwd-hint'>
                    Used as tool execution root for this conversation. Leave empty to fall back to project cwd.
                  </span>
                </div>

                <div className='mobile-settings-tools-wrap'>
                  <ToolTogglePanel
                    tools={customTools}
                    busyToolNames={customToolBusyNames}
                    loading={customToolsLoading}
                    disabled={selectorsDisabled}
                    onRefresh={onRefreshCustomTools}
                    onToggleTool={onToggleCustomTool}
                  />
                </div>
              </div>
            </section>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <header className='mobile-header'>
        <div className='mobile-header-top'>
          <div className='mobile-header-brand'>
            <h1>Yggdrasil</h1>
            <p className='mobile-status'>
              <span className='mobile-status-dot' aria-hidden='true' />
              {statusText}
            </p>
          </div>

          <div className='mobile-header-actions'>
            <Button
              variant='ghost'
              size='sm'
              className='mobile-header-icon-button'
              onClick={onOpenBranchTree}
              disabled={!canOpenBranchTree}
              aria-label='Open branch tree'
              title='Open branch tree'
            >
              ⎇
            </Button>
            <Button
              variant='ghost'
              size='sm'
              className='mobile-header-icon-button'
              onClick={onOpenProjectConversationPicker}
              disabled={!canOpenProjectConversationPicker}
              aria-label='Switch project or conversation'
              title='Switch project or conversation'
            >
              ☰
            </Button>
            <Button
              variant='ghost'
              size='sm'
              className='mobile-header-icon-button'
              onClick={() => setSettingsOpen(true)}
              aria-haspopup='dialog'
              aria-expanded={settingsOpen}
              aria-label='Open chat settings'
              title='Open chat settings'
            >
              ⚙
            </Button>
          </div>
        </div>

        <div className='mobile-header-summary mobile-header-summary--compact'>
          <div className='mobile-header-summary-item'>
            <span>Model</span>
            <strong>{modelName}</strong>
            <Button
              variant='ghost'
              size='sm'
              className='mobile-header-path-button'
              onClick={onOpenPathPicker}
              disabled={!canOpenPathPicker}
              title={canOpenPathPicker ? 'Browse files/folders and insert path' : 'Set conversation/project cwd first'}
              aria-label='Open file path picker'
            >
              ＋
            </Button>
          </div>
        </div>
      </header>

      {settingsPortal}
    </>
  )
}
