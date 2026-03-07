import React from 'react'

interface MobileHeaderProps {
  modelName: string
  statusText: string
  onModelChange: (value: string) => void
  openAiAuthenticated: boolean
  openAiBusy: boolean
  hasPendingOpenAiFlow: boolean
  onOpenAiLoginStart: () => void
  onOpenAiLoginComplete: () => void
  onOpenAiLogout: () => void
}

const MODEL_OPTIONS = ['gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.1', 'gpt-5.2', 'gpt-4o']

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  modelName,
  statusText,
  onModelChange,
  openAiAuthenticated,
  openAiBusy,
  hasPendingOpenAiFlow,
  onOpenAiLoginStart,
  onOpenAiLoginComplete,
  onOpenAiLogout,
}) => {
  return (
    <header className='mobile-header'>
      <h1>YGG Mobile LAN Chat</h1>
      <p className='mobile-status'>{statusText}</p>
      <div className='mobile-controls'>
        <label>
          Model
          <select value={modelName} onChange={event => onModelChange(event.target.value)}>
            {MODEL_OPTIONS.map(model => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>

        <div className='mobile-auth-row'>
          <span className={`mobile-auth-pill ${openAiAuthenticated ? 'connected' : 'disconnected'}`}>
            OpenAI {openAiAuthenticated ? 'connected' : 'not connected'}
          </span>

          {!openAiAuthenticated ? (
            <>
              <button type='button' onClick={onOpenAiLoginStart} disabled={openAiBusy}>
                Sign in OpenAI
              </button>
              <button type='button' onClick={onOpenAiLoginComplete} disabled={openAiBusy || !hasPendingOpenAiFlow}>
                Complete sign-in
              </button>
            </>
          ) : (
            <button type='button' onClick={onOpenAiLogout} disabled={openAiBusy}>
              Sign out OpenAI
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
