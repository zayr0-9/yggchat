import React from 'react'
import type { LocalUserProfile } from '../types'

interface ProfilePickerProps {
  users: LocalUserProfile[]
  selectedUserId: string | null
  onSelect: (userId: string) => void
  disabled?: boolean
}

export const ProfilePicker: React.FC<ProfilePickerProps> = ({ users, selectedUserId, onSelect, disabled = false }) => {
  return (
    <div className='mobile-profile-picker'>
      <label>
        Profile
        <select
          value={selectedUserId || ''}
          onChange={event => onSelect(event.target.value)}
          disabled={disabled || users.length === 0}
        >
          {users.length === 0 ? <option value=''>No local users found</option> : null}
          {users.map(user => (
            <option key={user.id} value={user.id}>
              {user.username || user.id} · {user.conversation_count ?? 0} conv
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
