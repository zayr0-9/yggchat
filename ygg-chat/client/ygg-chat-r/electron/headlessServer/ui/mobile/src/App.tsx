import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mobileApi } from './api'
import { Composer } from './components/Composer'
import { MessageList } from './components/MessageList'
import { MessageTreeDrawer } from './components/MessageTreeDrawer'
import { MobileHeader } from './components/MobileHeader'
import { ProfilePicker } from './components/ProfilePicker'
import { ProjectConversationTree } from './components/ProjectConversationTree'
import { ToolTogglePanel } from './components/ToolTogglePanel'
import { buildRenderItemsForMessage } from './messageParser'
import type {
  HeadlessSseEvent,
  LocalUserProfile,
  MobileConversation,
  MobileCustomTool,
  MobileInferenceTool,
  MobileMessage,
  MobileMessageTreeNode,
  MobileProject,
  ToolCallLike,
  ToolResultLike,
} from './types'

type StreamingState = {
  text: string
  reasoning: string
  toolCallsById: Record<string, ToolCallLike>
  toolOrder: string[]
  toolResults: ToolResultLike[]
}

const createStreamingState = (): StreamingState => ({
  text: '',
  reasoning: '',
  toolCallsById: {},
  toolOrder: [],
  toolResults: [],
})

const projectKey = (projectId: string | null | undefined) => projectId || '__none__'

const normalizeCwd = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const makeStreamingMessage = (state: StreamingState | null): MobileMessage | null => {
  if (!state) return null

  const hasContent =
    state.text.trim().length > 0 ||
    state.reasoning.trim().length > 0 ||
    state.toolOrder.length > 0 ||
    state.toolResults.length > 0

  if (!hasContent) return null

  let index = 0
  const contentBlocks: any[] = []

  if (state.reasoning.trim()) {
    contentBlocks.push({ type: 'thinking', index: index++, content: state.reasoning })
  }

  if (state.text.trim()) {
    contentBlocks.push({ type: 'text', index: index++, content: state.text })
  }

  state.toolOrder.forEach(toolId => {
    const toolCall = state.toolCallsById[toolId]
    if (!toolCall) return

    contentBlocks.push({
      type: 'tool_use',
      index: index++,
      id: toolId,
      name: toolCall.name || 'tool',
      input: toolCall.arguments || {},
    })

    state.toolResults
      .filter(result => result.tool_use_id === toolId)
      .forEach(result => {
        contentBlocks.push({
          type: 'tool_result',
          index: index++,
          tool_use_id: toolId,
          content: result.content,
          is_error: Boolean(result.is_error),
        })
      })
  })

  return {
    id: 'streaming-assistant',
    role: 'assistant',
    content: state.text,
    content_blocks: contentBlocks,
  }
}

const parseChildrenIds = (value: MobileMessage['children_ids']): string[] => {
  if (Array.isArray(value)) return value.map(item => String(item))
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(item => String(item)) : []
    } catch {
      return []
    }
  }
  return []
}

const compareMessageIdStrings = (left: string, right: string): number => {
  const leftNum = Number(left)
  const rightNum = Number(right)

  const leftIsNumeric = Number.isFinite(leftNum)
  const rightIsNumeric = Number.isFinite(rightNum)

  if (leftIsNumeric && rightIsNumeric) return leftNum - rightNum
  return left.localeCompare(right)
}

const resolveLatestLeafMessageId = (items: MobileMessage[]): string | null => {
  if (!items.length) return null

  const leafCandidates = items.filter(message => parseChildrenIds(message.children_ids).length === 0)
  const candidates = leafCandidates.length > 0 ? leafCandidates : items

  const sorted = [...candidates].sort((a, b) => {
    const aTs = a.created_at ? new Date(a.created_at).getTime() : 0
    const bTs = b.created_at ? new Date(b.created_at).getTime() : 0
    return aTs - bTs
  })

  const selected = sorted[sorted.length - 1]
  return selected ? String(selected.id) : null
}

const buildPathToMessageId = (
  items: MobileMessage[],
  targetMessageId: string | null | undefined,
  preferredPathIds: string[] = []
): string[] => {
  if (!targetMessageId) return []

  const byId = new Map(items.map(message => [String(message.id), message]))
  const parentToChildren = new Map<string, string[]>()

  items.forEach(message => {
    const parentId = message.parent_id ? String(message.parent_id) : null
    if (!parentId) return

    const childId = String(message.id)
    const children = parentToChildren.get(parentId)
    if (children) {
      children.push(childId)
    } else {
      parentToChildren.set(parentId, [childId])
    }
  })

  parentToChildren.forEach(children => children.sort(compareMessageIdStrings))

  const path: string[] = []
  const visited = new Set<string>()
  let cursorId: string | null = String(targetMessageId)

  while (cursorId && !visited.has(cursorId)) {
    visited.add(cursorId)
    const message = byId.get(cursorId)
    if (!message) break

    path.push(String(message.id))
    cursorId = message.parent_id ? String(message.parent_id) : null
  }

  path.reverse()

  if (!path.length) return []

  const visitedDesc = new Set(path)
  const preferredSet = new Set(preferredPathIds.map(id => String(id)))
  let descCursor = path[path.length - 1]

  while (true) {
    const children = parentToChildren.get(descCursor) || []
    if (children.length === 0) break

    const preferredChildId = children.find(childId => preferredSet.has(String(childId)) && !visitedDesc.has(childId))
    const nextChildId = preferredChildId || children.find(childId => !visitedDesc.has(childId))
    if (!nextChildId) break

    path.push(nextChildId)
    visitedDesc.add(nextChildId)
    descCursor = nextChildId
  }

  return path
}

const mapPathToMessages = (items: MobileMessage[], pathIds: string[]): MobileMessage[] => {
  if (!pathIds.length) return []
  const byId = new Map(items.map(message => [String(message.id), message]))
  return pathIds
    .map(id => byId.get(String(id)))
    .filter((message): message is MobileMessage => Boolean(message))
}

const filterEmptyAssistantNodes = (tree: MobileMessageTreeNode | null): MobileMessageTreeNode | null => {
  if (!tree) return null

  const filterNode = (node: MobileMessageTreeNode, isSyntheticRoot: boolean): MobileMessageTreeNode[] => {
    const children = Array.isArray(node.children) ? node.children : []
    const filteredChildren = children.flatMap(child => filterNode(child, false))

    const normalizedNode: MobileMessageTreeNode = {
      ...node,
      children: filteredChildren,
    }

    if (isSyntheticRoot) {
      return [normalizedNode]
    }

    const isEmptyAssistant =
      String(normalizedNode.sender || '').toLowerCase() === 'assistant' &&
      String(normalizedNode.message || '').trim().length === 0

    if (isEmptyAssistant) {
      return filteredChildren
    }

    return [normalizedNode]
  }

  const isSyntheticRoot = String(tree.id) === 'root'
  const filtered = filterNode(tree, isSyntheticRoot)

  if (filtered.length === 0) return null
  if (filtered.length === 1) return filtered[0]

  return {
    id: 'root',
    message: 'Conversation',
    sender: 'assistant',
    children: filtered,
  }
}

export const App: React.FC = () => {
  const [modelName, setModelName] = useState('gpt-5.3-codex')
  const [statusText, setStatusText] = useState('Loading…')

  const [users, setUsers] = useState<LocalUserProfile[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const [projects, setProjects] = useState<MobileProject[]>([])
  const [expandedProjectKeys, setExpandedProjectKeys] = useState<string[]>([])
  const [loadingProjectKeys, setLoadingProjectKeys] = useState<string[]>([])
  const [conversationsByProjectKey, setConversationsByProjectKey] = useState<Record<string, MobileConversation[]>>({})

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [allMessages, setAllMessages] = useState<MobileMessage[]>([])
  const [messages, setMessages] = useState<MobileMessage[]>([])
  const [messageTree, setMessageTree] = useState<MobileMessageTreeNode | null>(null)
  const [currentPathMessageIds, setCurrentPathMessageIds] = useState<string[]>([])
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null)
  const [isTreeDrawerOpen, setIsTreeDrawerOpen] = useState(false)
  const [isProjectsModalOpen, setIsProjectsModalOpen] = useState(false)
  const [hideEmptyAssistantMessages, setHideEmptyAssistantMessages] = useState(true)

  const [draft, setDraft] = useState('')
  const [conversationCwdInput, setConversationCwdInput] = useState('')
  const [savingConversationCwd, setSavingConversationCwd] = useState(false)
  const [branchSourceMessage, setBranchSourceMessage] = useState<MobileMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null)
  const [openAiConnected, setOpenAiConnected] = useState(false)
  const [openAiBusy, setOpenAiBusy] = useState(false)
  const [pendingOpenAiState, setPendingOpenAiState] = useState<string | null>(null)

  const [customTools, setCustomTools] = useState<MobileCustomTool[]>([])
  const [customToolsLoading, setCustomToolsLoading] = useState(false)
  const [customToolBusyNames, setCustomToolBusyNames] = useState<string[]>([])
  const [inferenceTools, setInferenceTools] = useState<MobileInferenceTool[]>([])

  const lastStreamCompleteMessageIdRef = useRef<string | null>(null)
  const currentPathIdsRef = useRef<string[]>([])

  const streamingMessage = useMemo(() => makeStreamingMessage(streamingState), [streamingState])

  const hiddenEmptyAssistantCount = useMemo(
    () =>
      messages.filter(message => message.role === 'assistant' && buildRenderItemsForMessage(message).length === 0).length,
    [messages]
  )

  const displayedMessages = useMemo(() => {
    if (!hideEmptyAssistantMessages) return messages
    return messages.filter(message => !(message.role === 'assistant' && buildRenderItemsForMessage(message).length === 0))
  }, [messages, hideEmptyAssistantMessages])

  const treeForDrawer = useMemo(() => {
    if (!hideEmptyAssistantMessages) return messageTree
    return filterEmptyAssistantNodes(messageTree)
  }, [messageTree, hideEmptyAssistantMessages])

  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null

    for (const bucket of Object.values(conversationsByProjectKey)) {
      const found = bucket.find(conversation => conversation.id === activeConversationId)
      if (found) return found
    }

    return null
  }, [activeConversationId, conversationsByProjectKey])

  const projectById = useMemo(() => {
    const next = new Map<string, MobileProject>()
    projects.forEach(project => {
      next.set(project.id, project)
    })
    return next
  }, [projects])

  const activeProjectCwd = useMemo(() => {
    const conversationCwd = normalizeCwd(activeConversation?.cwd)
    if (conversationCwd) return conversationCwd

    const projectId = activeConversation?.project_id || null
    const projectCwd = projectId ? normalizeCwd(projectById.get(projectId)?.cwd) : null
    if (projectCwd) return projectCwd

    return null
  }, [activeConversation, projectById])

  useEffect(() => {
    const currentConversationCwd = normalizeCwd(activeConversation?.cwd)
    setConversationCwdInput(currentConversationCwd || '')
  }, [activeConversationId, activeConversation?.cwd])

  const loadUsers = async () => {
    const listed = await mobileApi.listUsers()
    setUsers(listed)

    if (listed.length === 0) {
      setSelectedUserId(null)
      return
    }

    setSelectedUserId(current => current || listed[0].id)
  }

  const loadProjects = async (userId: string) => {
    const listed = await mobileApi.listProjects(userId)
    setProjects(listed)
  }

  const loadConversationsForProject = async (userId: string, projectId: string | null) => {
    const key = projectKey(projectId)

    setLoadingProjectKeys(previous => (previous.includes(key) ? previous : [...previous, key]))

    try {
      const listed = await mobileApi.listConversations(userId, projectId)
      setConversationsByProjectKey(previous => ({ ...previous, [key]: listed }))

      setActiveConversationId(current => {
        if (current) return current
        return listed[0]?.id || null
      })
    } finally {
      setLoadingProjectKeys(previous => previous.filter(value => value !== key))
    }
  }

  const toggleProject = async (projectId: string | null) => {
    if (!selectedUserId) return

    const key = projectKey(projectId)
    const willExpand = !expandedProjectKeys.includes(key)

    if (willExpand && !conversationsByProjectKey[key]) {
      try {
        await loadConversationsForProject(selectedUserId, projectId)
      } catch (error) {
        setStatusText(error instanceof Error ? error.message : String(error))
      }
    }

    setExpandedProjectKeys(previous =>
      willExpand ? [...previous, key] : previous.filter(value => value !== key)
    )
  }

  const selectPathFromMessageId = useCallback((sourceMessages: MobileMessage[], targetMessageId: string | null) => {
    if (!sourceMessages.length) {
      setCurrentPathMessageIds([])
      setMessages([])
      return
    }

    const pathIds = buildPathToMessageId(sourceMessages, targetMessageId, currentPathIdsRef.current)
    if (!pathIds.length) {
      setCurrentPathMessageIds([])
      setMessages(sourceMessages)
      return
    }

    setCurrentPathMessageIds(pathIds)
    setMessages(mapPathToMessages(sourceMessages, pathIds))
  }, [])

  const selectLatestBranch = useCallback(
    (sourceMessages: MobileMessage[]) => {
      const latestLeafId = resolveLatestLeafMessageId(sourceMessages)
      selectPathFromMessageId(sourceMessages, latestLeafId)
    },
    [selectPathFromMessageId]
  )

  const loadConversationTree = useCallback(
    async (
      conversationId: string,
      options?: {
        preferredMessageId?: string | null
        preserveCurrentPath?: boolean
      }
    ) => {
      const payload = await mobileApi.getConversationMessageTree(conversationId)
      const listed = Array.isArray(payload.messages) ? payload.messages : []

      setAllMessages(listed)
      setMessageTree(payload.tree || null)

      const preferredMessageId = options?.preferredMessageId || null
      const preserveCurrentPath = Boolean(options?.preserveCurrentPath)

      if (preferredMessageId) {
        const found = listed.some(message => String(message.id) === String(preferredMessageId))
        if (found) {
          selectPathFromMessageId(listed, String(preferredMessageId))
          return
        }
      }

      const currentPathIds = currentPathIdsRef.current
      if (preserveCurrentPath && currentPathIds.length > 0) {
        const currentTipId = currentPathIds[currentPathIds.length - 1]
        const found = listed.some(message => String(message.id) === String(currentTipId))
        if (found) {
          selectPathFromMessageId(listed, String(currentTipId))
          return
        }
      }

      selectLatestBranch(listed)
    },
    [selectLatestBranch, selectPathFromMessageId]
  )

  const refreshOpenAiStatus = async (userId: string) => {
    try {
      const status = await mobileApi.getOpenAiTokenStatus(userId)
      setOpenAiConnected(Boolean(status.hasToken))
    } catch {
      setOpenAiConnected(false)
    }
  }

  const loadCustomTools = async () => {
    setCustomToolsLoading(true)
    try {
      const listed = await mobileApi.listCustomTools()
      setCustomTools(listed)
    } finally {
      setCustomToolsLoading(false)
    }
  }

  const loadInferenceTools = async () => {
    try {
      const listed = await mobileApi.listInferenceTools()
      setInferenceTools(listed)
    } catch {
      setInferenceTools([])
    }
  }

  const handleToggleCustomTool = async (toolName: string, enabled: boolean) => {
    setCustomToolBusyNames(previous => (previous.includes(toolName) ? previous : [...previous, toolName]))

    try {
      await mobileApi.setCustomToolEnabled(toolName, enabled)
      setCustomTools(previous => previous.map(tool => (tool.name === toolName ? { ...tool, enabled } : tool)))
      await loadInferenceTools()
      setStatusText(`${enabled ? 'Enabled' : 'Disabled'} tool: ${toolName}`)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    } finally {
      setCustomToolBusyNames(previous => previous.filter(value => value !== toolName))
    }
  }

  const handleOpenAiLoginStart = async () => {
    if (!selectedUserId || openAiBusy) {
      if (!selectedUserId) setStatusText('Select a user profile first')
      return
    }

    setOpenAiBusy(true)
    try {
      const flow = await mobileApi.startOpenAiOAuth()
      setPendingOpenAiState(flow.state)
      setStatusText('OpenAI sign-in opened. Complete login in browser, then tap Complete sign-in.')
      window.open(flow.authUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    } finally {
      setOpenAiBusy(false)
    }
  }

  const handleOpenAiLoginComplete = async () => {
    if (!selectedUserId || openAiBusy) {
      if (!selectedUserId) setStatusText('Select a user profile first')
      return
    }
    if (!pendingOpenAiState) {
      setStatusText('Start OpenAI sign-in first')
      return
    }

    setOpenAiBusy(true)
    try {
      const result = await mobileApi.completeOpenAiOAuth(pendingOpenAiState)
      if (result.pending) {
        setStatusText('OAuth still pending. Finish browser sign-in and try Complete sign-in again.')
        return
      }

      if (!result.accessToken || !result.refreshToken || !result.accountId) {
        throw new Error('OAuth completed without required token fields')
      }

      await mobileApi.storeOpenAiToken({
        userId: selectedUserId,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        accountId: result.accountId,
      })

      setPendingOpenAiState(null)
      setOpenAiConnected(true)
      setStatusText('OpenAI connected')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    } finally {
      setOpenAiBusy(false)
    }
  }

  const handleOpenAiLogout = async () => {
    if (!selectedUserId || openAiBusy) {
      if (!selectedUserId) setStatusText('Select a user profile first')
      return
    }

    setOpenAiBusy(true)
    try {
      await mobileApi.clearOpenAiToken(selectedUserId)
      setPendingOpenAiState(null)
      setOpenAiConnected(false)
      setStatusText('OpenAI disconnected')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    } finally {
      setOpenAiBusy(false)
    }
  }

  const handleCreateProject = async () => {
    if (!selectedUserId) return

    const name = window.prompt('Project name', 'Mobile Project')?.trim()
    if (!name) return

    try {
      const created = await mobileApi.createProject({ userId: selectedUserId, name })
      setProjects(previous => [created, ...previous])
      setStatusText(`Created project: ${created.name}`)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    }
  }

  const handleCreateConversation = async (projectId: string | null) => {
    if (!selectedUserId) return

    const title = window.prompt('Conversation title', 'New Conversation')?.trim() || 'New Conversation'
    const projectCwd = projectId ? normalizeCwd(projectById.get(projectId)?.cwd) : null

    try {
      const created = await mobileApi.createConversation({
        userId: selectedUserId,
        projectId,
        title,
        cwd: projectCwd,
      })

      const key = projectKey(projectId)
      setConversationsByProjectKey(previous => {
        const bucket = previous[key] || []
        return {
          ...previous,
          [key]: [created, ...bucket],
        }
      })

      setExpandedProjectKeys(previous => (previous.includes(key) ? previous : [...previous, key]))
      setActiveConversationId(created.id)
      setStatusText(`Created conversation: ${created.title}`)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    }
  }

  const handleSaveConversationCwd = async () => {
    if (!activeConversationId) {
      setStatusText('Select or create a conversation first')
      return
    }

    if (savingConversationCwd) return

    const normalizedCwd = normalizeCwd(conversationCwdInput)

    setSavingConversationCwd(true)
    try {
      const updated = await mobileApi.updateConversation(activeConversationId, { cwd: normalizedCwd })

      setConversationsByProjectKey(previous => {
        const next: Record<string, MobileConversation[]> = {}
        Object.entries(previous).forEach(([key, bucket]) => {
          next[key] = bucket.map(conversation => (conversation.id === updated.id ? { ...conversation, ...updated } : conversation))
        })
        return next
      })

      setConversationCwdInput(normalizeCwd(updated.cwd) || '')
      setStatusText(normalizedCwd ? `Saved conversation cwd: ${normalizedCwd}` : 'Cleared conversation cwd')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingConversationCwd(false)
    }
  }

  const handleBranchUserMessage = (message: MobileMessage) => {
    if (message.role !== 'user') return
    setBranchSourceMessage(message)
    setDraft(typeof message.content === 'string' ? message.content : '')
    setStatusText('Branch mode: rewrite the selected prompt, then tap Send Branch')
  }

  const handleCancelBranch = () => {
    setBranchSourceMessage(null)
    setStatusText('Ready')
  }

  const handleDeleteUserMessage = async (message: MobileMessage) => {
    if (sending) return
    if (message.role !== 'user') return

    const confirmed = window.confirm('Delete this message? This may affect branch history.')
    if (!confirmed) return

    try {
      await mobileApi.deleteMessage(message.id)
      if (branchSourceMessage?.id === message.id) {
        setBranchSourceMessage(null)
      }
      if (activeConversationId) {
        await loadConversationTree(activeConversationId, {
          preferredMessageId: message.parent_id ? String(message.parent_id) : null,
          preserveCurrentPath: true,
        })
      }
      setStatusText('Message deleted')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    }
  }

  const handleSelectTreeNode = (messageId: string) => {
    if (!messageId) return
    const exists = allMessages.some(message => String(message.id) === String(messageId))
    if (!exists) return

    const normalizedId = String(messageId)
    selectPathFromMessageId(allMessages, normalizedId)
    setScrollToMessageId(normalizedId)
    setBranchSourceMessage(null)
    setStatusText(`Switched branch at message ${normalizedId.slice(0, 8)}…`)
  }

  useEffect(() => {
    currentPathIdsRef.current = currentPathMessageIds
  }, [currentPathMessageIds])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        setStatusText('Checking capabilities…')
        await mobileApi.getCapabilities()
        if (cancelled) return

        setStatusText('Loading user profiles…')
        await loadUsers()
        if (cancelled) return

        await loadCustomTools()
        if (cancelled) return

        await loadInferenceTools()
        if (cancelled) return

        setStatusText('Ready')
      } catch (error) {
        if (cancelled) return
        setStatusText(error instanceof Error ? error.message : String(error))
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedUserId) {
      setProjects([])
      setInferenceTools([])
      setConversationsByProjectKey({})
      setExpandedProjectKeys([])
      setActiveConversationId(null)
      setAllMessages([])
      setMessages([])
      setMessageTree(null)
      setCurrentPathMessageIds([])
      setScrollToMessageId(null)
      setIsTreeDrawerOpen(false)
      setBranchSourceMessage(null)
      setOpenAiConnected(false)
      setPendingOpenAiState(null)
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        setStatusText('Loading projects…')
        await loadProjects(selectedUserId)
        if (cancelled) return

        await refreshOpenAiStatus(selectedUserId)
        if (cancelled) return

        await loadInferenceTools()
        if (cancelled) return

        setConversationsByProjectKey({})
        setExpandedProjectKeys([])
        setActiveConversationId(null)
        setAllMessages([])
        setMessages([])
        setMessageTree(null)
        setCurrentPathMessageIds([])
        setScrollToMessageId(null)
        setIsTreeDrawerOpen(false)
        setBranchSourceMessage(null)

        await loadConversationsForProject(selectedUserId, null)
        if (cancelled) return
        setExpandedProjectKeys([projectKey(null)])
        setStatusText('Ready')
      } catch (error) {
        if (cancelled) return
        setStatusText(error instanceof Error ? error.message : String(error))
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [selectedUserId])

  useEffect(() => {
    if (activeConversationId) return

    setAllMessages([])
    setMessages([])
    setMessageTree(null)
    setCurrentPathMessageIds([])
    setScrollToMessageId(null)
    setBranchSourceMessage(null)
  }, [activeConversationId])

  useEffect(() => {
    if (!activeConversationId) return

    setIsTreeDrawerOpen(false)
    setScrollToMessageId(null)
    let cancelled = false

    const run = async () => {
      try {
        setStatusText('Loading messages…')
        await loadConversationTree(activeConversationId)
        if (!cancelled) {
          setBranchSourceMessage(null)
          setStatusText('Ready')
        }
      } catch (error) {
        if (!cancelled) {
          setStatusText(error instanceof Error ? error.message : String(error))
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [activeConversationId, loadConversationTree])

  const applyStreamEvent = (event: HeadlessSseEvent) => {
    if (!event || typeof event !== 'object') return

    if (event.type === 'chunk' && event.part === 'text' && typeof event.delta === 'string') {
      setStreamingState(previous => {
        const next = previous || createStreamingState()
        return { ...next, text: `${next.text}${event.delta}` }
      })
      return
    }

    if (event.type === 'chunk' && event.part === 'reasoning' && typeof event.delta === 'string') {
      setStreamingState(previous => {
        const next = previous || createStreamingState()
        return { ...next, reasoning: `${next.reasoning}${event.delta}` }
      })
      return
    }

    if (event.type === 'chunk' && event.part === 'tool_call' && event.toolCall) {
      setStreamingState(previous => {
        const next = previous || createStreamingState()
        const toolId = String(event.toolCall.id || `tool-${next.toolOrder.length}`)
        const toolOrder = next.toolOrder.includes(toolId) ? next.toolOrder : [...next.toolOrder, toolId]

        return {
          ...next,
          toolOrder,
          toolCallsById: {
            ...next.toolCallsById,
            [toolId]: {
              ...event.toolCall,
              id: toolId,
            },
          },
        }
      })
      return
    }

    if (event.type === 'chunk' && event.part === 'tool_result' && event.toolResult) {
      setStreamingState(previous => {
        const next = previous || createStreamingState()
        return {
          ...next,
          toolResults: [...next.toolResults, event.toolResult],
        }
      })
      return
    }

    if (event.type === 'tool_execution') {
      setStatusText(`Tool ${event.toolName}: ${event.status}`)
      return
    }

    if (event.type === 'tool_loop') {
      if (event.status === 'turn_started') {
        setStatusText(`Tool loop turn ${event.turn}/${event.maxTurns} started…`)
      } else if (event.status === 'turn_completed') {
        setStatusText(
          event.continued
            ? `Tool loop turn ${event.turn}/${event.maxTurns} complete, continuing…`
            : `Tool loop turn ${event.turn}/${event.maxTurns} complete`
        )
      } else if (event.status === 'max_turns_reached') {
        setStatusText(`Tool loop reached max turns (${event.maxTurns})`)
      }
      return
    }

    if (event.type === 'complete' && event.message?.id) {
      lastStreamCompleteMessageIdRef.current = String(event.message.id)
      return
    }

    if (event.type === 'error' && typeof event.error === 'string') {
      setStatusText(event.error)
    }
  }

  const handleSend = async () => {
    if (sending) return
    if (!selectedUserId) {
      setStatusText('Select a user profile first')
      return
    }
    if (!activeConversationId) {
      setStatusText('Select or create a conversation first')
      return
    }
    if (!openAiConnected) {
      setStatusText('OpenAI not connected. Use Sign in OpenAI first.')
      return
    }

    const content = draft.trim()
    if (!content) return

    const isBranchSend = Boolean(branchSourceMessage)
    const streamOperation = isBranchSend ? 'edit-branch' : 'send'

    const currentBranchTipId =
      currentPathMessageIds[currentPathMessageIds.length - 1] || resolveLatestLeafMessageId(allMessages)

    const parentId = isBranchSend ? null : currentBranchTipId ?? null

    const optimisticUserMessage: MobileMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content,
      parent_id: isBranchSend ? branchSourceMessage?.parent_id ?? null : parentId,
      created_at: new Date().toISOString(),
    }

    lastStreamCompleteMessageIdRef.current = null
    setSending(true)
    setDraft('')
    setMessages(previous => [...previous, optimisticUserMessage])
    setStreamingState(createStreamingState())
    setStatusText(isBranchSend ? 'Streaming branched response…' : 'Streaming response…')

    try {
      await mobileApi.streamMessage({
        conversationId: activeConversationId,
        userId: selectedUserId,
        modelName,
        content,
        parentId,
        operation: streamOperation,
        messageId: branchSourceMessage?.id,
        cwd: activeProjectCwd,
        rootPath: activeProjectCwd,
        tools: inferenceTools,
        onEvent: applyStreamEvent,
      })

      setStatusText('Syncing messages…')
      await loadConversationTree(activeConversationId, {
        preferredMessageId: lastStreamCompleteMessageIdRef.current,
        preserveCurrentPath: true,
      })
      setBranchSourceMessage(null)
      setStatusText('Ready')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
      setStreamingState(null)
      lastStreamCompleteMessageIdRef.current = null
    }
  }

  const activeBranchTipId = currentPathMessageIds[currentPathMessageIds.length - 1] || null

  return (
    <main className='mobile-app-shell'>
      <MobileHeader
        modelName={modelName}
        statusText={statusText}
        onModelChange={setModelName}
        openAiAuthenticated={openAiConnected}
        openAiBusy={openAiBusy}
        hasPendingOpenAiFlow={Boolean(pendingOpenAiState)}
        onOpenAiLoginStart={handleOpenAiLoginStart}
        onOpenAiLoginComplete={handleOpenAiLoginComplete}
        onOpenAiLogout={handleOpenAiLogout}
      />

      <ProfilePicker users={users} selectedUserId={selectedUserId} onSelect={setSelectedUserId} disabled={sending} />

      <ToolTogglePanel
        tools={customTools}
        busyToolNames={customToolBusyNames}
        loading={customToolsLoading}
        disabled={sending}
        onRefresh={loadCustomTools}
        onToggleTool={handleToggleCustomTool}
      />

      <div className='mobile-project-launcher'>
        <button type='button' onClick={() => setIsProjectsModalOpen(true)} disabled={sending || !selectedUserId}>
          {activeConversation ? 'Switch Project / Conversation' : 'Open Projects'}
        </button>
      </div>

      <div className='mobile-conversation-cwd'>
        <label htmlFor='conversation-cwd-input'>Conversation working directory (cwd)</label>
        <div className='mobile-conversation-cwd-row'>
          <input
            id='conversation-cwd-input'
            type='text'
            value={conversationCwdInput}
            onChange={event => setConversationCwdInput(event.target.value)}
            placeholder='e.g. D:\\projects\\my-repo'
            disabled={!activeConversationId || sending || savingConversationCwd}
          />
          <button
            type='button'
            onClick={handleSaveConversationCwd}
            disabled={!activeConversationId || sending || savingConversationCwd}
          >
            {savingConversationCwd ? 'Saving…' : 'Save cwd'}
          </button>
        </div>
        <span className='mobile-conversation-cwd-hint'>
          Used as tool execution root for this conversation. Leave empty to fall back to project cwd.
        </span>
      </div>

      <ProjectConversationTree
        open={isProjectsModalOpen}
        projects={projects}
        conversationsByProjectKey={conversationsByProjectKey}
        expandedProjectKeys={expandedProjectKeys}
        activeConversationId={activeConversationId}
        loadingProjectKeys={loadingProjectKeys}
        onToggleProject={toggleProject}
        onSelectConversation={conversationId => {
          setActiveConversationId(conversationId)
          setIsProjectsModalOpen(false)
        }}
        onCreateProject={handleCreateProject}
        onCreateConversation={handleCreateConversation}
        onClose={() => setIsProjectsModalOpen(false)}
        disabled={sending || !selectedUserId}
      />

      <div className='mobile-branch-toolbar'>
        <div className='mobile-branch-toolbar-actions'>
          <button
            type='button'
            onClick={() => setIsTreeDrawerOpen(true)}
            disabled={!activeConversationId || sending || allMessages.length === 0}
          >
            Open Branch Tree
          </button>
          <button
            type='button'
            onClick={() => setHideEmptyAssistantMessages(previous => !previous)}
            disabled={!activeConversationId}
          >
            {hideEmptyAssistantMessages ? 'Show Empty AI' : 'Hide Empty AI'}
          </button>
        </div>
        <span>
          {currentPathMessageIds.length > 0
            ? `Branch depth ${currentPathMessageIds.length}${activeBranchTipId ? ` · tip ${String(activeBranchTipId).slice(0, 8)}…` : ''}`
            : allMessages.length > 0
              ? `Messages ${allMessages.length}`
              : 'No messages yet'}
          {hideEmptyAssistantMessages && hiddenEmptyAssistantCount > 0
            ? ` · hidden empty AI ${hiddenEmptyAssistantCount}`
            : ''}
        </span>
      </div>

      <MessageList
        messages={displayedMessages}
        streamingMessage={streamingMessage}
        branchTargetMessageId={branchSourceMessage?.id || null}
        scrollToMessageId={scrollToMessageId}
        onScrollToMessageHandled={() => setScrollToMessageId(null)}
        userActionsDisabled={sending || !activeConversationId || !selectedUserId}
        onBranchUserMessage={handleBranchUserMessage}
        onDeleteUserMessage={handleDeleteUserMessage}
      />

      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={handleSend}
        sending={sending}
        isBranching={Boolean(branchSourceMessage)}
        branchLabel={
          branchSourceMessage
            ? `Branching from message ${branchSourceMessage.id.slice(0, 8)}… (new parent = previous message)`
            : undefined
        }
        onCancelBranch={branchSourceMessage ? handleCancelBranch : undefined}
        disabled={!activeConversationId || !selectedUserId || !openAiConnected}
      />

      <MessageTreeDrawer
        open={isTreeDrawerOpen}
        tree={treeForDrawer}
        activePathIds={currentPathMessageIds}
        activeTipId={activeBranchTipId}
        onSelectMessage={handleSelectTreeNode}
        onClose={() => setIsTreeDrawerOpen(false)}
      />
    </main>
  )
}
