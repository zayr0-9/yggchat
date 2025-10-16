import { AnimatePresence, motion } from 'framer-motion'
import { Move, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { JSX } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import {
  deleteSelectedNodes,
  fetchMessageTree,
  insertBulkMessages,
  // sendMessage,
  updateMessage,
} from '../../features/chats/chatActions'
import { chatSliceActions } from '../../features/chats/chatSlice'
import { buildBranchPathForMessage } from '../../features/chats/pathUtils'
import { createConversation } from '../../features/conversations/conversationActions'
// import { selectSelectedProject } from '../../features/projects/projectSelectors'
import { Message } from '@/features/chats'
import { ConversationId, MessageId } from '../../../../../shared/types'
import type { RootState } from '../../store/store'
import { parseId } from '../../utils/helpers'
import stripMarkdownToText from '../../utils/markdownStripper'
import { TextArea } from '../TextArea/TextArea'
import { TextField } from '../TextField/TextField'

// Type definitions
interface ChatNode {
  id: string
  message: string
  sender: 'user' | 'assistant'
  children: ChatNode[]
}

interface Position {
  x: number
  y: number
  node: ChatNode
}

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface TreeStats {
  totalNodes: number
  maxDepth: number
  branches: number
}

interface HeimdallProps {
  chatData?: ChatNode | null
  compactMode?: boolean
  loading?: boolean
  error?: string | null
  onNodeSelect?: (nodeId: string, path: string[]) => void
  conversationId?: ConversationId | null
  visibleMessageId?: MessageId | null
}

export const Heimdall: React.FC<HeimdallProps> = ({
  chatData = null,
  compactMode = true,
  loading = false,
  error = null,
  onNodeSelect,
  conversationId,
  visibleMessageId = null,
}) => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const selectedNodes = useSelector((state: RootState) => state.chat.selectedNodes)
  const currentPathIds = useSelector((state: RootState) => state.chat.conversation.currentPath)
  // const selectedProject = useSelector(selectSelectedProject)
  const allMessages = useSelector((state: RootState) => state.chat.conversation.messages)
  // Track total messages to detect a truly empty conversation
  const messagesCount = useSelector((state: RootState) => state.chat.conversation.messages.length)

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<number>(compactMode ? 1 : 1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [selectedNode, setSelectedNode] = useState<ChatNode | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isSelecting, setIsSelecting] = useState<boolean>(false)
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Custom context menu after selection
  const [showContextMenu, setShowContextMenu] = useState<boolean>(false)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  // Note dialog state
  const [showNoteDialog, setShowNoteDialog] = useState<boolean>(false)
  const [noteDialogPos, setNoteDialogPos] = useState<{ x: number; y: number } | null>(null)
  const [noteMessageId, setNoteMessageId] = useState<MessageId | null>(null)
  const [noteText, setNoteText] = useState<string>('')
  // Track dark mode for shadows
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false)

  // Keep a stable inner offset so the whole tree does not shift when nodes are added/removed
  const offsetRef = useRef<{ x: number; y: number } | null>(null)
  // Track which nodes have already been seen to avoid re-playing enter animations
  const seenNodeIdsRef = useRef<Set<string>>(new Set())
  const firstPaintRef = useRef<boolean>(true)
  // Keep last non-null tree to avoid unmount flicker during refreshes
  const lastDataRef = useRef<ChatNode | null>(null)
  // Ensure we only auto-center once per conversation load
  const hasCenteredRef = useRef<boolean>(false)
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false)
  // Refs to avoid stale state in global listeners
  const isDraggingRef = useRef<boolean>(false)
  const isSelectingRef = useRef<boolean>(false)
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  // Ref to record last mouse-up position for context menu anchoring
  const lastMouseUpPosRef = useRef<{ x: number; y: number } | null>(null)
  // Refs for latest zoom and pan to avoid stale closures inside wheel listener
  const zoomRef = useRef<number>(zoom)
  const panRef = useRef<{ x: number; y: number }>(pan)
  // Focused message id from global state and flat messages for search
  const focusedChatMessageId = useSelector((state: RootState) => state.chat.conversation.focusedChatMessageId)
  const flatMessages = useSelector((state: RootState) => state.chat.conversation.messages)
  // Get the current message from Redux state
  const getCurrentMessage = useCallback(
    (messageId: MessageId) => {
      return flatMessages.find(m => m.id === messageId)
    },
    [flatMessages]
  )

  // Maintain a plain-text processed copy of messages for client-side search
  const [plainMessages, setPlainMessages] = useState<any[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = (await stripMarkdownToText(flatMessages as any)) as any
        if (!cancelled) {
          setPlainMessages(Array.isArray(res) ? (res as any[]) : (flatMessages as any[]))
        }
      } catch {
        if (!cancelled) setPlainMessages(flatMessages as any[])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [flatMessages])

  // Detect dark mode changes
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }

    checkDarkMode()

    // Watch for class changes on document.documentElement
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  // Search UI state
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchOpen, setSearchOpen] = useState<boolean>(false)
  const [searchHoverIndex, setSearchHoverIndex] = useState<number>(-1)
  const filteredResults = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase()
    if (!q) return [] as { id: number; content: string }[]
    // Filter by content; show up to 12 results
    const res = (plainMessages as any[])
      .filter(m => {
        const plain = (m?.content_plain_text || m?.plain_text_content || m?.content || '').toLowerCase()
        return typeof plain === 'string' && plain.includes(q)
      })
      .slice(0, 12)
      .map(m => ({ id: m.id, content: m.content, role: m.role }))
    return res
  }, [searchQuery, plainMessages])
  const lastCenteredIdRef = useRef<string | null>(null)
  // Only center when focus comes from the search bar, not other sources
  const searchFocusPendingRef = useRef<boolean>(false)
  // Global text selection suppression while panning (originated in Heimdall)
  const addGlobalNoSelect = () => {
    try {
      document.body.classList.add('ygg-no-select')
    } catch {}
  }

  // Debounced update function for notes
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const debouncedUpdateNote = useCallback(
    (messageId: MessageId, content: string, note: string) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }

      debounceTimeoutRef.current = setTimeout(() => {
        dispatch(updateMessage({ id: messageId, content, note }) as any)
      }, 500) // 500ms debounce
    },
    [dispatch]
  )

  // Handle note dialog
  const handleOpenNoteDialog = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      const messageId = parseId(nodeId)
      if (typeof messageId === 'number' && isNaN(messageId)) return

      const message = getCurrentMessage(messageId)
      if (!message) return

      setNoteMessageId(messageId)
      setNoteText(message.note || '')
      setNoteDialogPos(position)
      setShowNoteDialog(true)
      setShowContextMenu(false)
    },
    [getCurrentMessage]
  )

  const handleCloseNoteDialog = useCallback(() => {
    setShowNoteDialog(false)
    setNoteDialogPos(null)
    setNoteMessageId(null)
    setNoteText('')
  }, [])

  const handleNoteTextChange = useCallback(
    (newNoteText: string) => {
      setNoteText(newNoteText)

      if (noteMessageId !== null) {
        const message = getCurrentMessage(noteMessageId)
        if (message) {
          debouncedUpdateNote(noteMessageId, message.content, newNoteText)
        }
      }
    },
    [noteMessageId, getCurrentMessage, debouncedUpdateNote]
  )

  // Pointer Events with pointer capture for robust drag outside element
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    // Don't start dragging if clicking on a node
    const target = e.target as unknown as SVGElement
    if (target && (target.tagName === 'rect' || target.tagName === 'circle')) {
      return
    }
    try {
      e.preventDefault()
    } catch {}
    // Hide any open custom context menu upon new interaction
    setShowContextMenu(false)
    // Capture pointer so we continue to receive move/up events outside
    try {
      ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
    } catch {}

    if (e.button === 2) {
      const svgRect = svgRef.current?.getBoundingClientRect()
      if (svgRect) {
        const svgX = e.clientX - svgRect.left
        const svgY = e.clientY - svgRect.top
        dispatch(chatSliceActions.nodesSelected([]))
        setIsSelecting(true)
        isSelectingRef.current = true
        setSelectionStart({ x: svgX, y: svgY })
        setSelectionEnd({ x: svgX, y: svgY })
        addGlobalNoSelect()
        // Fallback: also track globally in case pointer capture fails in some browsers
        addGlobalMoveListeners()
        const onEnd = () => {
          removeGlobalNoSelect()
          removeGlobalMoveListeners()
          window.removeEventListener('mouseup', onEnd)
          window.removeEventListener('touchend', onEnd)
          window.removeEventListener('blur', onEnd)
          isSelectingRef.current = false
          isDraggingRef.current = false
        }
        window.addEventListener('mouseup', onEnd)
        window.addEventListener('touchend', onEnd)
        window.addEventListener('blur', onEnd)
      }
    } else if (e.button === 0) {
      setIsDragging(true)
      isDraggingRef.current = true
      const ds = { x: e.clientX - pan.x, y: e.clientY - pan.y }
      dragStartRef.current = ds
      addGlobalNoSelect()
      // Fallback: also track globally in case pointer capture fails in some browsers
      addGlobalMoveListeners()
      const onEnd = () => {
        removeGlobalNoSelect()
        removeGlobalMoveListeners()
        window.removeEventListener('mouseup', onEnd)
        window.removeEventListener('touchend', onEnd)
        window.removeEventListener('blur', onEnd)
        isDraggingRef.current = false
        isSelectingRef.current = false
      }
      window.addEventListener('mouseup', onEnd)
      window.addEventListener('touchend', onEnd)
      window.addEventListener('blur', onEnd)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (isDraggingRef.current) {
      setPan({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y })
    } else if (isSelectingRef.current) {
      const svgRect = svgRef.current?.getBoundingClientRect()
      if (svgRect) {
        const svgX = e.clientX - svgRect.left
        const svgY = e.clientY - svgRect.top
        setSelectionEnd({ x: svgX, y: svgY })
      }
    }
  }

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    try {
      ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
    } catch {}
    // If we were selecting, record mouse-up position to anchor the context menu
    if (isSelectingRef.current) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        lastMouseUpPosRef.current = pos
        setContextMenuPos(pos)
      }
    }
    handleMouseUp()
  }

  const handlePointerCancel = (e: React.PointerEvent<SVGSVGElement>): void => {
    try {
      ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
    } catch {}
    handleMouseUp()
  }
  const removeGlobalNoSelect = () => {
    try {
      document.body.classList.remove('ygg-no-select')
    } catch {}
  }
  // Safety: ensure global side effects are removed if component unmounts mid-drag
  useEffect(() => {
    return () => {
      removeGlobalNoSelect()
      // Also remove any global move listeners just in case a drag was active
      try {
        // removeGlobalMoveListeners is declared below; function hoisting makes this safe
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        removeGlobalMoveListeners()
      } catch {}
      // Clean up debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [])

  // Keep refs in sync with latest state for out-of-react listeners
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  useEffect(() => {
    panRef.current = pan
  }, [pan])

  // When switching conversations, drop any cached tree so a blank/new conversation
  // does not render the previous conversation's tree.
  // useEffect(() => {
  //   console.log('chatData', chatData)
  //   lastDataRef.current = null
  //   seenNodeIdsRef.current.clear()
  //   chatData = null
  //   offsetRef.current = null
  //   hasCenteredRef.current = false
  //   setSelectedNode(null)
  //   setFocusedNodeId(null)
  //   console.log('chatData 2', chatData)
  // }, [conversationId])

  const nodeWidth = 250
  const nodeHeight = 80
  const circleRadius = 20
  const verticalSpacing = compactMode ? 80 : 120
  const horizontalSpacing = compactMode ? 100 : 350

  // Store last non-null data so we can keep rendering while loading
  useEffect(() => {
    if (chatData) lastDataRef.current = chatData
    // console.log('chatData 3', chatData)
  }, [chatData])

  // When the conversation is truly empty (no messages) and we're not loading,
  // clear the cached lastDataRef so the tree renders as empty instead of
  // persisting the last non-null tree.
  useEffect(() => {
    if (!loading && messagesCount === 0 && chatData == null) {
      lastDataRef.current = null
      // Also reset layout/selection state so a future conversation starts fresh
      seenNodeIdsRef.current.clear()
      offsetRef.current = null
      hasCenteredRef.current = false
      setSelectedNode(null)
      setFocusedNodeId(null)
    }
  }, [loading, messagesCount, chatData])

  useEffect(() => {
    if (chatData !== lastDataRef.current) {
      setIsTransitioning(true)

      // Clear the blur after React has time to complete all updates
      const timeoutId = setTimeout(() => {
        setIsTransitioning(false)
      }, 150) // Adjust timing as needed - 150ms is usually enough

      return () => clearTimeout(timeoutId)
    }
  }, [chatData])

  // Use provided data or fallback to last known (prevents flash on refresh). Do NOT show a fake empty node.
  const currentChatData = useMemo(() => chatData ?? lastDataRef.current ?? null, [chatData])

  // Calculate path from root to a specific node
  const getPathToNode = (targetNodeId: string, node?: ChatNode | null, path: string[] = []): string[] | null => {
    const startNode = node ?? currentChatData
    if (!startNode) return null
    const currentPath = [...path, startNode.id]

    if (startNode.id === targetNodeId) {
      return currentPath
    }

    if (startNode.children) {
      for (const child of startNode.children) {
        const result = getPathToNode(targetNodeId, child, currentPath)
        if (result) return result
      }
    }

    return null
  }

  // Get the complete branch path for a selected node
  const getPathWithDescendants = (targetNodeId: string): string[] => {
    const pathToNode = getPathToNode(targetNodeId)
    if (!pathToNode) return []

    // Find the target node in the tree
    const findNode = (nodeId: string, node?: ChatNode | null): ChatNode | null => {
      const start = node ?? currentChatData
      if (!start) return null
      if (start.id === nodeId) return start
      if (start.children) {
        for (const child of start.children) {
          const found = findNode(nodeId, child)
          if (found) return found
        }
      }
      return null
    }

    const targetNode = findNode(targetNodeId)
    if (!targetNode) return pathToNode

    // Find the end of the branch by following the path to the deepest leaf
    const findBranchEnd = (node: ChatNode): ChatNode => {
      // If no children, this is the end
      if (!node.children || node.children.length === 0) {
        return node
      }
      // If single child, continue down the branch
      if (node.children.length === 1) {
        return findBranchEnd(node.children[0])
      }
      // If multiple children, choose the child with the lowest id and continue down
      const sortedChildren = node.children.slice().sort((a, b) => {
        const na = Number(a.id)
        const nb = Number(b.id)
        const aNum = !Number.isNaN(na)
        const bNum = !Number.isNaN(nb)
        if (aNum && bNum) return na - nb
        if (aNum && !bNum) return -1
        if (!aNum && bNum) return 1
        return a.id.localeCompare(b.id)
      })
      return findBranchEnd(sortedChildren[0])
    }

    // Get the end of the current branch
    const branchEnd = findBranchEnd(targetNode)

    // Return the complete path from root to the end of this branch
    const fullBranchPath = getPathToNode(branchEnd.id)
    return fullBranchPath || pathToNode
  }

  // Reset view when data changes
  // useEffect(() => {
  //   if (chatData) {
  //     setZoom(compactMode ? 1 : 0.6)
  //     setPan({ x: 0, y: 0 })
  //     setFocusedNodeId(null)
  //     setSelectedNode(null)
  //   }
  // }, [chatData, compactMode])

  // Calculate tree statistics
  const getTreeStats = (node: ChatNode): TreeStats => {
    let totalNodes = 0
    let maxDepth = 0
    let branches = 0

    const traverse = (n: ChatNode, depth: number = 0): void => {
      totalNodes++
      maxDepth = Math.max(maxDepth, depth)
      if (n.children && n.children.length > 1) branches++
      n.children?.forEach(child => traverse(child, depth + 1))
    }

    traverse(node)
    return { totalNodes, maxDepth, branches }
  }

  const stats = useMemo(
    () => (currentChatData ? getTreeStats(currentChatData) : { totalNodes: 0, maxDepth: 0, branches: 0 }),
    [currentChatData]
  )

  // Calculate tree layout
  const calculateTreeLayout = (node: ChatNode): Record<string, Position> => {
    const positions: Record<string, Position> = {}

    const calculateSubtreeWidth = (node: ChatNode): number => {
      if (!node.children || node.children.length === 0) return 1
      return node.children.reduce((sum, child) => sum + calculateSubtreeWidth(child), 0)
    }

    const layoutNode = (node: ChatNode, x: number, y: number): void => {
      positions[node.id] = { x, y, node }

      if (node.children && node.children.length > 0) {
        const totalWidth = node.children.reduce((sum, child) => sum + calculateSubtreeWidth(child), 0)
        let currentX = x - ((totalWidth - 1) * horizontalSpacing) / 2

        node.children.forEach(child => {
          const childWidth = calculateSubtreeWidth(child)
          const childX = currentX + ((childWidth - 1) * horizontalSpacing) / 2
          layoutNode(child, childX, y + verticalSpacing)
          currentX += childWidth * horizontalSpacing
        })
      }
    }

    layoutNode(node, 0, 0)
    return positions
  }

  // Memoize layout so it only recomputes when inputs actually change (e.g., data or spacings)
  const positions = useMemo(
    () => (currentChatData ? calculateTreeLayout(currentChatData) : {}),
    [currentChatData, horizontalSpacing, verticalSpacing]
  )

  // Memoized set for quick membership checks of nodes on the current conversation path
  const currentPathSet = useMemo(() => new Set(currentPathIds ?? []), [currentPathIds])

  // After each render commit, mark current nodes as seen.
  // On first paint, prime the set and disable initial animations.
  useEffect(() => {
    const ids = Object.keys(positions)
    ids.forEach(id => seenNodeIdsRef.current.add(id))
    if (firstPaintRef.current) {
      firstPaintRef.current = false
    }
  }, [positions])

  // Calculate SVG bounds (memoized)
  const bounds = useMemo(() => {
    const values = Object.values(positions)
    if (values.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    }
    return values.reduce<Bounds>(
      (acc, pos) => {
        const isExpanded = !compactMode || pos.node.id === focusedNodeId
        const halfWidth = isExpanded ? nodeWidth / 2 : circleRadius
        const height = isExpanded ? nodeHeight : circleRadius * 2

        return {
          minX: Math.min(acc.minX, pos.x - halfWidth),
          maxX: Math.max(acc.maxX, pos.x + halfWidth),
          minY: Math.min(acc.minY, pos.y),
          maxY: Math.max(acc.maxY, pos.y + height),
        }
      },
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    )
  }, [positions, compactMode, focusedNodeId])

  // Initialize offsets once (when we have real data) so the tree doesn't jump when nodes change
  useEffect(() => {
    if (!offsetRef.current && chatData) {
      offsetRef.current = { x: -bounds.minX + 50, y: -bounds.minY + 50 }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, chatData])

  const hasPositions = Object.keys(positions).length > 0
  const offsetX = hasPositions ? (offsetRef.current ? offsetRef.current.x : -bounds.minX + 50) : 0
  const offsetY = hasPositions ? (offsetRef.current ? offsetRef.current.y : -bounds.minY + 50) : 0

  // Center the viewport on a specific node id (string) without altering zoom
  const centerOnNode = (targetNodeId: string): void => {
    const pos = positions[targetNodeId]
    if (!pos) return
    const s = zoomRef.current
    const ox = offsetRef.current ? offsetRef.current.x : offsetX
    const oy = offsetRef.current ? offsetRef.current.y : offsetY
    // Measure container size to compute true center
    const w = dimensions.width || containerRef.current?.offsetWidth || 0
    const h = dimensions.height || containerRef.current?.offsetHeight || 0
    const px = w / 2 - (pos.x + ox) * s - w / 2 // simplifies to -(pos.x + ox) * s
    const py = h / 2 - (pos.y + oy) * s - 100 // account for top translate(+, 100)
    setPan({ x: px, y: py })
  }

  // React to focusedChatMessageId changes by centering the corresponding node when present
  useEffect(() => {
    if (!focusedChatMessageId) return
    const idStr = String(focusedChatMessageId)
    if (!positions[idStr]) return
    // Only auto-center if this focus was initiated by the search bar
    if (!searchFocusPendingRef.current) return
    if (lastCenteredIdRef.current === idStr) return
    centerOnNode(idStr)
    lastCenteredIdRef.current = idStr
    searchFocusPendingRef.current = false
  }, [focusedChatMessageId, positions, dimensions.width, dimensions.height, offsetX, offsetY])

  // Center the view on the root node once, after layout and container dimensions are ready
  useEffect(() => {
    // Need real data and container dimensions
    if (!chatData) return
    if (!dimensions.width || !dimensions.height) return
    // Ensure positions are available and we haven't centered yet
    const id = currentChatData?.id
    if (!id) return
    const root = positions[id]
    if (!root) return
    if (hasCenteredRef.current) return

    // Compute a zoom that fits the current tree bounds into the available viewport
    const contentW = Math.max(1, bounds.maxX - bounds.minX + 100) // add some horizontal padding
    const contentH = Math.max(1, bounds.maxY - bounds.minY + 140) // add some vertical padding
    const availW = Math.max(1, dimensions.width - 120)
    const availH = Math.max(1, dimensions.height - 180) // account for top controls/help
    const fitZoom = Math.min(availW / contentW, availH / contentH)
    const preferredMaxInitialZoom = 0.8
    const targetZoom = Math.max(0.1, Math.min(3, Math.min(fitZoom, preferredMaxInitialZoom)))

    setZoom(targetZoom)

    // Center the root node with the computed zoom
    const s = targetZoom
    const centerX = dimensions.width / 2
    const centerY = dimensions.height / 2
    const px = centerX - (root.x + offsetX) * s - centerX
    const py = centerY - (root.y + offsetY) * s - 300
    setPan({ x: px, y: py })
    hasCenteredRef.current = true
  }, [positions, bounds, dimensions.width, dimensions.height, zoom, offsetX, offsetY, chatData, currentChatData?.id])

  useEffect(() => {
    const updateDimensions = (): void => {
      if (containerRef.current) {
        const { offsetWidth, offsetHeight } = containerRef.current
        setDimensions({ width: offsetWidth, height: offsetHeight })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // When compact mode changes, re-fit the view using the updated bounds/layout.
  useEffect(() => {
    // Ensure we have data and measured dimensions before resetting
    if (!currentChatData) return
    if (!dimensions.width || !dimensions.height) return
    if (Object.keys(positions).length === 0) return

    const raf = requestAnimationFrame(() => {
      resetView()
    })
    return () => cancelAnimationFrame(raf)
  }, [compactMode])

  // Prevent body scroll when mouse is over the component
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: globalThis.WheelEvent) => {
      // If the wheel event originates inside an element that should allow native scrolling
      // (e.g., the search dropdown list), do NOT hijack it for zooming.
      const cont = containerRef.current
      if (cont) {
        let el = e.target as Node | null
        while (el && el !== cont) {
          if (el instanceof HTMLElement && el.dataset?.heimdallWheelExempt === 'true') {
            // Let the inner element handle its own scrolling
            return
          }
          el = (el as HTMLElement).parentElement
        }
      }

      // Prevent default scrolling behavior and handle zoom instead
      try {
        e.preventDefault()
      } catch {}
      try {
        e.stopPropagation()
      } catch {}

      // Handle zoom centered at the cursor position
      const svgEl = svgRef.current
      // Normalize delta to pixels across browsers/devices
      const LINE_HEIGHT = 16
      const PAGE_HEIGHT = 800
      const normalizeDeltaPx = (dy: number, mode: number, pageH: number): number => {
        if (mode === 1) return dy * LINE_HEIGHT // lines -> px
        if (mode === 2) return dy * pageH // pages -> px
        return dy // already in px
      }
      if (!svgEl) {
        const deltaYPx = normalizeDeltaPx(e.deltaY, e.deltaMode, PAGE_HEIGHT)
        const scale = Math.exp(-deltaYPx * 0.001) // smooth, device-independent
        setZoom(prev => Math.max(0.1, Math.min(3, prev * scale)))
        return
      }

      const rect = svgEl.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top

      const currentZoom = zoomRef.current
      // Normalize deltaY using actual pixel-equivalent distance, then map via exponential scale
      const deltaYPx = normalizeDeltaPx(e.deltaY, e.deltaMode, rect.height)
      const scale = Math.exp(-deltaYPx * 0.001) // smaller factor => less sensitive
      const newZoom = Math.max(0.1, Math.min(3, currentZoom * scale))

      // No change
      if (newZoom === currentZoom) return

      const currentPan = panRef.current

      // Outer group transform components (derive width from current SVG rect to avoid stale dimensions)
      const tx = currentPan.x + rect.width / 2
      const ty = currentPan.y + 100

      // Use stable inner offset if available, else fall back to computed values
      const ox = offsetRef.current ? offsetRef.current.x : offsetX
      const oy = offsetRef.current ? offsetRef.current.y : offsetY

      // Convert cursor screen position to world coordinates under current transform
      const worldX = (cursorX - tx) / currentZoom - ox
      const worldY = (cursorY - ty) / currentZoom - oy

      // Compute new pan so that the same world point stays under the cursor after zoom
      const newPanX = cursorX - (worldX + ox) * newZoom - rect.width / 2
      const newPanY = cursorY - (worldY + oy) * newZoom - 100

      setZoom(newZoom)
      setPan({ x: newPanX, y: newPanY })
    }

    // Add wheel listener with passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // Function to determine which nodes are within the selection rectangle
  const getNodesInSelectionRectangle = (): MessageId[] => {
    const selectedNodeIds: MessageId[] = []

    // Calculate selection rectangle bounds
    const minX = Math.min(selectionStart.x, selectionEnd.x)
    const maxX = Math.max(selectionStart.x, selectionEnd.x)
    const minY = Math.min(selectionStart.y, selectionEnd.y)
    const maxY = Math.max(selectionStart.y, selectionEnd.y)

    // Outer group transform (pan + zoom) in screen coordinates
    const tx = pan.x + dimensions.width / 2
    const ty = pan.y + 100
    const s = zoom

    // Account for inner group offset used to keep the tree in view
    Object.values(positions).forEach(({ x, y, node }) => {
      const x0 = x + offsetX
      const y0 = y + offsetY

      const isExpanded = !compactMode || node.id === focusedNodeId

      // Compute node bounds in screen space (after all transforms)
      let left: number, right: number, top: number, bottom: number

      if (isExpanded) {
        // Expanded nodes are rendered as a rectangle with top-left at (x - nodeWidth/2, y)
        left = (x0 - nodeWidth / 2) * s + tx
        right = (x0 + nodeWidth / 2) * s + tx
        top = y0 * s + ty
        bottom = (y0 + nodeHeight) * s + ty
      } else {
        // Compact nodes are rendered as a circle centered at (x, y + circleRadius),
        // but the top of the bounding box is y and height is 2 * circleRadius.
        left = (x0 - circleRadius) * s + tx
        right = (x0 + circleRadius) * s + tx
        top = y0 * s + ty
        bottom = (y0 + circleRadius * 2) * s + ty
      }

      // Intersect test between node bounds and selection rectangle (all in screen space)
      const intersects = right >= minX && left <= maxX && bottom >= minY && top <= maxY
      if (intersects) {
        const nodeIdParsed = parseId(node.id)
        if ((typeof nodeIdParsed === 'number' && !isNaN(nodeIdParsed)) || typeof nodeIdParsed === 'string') {
          selectedNodeIds.push(nodeIdParsed)
        }
      }
    })

    return selectedNodeIds
  }

  // Removed dominant-branch filtering to allow selecting nodes across multiple branches

  // (legacy mouse handlers removed in favor of pointer events)

  const handleMouseUp = (): void => {
    if (isSelecting) {
      // Calculate which nodes are within the selection rectangle
      const selectedNodeIds = getNodesInSelectionRectangle()
      // Replace selection with nodes from this drag (no branch filtering)
      dispatch(chatSliceActions.nodesSelected(selectedNodeIds))
      setIsSelecting(false)
      isSelectingRef.current = false
      // If any nodes were selected, open custom context menu at last mouse-up position
      if (selectedNodeIds.length > 0 && lastMouseUpPosRef.current) {
        setShowContextMenu(true)
      } else {
        setShowContextMenu(false)
      }
    }
    setIsDragging(false)
    isDraggingRef.current = false
    // Extra safety in case global listeners missed it
    removeGlobalNoSelect()
  }

  // Global move listeners to continue interactions outside the SVG
  const onWindowMouseMove = (e: globalThis.MouseEvent): void => {
    if (isDraggingRef.current) {
      setPan({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y })
    } else if (isSelectingRef.current) {
      const svgRect = svgRef.current?.getBoundingClientRect()
      if (svgRect) {
        const svgX = e.clientX - svgRect.left
        const svgY = e.clientY - svgRect.top
        setSelectionEnd({ x: svgX, y: svgY })
      }
    }
  }

  const onWindowTouchMove = (e: globalThis.TouchEvent): void => {
    // Prevent page scroll while interacting
    if (isDraggingRef.current || isSelectingRef.current) {
      try {
        e.preventDefault()
      } catch {}
    }
    if (!e.touches || e.touches.length === 0) return
    const t = e.touches[0]
    if (isDraggingRef.current) {
      setPan({ x: t.clientX - dragStartRef.current.x, y: t.clientY - dragStartRef.current.y })
    } else if (isSelectingRef.current) {
      const svgRect = svgRef.current?.getBoundingClientRect()
      if (svgRect) {
        const svgX = t.clientX - svgRect.left
        const svgY = t.clientY - svgRect.top
        setSelectionEnd({ x: svgX, y: svgY })
      }
    }
  }

  const addGlobalMoveListeners = (): void => {
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('pointermove', onWindowMouseMove)
    window.addEventListener('touchmove', onWindowTouchMove, { passive: false })
  }

  const removeGlobalMoveListeners = (): void => {
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('pointermove', onWindowMouseMove)
    window.removeEventListener('touchmove', onWindowTouchMove)
  }

  // Handle right-click context menu events
  const handleContextMenu = (e: React.MouseEvent<SVGElement>, nodeId: string): void => {
    e.preventDefault() // Prevent default browser context menu
    e.stopPropagation()

    // Convert nodeId to parsed format for selectedNodes array
    const nodeIdParsed = parseId(nodeId)

    // Check if the node is already selected
    const isAlreadySelected = selectedNodes.includes(nodeIdParsed)

    let newSelectedNodes: string[]

    if (e.ctrlKey || e.metaKey) {
      // Multi-select: toggle the node in the selection
      if (isAlreadySelected) {
        newSelectedNodes = selectedNodes.filter(id => id !== nodeIdParsed)
      } else {
        newSelectedNodes = [...selectedNodes, nodeIdParsed]
      }
    } else {
      // Without modifiers: toggle off if already selected; otherwise single-select this node
      if (isAlreadySelected) {
        newSelectedNodes = selectedNodes.filter(id => id !== nodeIdParsed)
      } else {
        newSelectedNodes = [nodeIdParsed]
      }
    }

    // Dispatch the nodesSelected action without branch filtering
    dispatch(chatSliceActions.nodesSelected(newSelectedNodes))

    // Show context menu at the right-click position
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect && newSelectedNodes.length > 0) {
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      setContextMenuPos(pos)
      setShowContextMenu(true)
    }
  }

  // Delete selected nodes using their message IDs
  const handleDeleteNodes = async (): Promise<void> => {
    try {
      const ids = selectedNodes || []
      if (ids.length === 0 || !conversationId) {
        setShowContextMenu(false)
        return
      }

      // Dispatch the delete action with conversationId
      await (dispatch as any)(deleteSelectedNodes({ ids, conversationId })).unwrap()

      // Clear selection after successful delete
      dispatch(chatSliceActions.nodesSelected([]))

      // Refresh the message tree (now fetches both tree and messages in one call)
      await (dispatch as any)(fetchMessageTree(conversationId))
    } catch (error) {
      console.error('Failed to delete nodes:', error)
    } finally {
      setShowContextMenu(false)
    }
  }

  // Copy messages along the union of root->selected-node paths
  const handleCopySelectedPaths = async (): Promise<void> => {
    try {
      const ids = selectedNodes || []
      if (!currentChatData || ids.length === 0) {
        setShowContextMenu(false)
        return
      }
      // Build id -> message map from the current tree
      const messagesById = new Map<string, string>()
      const visit = (node: ChatNode | null): void => {
        if (!node) return
        messagesById.set(node.id, node.message)
        node.children?.forEach(visit)
      }
      visit(currentChatData)

      // Collect only selected nodes' messages, preserving the selectedNodes order
      const messages: string[] = []
      const seen = new Set<string>()
      for (const idNum of ids) {
        const idStr = String(idNum)
        if (seen.has(idStr)) continue
        seen.add(idStr)
        const msg = messagesById.get(idStr)
        if (typeof msg === 'string') messages.push(msg)
      }

      const text = messages.join('\n\n')
      if (text.trim().length > 0) {
        try {
          await navigator.clipboard.writeText(text)
        } catch (err) {
          // Fallback if clipboard API fails
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.left = '-9999px'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          try {
            document.execCommand('copy')
          } finally {
            document.body.removeChild(ta)
          }
        }
      }
    } finally {
      setShowContextMenu(false)
      // Clear selection after copy
      dispatch(chatSliceActions.nodesSelected([]))
    }
  }

  // Helper: Check if all selected nodes belong to the same branch (linear parent-child chain)
  const areNodesOnSameBranch = (messageIds: MessageId[], messages: Message[]): boolean => {
    if (messageIds.length <= 1) return true

    const idSet = new Set(messageIds.map(String))
    const messageMap = new Map(messages.map(m => [String(m.id), m]))

    // Check for valid linear structure (no forks within selection)
    for (const id of messageIds) {
      const msg = messageMap.get(String(id))
      if (!msg) return false

      // Count how many selected messages are this message's children
      const childrenInSelection = messages.filter(m => m.parent_id === msg.id && idSet.has(String(m.id))).length

      // If more than 1 child in selection, it's a fork - not a linear branch
      if (childrenInSelection > 1) return false
    }

    // Find root (node with no parent in selection)
    const root = messageIds.find(id => {
      const msg = messageMap.get(String(id))
      return !msg?.parent_id || !idSet.has(String(msg.parent_id))
    })

    if (!root) return false

    // Verify all nodes are reachable from root (connected chain)
    const reachable = new Set<string>()
    let current: MessageId | null = root
    while (current) {
      reachable.add(String(current))
      // const msg = messageMap.get(String(current))
      const nextChild = messages.find(m => m.parent_id === current && idSet.has(String(m.id)))
      current = nextChild?.id || null
    }

    return reachable.size === messageIds.length
  }

  // Helper: Sort messages by branch path (root → leaf)
  const sortMessagesByBranch = (messageIds: MessageId[], messages: Message[]): MessageId[] => {
    const idSet = new Set(messageIds.map(String))
    const messageMap = new Map(messages.map(m => [String(m.id), m]))

    // Find root (node with no parent in selection)
    const root = messageIds.find(id => {
      const msg = messageMap.get(String(id))
      return !msg?.parent_id || !idSet.has(String(msg.parent_id))
    })

    if (!root) return messageIds

    // Build sorted array from root to leaf
    const sorted: MessageId[] = []
    let current: MessageId | null = root

    while (current) {
      sorted.push(current)
      const nextChild = messages.find(m => m.parent_id === current && idSet.has(String(m.id)))
      current = nextChild?.id || null
    }

    return sorted
  }

  // Create new chat from selected nodes
  const handleCreateNewChat = async (): Promise<void> => {
    try {
      const ids = selectedNodes || []
      if (ids.length === 0) {
        setShowContextMenu(false)
        return
      }

      // Build a map of message ID to full message data from state
      const messageMap = new Map<string, any>()
      allMessages.forEach(msg => {
        messageMap.set(String(msg.id), msg)
      })

      // Check if all selected nodes belong to same branch and sort if they do
      const onSameBranch = areNodesOnSameBranch(ids, allMessages)
      const orderedIds = onSameBranch ? sortMessagesByBranch(ids, allMessages) : ids

      // Collect selected messages in the determined order
      const messagesToCopy: Array<{
        role: 'user' | 'assistant'
        content: string
        thinking_block?: string
        model_name?: string
        tool_calls?: string
        note?: string
      }> = []

      const seen = new Set<string>()
      for (const idNum of orderedIds) {
        const idStr = String(idNum)
        if (seen.has(idStr)) continue
        seen.add(idStr)

        const msg = messageMap.get(idStr)
        if (msg) {
          messagesToCopy.push({
            role: msg.role,
            content: msg.content,
            thinking_block: msg.thinking_block || '',
            model_name: msg.model_name || 'unknown',
            tool_calls: msg.tool_calls || undefined,
            note: msg.note || undefined,
          })
        }
      }

      if (messagesToCopy.length === 0) {
        setShowContextMenu(false)
        return
      }

      // Generate title from first message content
      const firstContent = messagesToCopy[0].content
      const title = firstContent.slice(0, 100) + (firstContent.length > 100 ? '...' : '')

      // Create new conversation using the current project context
      const newConversation = await (dispatch as any)(createConversation({ title })).unwrap()

      if (!newConversation?.id) {
        console.error('Failed to create new conversation')
        return
      }

      // Insert messages as a chain preserving their structure
      await (dispatch as any)(
        insertBulkMessages({
          conversationId: newConversation.id,
          messages: messagesToCopy,
        })
      ).unwrap()

      // Fetch messages and tree to populate the new conversation before navigation
      await (dispatch as any)(fetchMessageTree(newConversation.id)).unwrap()

      // Navigate to the new chat
      navigate(`/chat/${newConversation.project_id || 'unknown'}/${newConversation.id}`)
    } catch (error) {
      console.error('Failed to create new chat from selection:', error)
    } finally {
      setShowContextMenu(false)
      // Clear selection after creating new chat
      dispatch(chatSliceActions.nodesSelected([]))
    }
  }

  // Close context menu on outside click
  useEffect(() => {
    if (!showContextMenu) return
    const onDown = () => {
      setShowContextMenu(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setShowContextMenu(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [showContextMenu])

  // Close note dialog only on escape key (not on outside click)
  useEffect(() => {
    if (!showNoteDialog) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') handleCloseNoteDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [showNoteDialog, handleCloseNoteDialog])

  const resetView = (): void => {
    // Compute bounds for fitting that ignore focusedNodeId so fit is consistent
    // across calls regardless of previous focus state.
    console.log('resetView called -------------')
    const fitBounds = (() => {
      const values = Object.values(positions)
      if (values.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      }
      return values.reduce<Bounds>(
        (acc, pos) => {
          // For fitting, treat nodes as expanded only when not in compactMode
          const isExpandedForFit = !compactMode
          const halfWidth = isExpandedForFit ? nodeWidth / 2 : circleRadius
          const height = isExpandedForFit ? nodeHeight : circleRadius * 2

          return {
            minX: Math.min(acc.minX, pos.x - halfWidth),
            maxX: Math.max(acc.maxX, pos.x + halfWidth),
            minY: Math.min(acc.minY, pos.y),
            maxY: Math.max(acc.maxY, pos.y + height),
          }
        },
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      )
    })()

    // Fit-to-screen zoom based on local fitBounds and container dimensions
    const contentW = Math.max(1, fitBounds.maxX - fitBounds.minX + 100)
    const contentH = Math.max(1, fitBounds.maxY - fitBounds.minY + 140)
    const availW = Math.max(1, dimensions.width - 120)
    const availH = Math.max(1, dimensions.height - 180)
    const fitZoom = Math.min(availW / contentW, availH / contentH)
    const preferredMaxInitialZoom = 1
    const newZoom = Math.max(0.1, Math.min(3, Math.min(fitZoom, preferredMaxInitialZoom)))
    setZoom(newZoom)
    setFocusedNodeId(null)

    // Recompute base offset based on local fitBounds
    offsetRef.current = { x: -fitBounds.minX + 50, y: -fitBounds.minY + 50 }

    // Center the root node in the viewport using the new zoom
    const id = currentChatData?.id
    if (!id) return
    const root = positions[id]
    if (!root) return
    const s = newZoom
    const ox = offsetRef.current.x
    const oy = offsetRef.current.y
    const centerX = dimensions.width / 2
    const centerY = dimensions.height / 2
    const px = centerX - ((root.x ?? 0) + ox) * s - centerX
    const py = centerY - ((root.y ?? 0) + oy) * s - 440
    setPan({ x: px, y: py })

    // We've just centered explicitly
    hasCenteredRef.current = true
  }

  const zoomIn = (): void => setZoom(prev => Math.min(3, prev * 1.2))
  const zoomOut = (): void => setZoom(prev => Math.max(0.1, prev / 1.2))

  // Calculate viewport bounds for culling off-screen nodes
  const viewportBounds = useMemo(() => {
    if (!dimensions.width || !dimensions.height) {
      return null
    }

    // Add padding to include nodes slightly outside viewport for smooth scrolling
    const padding = Math.max(nodeWidth, nodeHeight)

    return {
      minX: -padding,
      maxX: dimensions.width + padding,
      minY: -padding,
      maxY: dimensions.height + padding,
    }
  }, [dimensions.width, dimensions.height])

  // Filter visible positions based on viewport bounds
  const visiblePositions = useMemo(() => {
    if (!viewportBounds) {
      return positions
    }

    // Transform from tree coordinates to screen coordinates
    // Transform chain: translate(offsetX, offsetY) -> scale(zoom) -> translate(pan.x + width/2, pan.y + 100)
    const tx = pan.x + dimensions.width / 2
    const ty = pan.y + 100

    const visible: Record<string, Position> = {}
    const culled: string[] = []

    Object.entries(positions).forEach(([id, pos]) => {
      const { x, y, node } = pos
      const isExpanded = !compactMode || node.id === focusedNodeId
      const width = isExpanded ? nodeWidth : circleRadius * 2
      const height = isExpanded ? nodeHeight : circleRadius * 2

      // Convert tree coordinates to screen coordinates
      const screenX = (x + offsetX) * zoom + tx
      const screenY = (y + offsetY) * zoom + ty

      // Node bounds in screen space
      const left = screenX - (width / 2) * zoom
      const right = screenX + (width / 2) * zoom
      const top = screenY
      const bottom = screenY + height * zoom

      // Check if node intersects viewport
      if (
        right >= viewportBounds.minX &&
        left <= viewportBounds.maxX &&
        bottom >= viewportBounds.minY &&
        top <= viewportBounds.maxY
      ) {
        visible[id] = pos
      } else {
        culled.push(id)
      }
    })

    // Debug logging (comment out for production)
    // console.log(`Viewport culling: ${Object.keys(visible).length} visible, ${culled.length} culled`)
    // if (culled.length > 0) {
    //   console.log('Culled nodes:', culled)
    // }

    return visible
  }, [positions, viewportBounds, compactMode, focusedNodeId, pan.x, pan.y, zoom, offsetX, offsetY, dimensions.width])

  const renderConnections = (): JSX.Element[] => {
    const connections: JSX.Element[] = []
    const drawnConnections = new Set<string>() // Track to avoid duplicates

    // Helper to draw connection from parent to child
    const drawConnection = (parentPos: Position, childPos: Position, childNode: ChatNode) => {
      const { x: parentX, y: parentY, node: parent } = parentPos
      const { x: childX, y: childY } = childPos

      const isParentExpanded = !compactMode || parent.id === focusedNodeId
      const parentBottomY = parentY + (isParentExpanded ? nodeHeight : circleRadius * 2)

      const parentNodeIdParsed = parseId(parent.id)
      const isParentOnPath =
        ((typeof parentNodeIdParsed === 'number' && !isNaN(parentNodeIdParsed)) ||
          typeof parentNodeIdParsed === 'string') &&
        currentPathSet.has(parentNodeIdParsed)

      const childNodeIdParsed = parseId(childNode.id)
      const isChildOnPath =
        ((typeof childNodeIdParsed === 'number' && !isNaN(childNodeIdParsed)) ||
          typeof childNodeIdParsed === 'string') &&
        currentPathSet.has(childNodeIdParsed)
      const isOnCurrentPath = isParentOnPath && isChildOnPath

      const connectionKey = `${parent.id}-${childNode.id}`
      if (drawnConnections.has(connectionKey)) return
      drawnConnections.add(connectionKey)

      if (parent.children.length === 1) {
        // Single child - straight line
        connections.push(
          <line
            key={connectionKey}
            x1={parentX}
            y1={parentBottomY}
            x2={childX}
            y2={childY}
            className={
              isOnCurrentPath ? 'stroke-indigo-400 dark:stroke-neutral-200' : 'stroke-neutral-400 dark:stroke-gray-500'
            }
            strokeWidth='2'
          />
        )
      } else {
        // Multiple children - branching structure
        const verticalDropHeight = verticalSpacing * 0.4
        const branchY = parentBottomY + verticalDropHeight

        const path = `
          M ${parentX} ${branchY}
          L ${childX} ${branchY}
          L ${childX} ${childY}
        `

        connections.push(
          <path
            key={`${connectionKey}-path`}
            d={path}
            fill='none'
            className={
              isOnCurrentPath ? 'stroke-indigo-400 dark:stroke-neutral-200' : 'stroke-neutral-400 dark:stroke-gray-500'
            }
            strokeWidth='2'
          />
        )

        // Add small dot at branch point
        if (childX !== parentX) {
          connections.push(
            <circle
              key={`${connectionKey}-dot`}
              cx={childX}
              cy={branchY}
              r='3'
              className={
                isOnCurrentPath ? 'fill-indigo-400 dark:stroke-neutral-200' : 'fill-gray-600 dark:fill-gray-500'
              }
            />
          )
        }
      }
    }

    // Build parent map from all positions
    const parentMap = new Map<string, string>() // childId -> parentId
    Object.values(positions).forEach(({ node }) => {
      if (node.children) {
        node.children.forEach(child => {
          parentMap.set(child.id, node.id)
        })
      }
    })

    // First pass: Draw connections from visible parent nodes to all their children
    Object.values(visiblePositions).forEach(pos => {
      const { node } = pos
      if (node.children && node.children.length > 0) {
        const parentPos = positions[node.id]
        if (!parentPos) return

        const verticalDropHeight = verticalSpacing * 0.4
        const isParentExpanded = !compactMode || node.id === focusedNodeId
        const parentBottomY = parentPos.y + (isParentExpanded ? nodeHeight : circleRadius * 2)
        const branchY = parentBottomY + verticalDropHeight

        const parentNodeIdParsed = parseId(node.id)
        const isParentOnPath =
          ((typeof parentNodeIdParsed === 'number' && !isNaN(parentNodeIdParsed)) ||
            typeof parentNodeIdParsed === 'string') &&
          currentPathSet.has(parentNodeIdParsed)

        // Draw vertical drop and junction for multi-child nodes
        if (node.children.length > 1) {
          connections.push(
            <line
              key={`${node.id}-drop`}
              x1={parentPos.x}
              y1={parentBottomY}
              x2={parentPos.x}
              y2={branchY}
              className={
                isParentOnPath ? 'stroke-indigo-400 dark:stroke-neutral-200' : 'stroke-neutral-400 dark:stroke-gray-500'
              }
              strokeWidth='2'
            />
          )

          connections.push(
            <circle
              key={`${node.id}-junction`}
              cx={parentPos.x}
              cy={branchY}
              r='4'
              className={
                isParentOnPath
                  ? 'fill-indigo-300 dark:fill-amber-300 stroke-indigo-400 dark:stroke-amber-400'
                  : 'fill-gray-700 dark:fill-gray-600 stroke-gray-600 dark:stroke-gray-500'
              }
              strokeWidth='2'
            />
          )
        }

        // Draw connections to each child
        node.children.forEach(child => {
          const childPos = positions[child.id]
          if (childPos) {
            drawConnection(parentPos, childPos, child)
          }
        })
      }
    })

    // Second pass: Draw connections from visible children to their culled parents
    Object.values(visiblePositions).forEach(pos => {
      const { node } = pos
      const parentId = parentMap.get(node.id)
      if (parentId) {
        const parentPos = positions[parentId]
        // Only draw if parent exists but is NOT visible (culled)
        if (parentPos && !visiblePositions[parentId]) {
          drawConnection(parentPos, pos, node)
        }
      }
    })

    return connections
  }

  const renderNodes = (): JSX.Element[] => {
    return Object.values(visiblePositions).map(({ x, y, node }) => {
      const isExpanded = !compactMode || node.id === focusedNodeId
      const nodeIdParsed = parseId(node.id)
      const isNodeSelected =
        ((typeof nodeIdParsed === 'number' && !isNaN(nodeIdParsed)) || typeof nodeIdParsed === 'string') &&
        selectedNodes.includes(nodeIdParsed)
      const isOnCurrentPath =
        ((typeof nodeIdParsed === 'number' && !isNaN(nodeIdParsed)) || typeof nodeIdParsed === 'string') &&
        currentPathSet.has(nodeIdParsed)
      const isVisible =
        ((typeof nodeIdParsed === 'number' && !isNaN(nodeIdParsed)) || typeof nodeIdParsed === 'string') &&
        visibleMessageId === nodeIdParsed
      const isNew = !firstPaintRef.current && !seenNodeIdsRef.current.has(node.id)

      if (isExpanded) {
        // Render full node
        return (
          <motion.g
            key={node.id}
            transform={`translate(${x - nodeWidth / 2}, ${y})`}
            initial={isNew ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {/* Current path highlight (rendered first so selection can appear above) */}
            {isOnCurrentPath && (
              // <rect
              //   width={nodeWidth + 12}
              //   height={nodeHeight + 12}
              //   x={-6}
              //   y={-6}
              //   rx='14'
              //   fill='none'
              //   stroke='currentColor'
              //   strokeWidth='3'
              //   className={`animate-pulse-slow transition-colors duration-300 ${
              //     isVisible ? 'stroke-rose-300' : 'stroke-indigo-200 dark:stroke-yPurple-50'
              //   }`}
              // />
              <line
                x1='72'
                y1={nodeHeight + 10}
                x2={nodeWidth - 72}
                y2={nodeHeight + 10}
                strokeWidth='4'
                className={`animate-pulse-slow transition-colors duration-200 ${
                  isVisible ? 'stroke-rose-300' : 'stroke-indigo-200 dark:stroke-yPurple-50'
                }`}
              />
            )}
            {/* Selection highlight */}
            {isNodeSelected && (
              <rect
                width={nodeWidth + 12}
                height={nodeHeight + 12}
                x={-6}
                y={-6}
                rx='14'
                fill='none'
                stroke='currentColor'
                strokeWidth='3'
                className={`animate-pulse-slow transition-colors duration-300 ${' stroke-stone-400 dark:stroke-neutral-200'}`}
              />
            )}
            <rect
              width={nodeWidth}
              height={nodeHeight}
              rx='8'
              strokeWidth='2'
              className={`cursor-pointer hover:opacity-90 transition-opacity duration-200 ${
                compactMode && focusedNodeId === node.id ? 'animate-pulse' : ''
              } ${node.sender === 'user' ? 'fill-slate-50 stroke-vtestb-100 dark:fill-yBlack-900 dark:stroke-yPurple-400' : 'fill-slate-100 stroke-neutral-200 dark:fill-yBlack-900 dark:stroke-yBrown-400 '} `}
              style={{
                filter:
                  compactMode && focusedNodeId === node.id
                    ? `drop-shadow(0 12px 12px rgba(0,0,0,${isDarkMode ? '0.45' : '0.05'})) drop-shadow(0 6px 18px rgba(0,0,0,0.02)) drop-shadow(0 0 10px rgba(59, 130, 246, 0.5))`
                    : `drop-shadow(0 12px 12px rgba(0,0,0,${isDarkMode ? '0.55' : '0.05'})) drop-shadow(0 6px 18px rgba(0,0,0,0.02))`,
              }}
              onMouseEnter={e => {
                setSelectedNode(node)
                const containerRect = containerRef.current?.getBoundingClientRect()
                if (containerRect) {
                  setMousePosition({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                  })
                }
              }}
              onMouseLeave={() => setSelectedNode(null)}
              onClick={() => {
                if (onNodeSelect) {
                  const nodeIdParsed = parseId(node.id)
                  // If clicked node is already in current path, just update focused message
                  if (currentPathIds && currentPathIds.includes(nodeIdParsed)) {
                    dispatch(chatSliceActions.focusedChatMessageSet(nodeIdParsed))
                    return
                  }
                  const path = getPathWithDescendants(node.id)
                  onNodeSelect(node.id, path)
                }
              }}
              onContextMenu={e => handleContextMenu(e, node.id)}
            />
            {/* Bottom border line */}
            {/* <line
              x1='0'
              y1={nodeHeight}
              x2={nodeWidth}
              y2={nodeHeight}
              strokeWidth='2'
              className={`${node.sender === 'user' ? 'stroke-neutral-200 dark:stroke-yPurple-400' : 'stroke-neutral-200 dark:stroke-yBrown-400'}`}
            /> */}
            <foreignObject width={nodeWidth} height={nodeHeight} style={{ pointerEvents: 'none', userSelect: 'none' }}>
              <div className='p-3 text-stone-800 dark:text-stone-300 text-sm h-full flex items-center'>
                <p className='line-clamp-3 '>{node.message}</p>
              </div>
            </foreignObject>
            {/* Note indicator for expanded view */}
            {(() => {
              const nodeIdParsed = parseId(node.id)
              if (typeof nodeIdParsed === 'number' && isNaN(nodeIdParsed)) return null
              const message = getCurrentMessage(nodeIdParsed)
              const hasNote = message?.note && message.note.trim().length > 0
              return hasNote ? (
                <circle
                  cx={nodeWidth - 8}
                  cy={nodeHeight - 8}
                  r='4'
                  fill='#fbbf24'
                  stroke='#f59e0b'
                  strokeWidth='1'
                  style={{ pointerEvents: 'none' }}
                />
              ) : null
            })()}
          </motion.g>
        )
      } else {
        // Render compact circle
        return (
          <motion.g
            key={node.id}
            initial={isNew ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {/* Current path highlight for compact mode */}
            {/* {isOnCurrentPath && (
              <circle
                cx={x}
                cy={y + circleRadius}
                r={circleRadius + 8}
                fill='none'
                // stroke='rgba(16, 185, 129, 0.9)'
                strokeWidth='3'
                className={`animate-pulse-slow transition-colors duration-200 ${
                  isVisible ? 'stroke-rose-300' : 'stroke-indigo-200 dark:stroke-yPurple-50'
                }`}
              />
            )} */}
            {/* Visible message highlight for compact mode */}
            {/* {isVisible && (
              <circle
                cx={x}
                cy={y + circleRadius}
                r={circleRadius + 6}
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='stroke-cyan-400 dark:stroke-amber-300'
              />
            )} */}
            {/* Selection highlight for compact mode */}
            {isNodeSelected && (
              <circle
                cx={x}
                cy={y + circleRadius}
                r={circleRadius + 10}
                fill='none'
                stroke='currentColor'
                strokeWidth='3'
                className='animate-pulse stroke-blue-500 dark:stroke-stone-400'
              />
            )}
            <circle
              cx={x}
              cy={y + circleRadius}
              r={circleRadius}
              className={`cursor-pointer transition-transform duration-150 ${isVisible ? ' fill-rose-300 dark:fill-yPurple-500' : 'fill-yBlack-900 dark:fill-yBlack-900'} ${
                node.sender === 'user' ? 'fill-yellow-100 stroke-yBrown-500' : 'fill-indigo-50 stroke-yPurple-500'
              } `}
              style={{
                transform: selectedNode?.id === node.id ? 'scale(1.1)' : 'scale(1)',
                transformOrigin: `${x}px ${y + circleRadius}px`,
                filter: `drop-shadow(0 12px 28px rgba(0,0,0,${isDarkMode ? '0.45' : '0.05'})) drop-shadow(0 6px 18px rgba(0,0,0,0.02))`,
              }}
              onMouseEnter={e => {
                setSelectedNode(node)
                const containerRect = containerRef.current?.getBoundingClientRect()
                if (containerRect) {
                  setMousePosition({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                  })
                }
              }}
              onMouseLeave={() => setSelectedNode(null)}
              onClick={() => {
                // Trigger node selection callback
                if (onNodeSelect) {
                  const nodeIdParsed = parseId(node.id)
                  // If clicked node is already in current path, just update focused message
                  if (currentPathIds && currentPathIds.includes(nodeIdParsed)) {
                    dispatch(chatSliceActions.focusedChatMessageSet(nodeIdParsed))
                    return
                  }
                  const path = getPathWithDescendants(node.id)
                  onNodeSelect(node.id, path)
                }
              }}
              onContextMenu={e => handleContextMenu(e, node.id)}
            />
            {/* Note indicator for compact view */}
            {(() => {
              const nodeIdParsed = parseId(node.id)
              if (typeof nodeIdParsed === 'number' && isNaN(nodeIdParsed)) return null
              const message = getCurrentMessage(nodeIdParsed)
              const hasNote = message?.note && message.note.trim().length > 0
              return hasNote ? (
                <circle
                  cx={x + circleRadius - 6}
                  cy={y + circleRadius + 6}
                  r='3'
                  fill='#fbbf24'
                  stroke='#f59e0b'
                  strokeWidth='1'
                  style={{ pointerEvents: 'none' }}
                />
              ) : null
            })()}
            {/* Add a small indicator for branch nodes */}
            {/* {node.children && node.children.length > 1 && (
              <circle
                cx={x}
                cy={y + circleRadius}
                r='6'
                fill='white'
                opacity='0.4'
                className='animate-pulse'
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              />
            )} */}
          </motion.g>
        )
      }
    })
  }

  // Note: loading overlay is handled within main render to avoid unmounting the tree

  // Note: error overlay is handled within main render to avoid unmounting the tree

  // Note: empty-state overlay is handled within main render to avoid unmounting the tree

  return (
    <div
      ref={containerRef}
      className='group w-full h-screen border-l dark:border-neutral-800 border-neutral-200 bg-neutral-50 relative overflow-hidden dark:bg-neutral-900 shadow-[inset_8px_0_17px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_12px_-2px_rgba(0,0,0,0.85)]'
      onContextMenu={e => e.preventDefault()}
      style={{
        filter: isTransitioning ? 'none' : 'none',
        transition: 'filter 100ms ease-in-out',
      }}
    >
      {/* Overlays: loading, error, empty-state (non-destructive, do not unmount SVG) */}
      {/* <AnimatePresence>
        {loading && (
          <motion.div
            className='absolute inset-0 z-20 flex items-center justify-center bg-slate-50 text-stone-800 dark:text-stone-200 dark:text-stone-200 dark:bg-neutral-900'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <motion.div
              className='text-white text-center'
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
            >
              <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4'></div>
              <p className='text-lg'>Loading conversation tree...</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence> */}
      <AnimatePresence>
        {error && (
          <motion.div
            className='absolute inset-0 z-20 flex items-center justify-center bg-slate-50 text-stone-800 dark:text-stone-200'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <motion.div
              className='text-white text-center max-w-md'
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
            >
              <div className='text-red-400 text-6xl mb-4'>⚠️</div>
              <p className='text-lg mb-2'>Failed to load conversation</p>
              <p className='text-sm text-gray-400'>{error}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className='absolute inset-0 z-20 flex items-center justify-center bg-slate-50 text-stone-800 dark:text-stone-200'>
          <div className='text-white text-center max-w-md'>
            <div className='text-red-400 text-6xl mb-4'>⚠️</div>
            <p className='text-lg mb-2'>Failed to load conversation</p>
            <p className='text-sm text-gray-400'>{error}</p>
          </div>
        </div>
      )}
      {!error && !loading && !lastDataRef.current && (
        <div className='absolute inset-0 z-10 flex items-center justify-center bg-slate-50 text-stone-800 dark:text-stone-200 dark:bg-neutral-900'>
          <div className='text-white text-center max-w-md'>
            {/* <div className='text-gray-500 text-6xl mb-4'>💬</div> */}
            <p className='text-lg mb-2'>Loading / Tree will appear here</p>
            {/* <p className='text-sm text-gray-400'>Select a conversation to view its message tree</p> */}
          </div>
        </div>
      )}
      <div className='absolute top-4 left-4 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
        <button
          onClick={zoomIn}
          className='p-2 bg-neutral-50 text-stone-800 dark:text-stone-200 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:bg-neutral-700 transition-colors active:scale-90 border-2 hover:scale-101 border-stone-300 dark:border-stone-700 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.65)] dark:bg-yBlack-900 '
          title='Zoom In'
        >
          <ZoomIn size={20} />
        </button>
        <button
          onClick={zoomOut}
          className='p-2 bg-neutral-50 text-stone-800 dark:text-stone-200 rounded-lg   hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:bg-neutral-700 transition-colors active:scale-90 border-2 hover:scale-101 border-stone-300 dark:border-stone-700 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.65)] dark:bg-yBlack-900'
          title='Zoom Out'
        >
          <ZoomOut size={20} />
        </button>
        <button
          onClick={resetView}
          className='p-2 bg-neutral-50 text-stone-800 dark:text-stone-200 rounded-lg   hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:bg-neutral-700 transition-colors active:scale-90 border-2 hover:scale-101 border-stone-300 dark:border-stone-700 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.65)] dark:bg-yBlack-900'
          title='Reset View'
        >
          <RotateCcw size={20} />
        </button>
        <button
          onClick={() => {
            dispatch(chatSliceActions.heimdallCompactModeToggled())
          }}
          className='p-2 bg-neutral-50  text-stone-800 dark:text-stone-200 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:bg-neutral-700 transition-colors active:scale-90 border-2 hover:scale-101 border-stone-300 dark:border-stone-700 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.65)] dark:bg-yBlack-900'
          title='Toggle Compact Mode'
        >
          {compactMode ? 'Compact' : 'Full'}
        </button>
      </div>
      <div className='absolute top-4 right-8 z-10 flex flex-col gap-2 items-end'>
        {/* Search bar for messages in the current chat */}
        <div className='w-[400px] relative mb-2 shadow-[0_20px_12px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.2)]'>
          <TextField
            placeholder='Search'
            value={searchQuery}
            onChange={val => {
              setSearchQuery(val)
              setSearchOpen(!!val.trim())
              setSearchHoverIndex(-1)
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSearchHoverIndex(prev => Math.min(prev + 1, Math.max(0, filteredResults.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSearchHoverIndex(prev => Math.max(-1, prev - 1))
              } else if (e.key === 'Enter') {
                // Enter selects the highlighted result or the first one
                const item = filteredResults[searchHoverIndex >= 0 ? searchHoverIndex : 0]
                if (item) {
                  searchFocusPendingRef.current = true
                  const path = buildBranchPathForMessage(flatMessages as any, item.id)
                  if (path.length > 0) {
                    dispatch(chatSliceActions.conversationPathSet(path))
                    dispatch(chatSliceActions.selectedNodePathSet(path.map(id => String(id))))
                  }
                  dispatch(chatSliceActions.focusedChatMessageSet(item.id))
                  setSearchOpen(false)
                  setSearchQuery('')
                }
              } else if (e.key === 'Escape') {
                setSearchOpen(false)
              }
            }}
            size='small'
            showSearchIcon
            onSearchClick={() => {
              if (filteredResults.length > 0) {
                const item = filteredResults[0]
                searchFocusPendingRef.current = true
                const path = buildBranchPathForMessage(flatMessages as any, item.id)
                if (path.length > 0) {
                  dispatch(chatSliceActions.conversationPathSet(path))
                  dispatch(chatSliceActions.selectedNodePathSet(path.map(id => String(id))))
                }
                dispatch(chatSliceActions.focusedChatMessageSet(item.id))
                setSearchOpen(false)
                setSearchQuery('')
              }
            }}
            className='bg-amber-50 dark:bg-neutral-700'
          />
          {searchOpen && searchQuery.trim() && (
            <div
              className='absolute right-0 mt-1 w-full max-h-72 overflow-auto rounded-md border border-stone-200 bg-white dark:bg-neutral-900 dark:border-stone-700 z-20 thin-scrollbar shadow-[0_12px_12px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.2)]'
              data-heimdall-wheel-exempt='true'
            >
              {filteredResults.length === 0 ? (
                <div className='px-3 py-2 text-sm text-neutral-500 dark:text-stone-300 '>No matches</div>
              ) : (
                <ul className='py-1 text-sm text-stone-800 dark:text-stone-300'>
                  {filteredResults.map((item, idx) => {
                    const content = (item.content || '').replace(/\s+/g, ' ').trim()
                    const snippet = content.length > 160 ? content.slice(0, 160) + '…' : content
                    return (
                      <li key={item.id}>
                        <button
                          type='button'
                          onClick={() => {
                            searchFocusPendingRef.current = true
                            const path = buildBranchPathForMessage(flatMessages as any, item.id)
                            if (path.length > 0) {
                              dispatch(chatSliceActions.conversationPathSet(path))
                              dispatch(chatSliceActions.selectedNodePathSet(path.map(id => String(id))))
                            }
                            dispatch(chatSliceActions.focusedChatMessageSet(item.id))
                            setSearchOpen(false)
                            setSearchQuery('')
                          }}
                          onMouseEnter={() => setSearchHoverIndex(idx)}
                          className={`w-full text-left px-3 py-4 hover:bg-stone-100 dark:hover:bg-neutral-800 ${
                            idx === searchHoverIndex ? 'bg-stone-100 dark:bg-neutral-800' : ''
                          }`}
                        >
                          <div className='items-start gap-2'>
                            <span className='line-clamp-2'>{snippet || '(empty message)'}</span>
                            <span
                              className={`shrink-0 text-xs my-2 py-2 text-neutral-500 dark:text-neutral-400 ${item.role === 'user' ? 'text-neutral-500 dark:text-stone-200' : 'text-neutral-500 dark:text-yBrown-0'}`}
                            >
                              {' '}
                              {item.role}
                            </span>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        {/* <div className='bg-neutral-100 text-stone-800 dark:text-stone-200 px-3 py-1 rounded-lg text-sm border-2 border-stone-300 dark:border-stone-700 drop-shadow-xl shadow-[0_0px_6px_-12px_rgba(0,0,0,0.05)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.65)] dark:bg-yBlack-900'>
          Zoom: {Math.round(zoom * 100)}%
        </div> */}

        <div className='bg-neutral-50 text-stone-800 dark:text-stone-200 px-3 py-1 rounded-lg text-sm border-2 border-stone-300 dark:border-stone-700 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.65)]  dark:bg-yBlack-900 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
          <div className='flex items-center gap-2'>
            <div className='w-3 h-3 bg-neutral-50 border-2 dark:border-yPurple-400 rounded dark:bg-neutral-900 border-stone-400'></div>
            <span>User messages</span>
          </div>
          <div className='flex items-center gap-2'>
            <div className='w-3 h-3 bg-slate-50 dark:bg-yBlack-900 dark:border-yBrown-500 rounded border-2 border-slate-400'></div>
            <span>Assistant messages</span>
          </div>
        </div>
      </div>
      <svg
        ref={svgRef}
        className='w-full h-full cursor-move'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={e => e.preventDefault()}
        onClick={e => {
          const target = e.target as SVGElement
          if (target === e.currentTarget || target.tagName === 'svg') {
            setFocusedNodeId(null)
            // Clear selection when clicking on empty space
            if (onNodeSelect) {
              onNodeSelect('', [])
            }
          }
        }}
        style={{ cursor: isDragging ? 'grabbing' : isSelecting ? 'crosshair' : 'grab', touchAction: 'none' }}
      >
        <g transform={`translate(${pan.x + dimensions.width / 2}, ${pan.y + 100}) scale(${zoom})`}>
          <g transform={`translate(${offsetX}, ${offsetY})`}>
            <g strokeLinecap='round' strokeLinejoin='round'>
              {renderConnections()}
            </g>
            <AnimatePresence initial={false} mode='popLayout'>
              {renderNodes()}
            </AnimatePresence>
          </g>
        </g>
        {/* Viewport bounds debug overlay - uncomment to visualize culling area */}
        {/* {viewportBounds && (
          <rect
            x={viewportBounds.minX}
            y={viewportBounds.minY}
            width={viewportBounds.maxX - viewportBounds.minX}
            height={viewportBounds.maxY - viewportBounds.minY}
            fill='rgba(255, 0, 0, 0.1)'
            stroke='rgba(255, 0, 0, 0.5)'
            strokeWidth='3'
            strokeDasharray='10,5'
            style={{ pointerEvents: 'none' }}
          />
        )} */}
        {/* Selection rectangle */}
        {isSelecting && (
          <rect
            x={Math.min(selectionStart.x, selectionEnd.x)}
            y={Math.min(selectionStart.y, selectionEnd.y)}
            width={Math.abs(selectionEnd.x - selectionStart.x)}
            height={Math.abs(selectionEnd.y - selectionStart.y)}
            fill='rgba(59, 130, 246, 0.2)'
            stroke='rgba(59, 130, 246, 0.8)'
            strokeWidth='2'
            strokeDasharray='5,5'
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>
      {/* Custom context menu after selection */}
      {showContextMenu && contextMenuPos && (
        <div
          className='absolute z-30 min-w-[140px] rounded-xl shadow-lg border border-stone-200 bg-white dark:bg-yBlack-900 dark:border-neutral-700 '
          style={{
            left: Math.max(8, Math.min(contextMenuPos.x, Math.max(0, dimensions.width - 180))),
            top: Math.max(8, Math.min(contextMenuPos.y, Math.max(0, dimensions.height - 140))),
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <ul className='py-1 text-sm text-stone-800 dark:text-stone-200'>
            <li>
              <button
                className='w-full text-left px-3 py-3 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-yBlack-900 rounded-xl hover:scale-103 active:scale-97 transition-all duration-100'
                onClick={handleCopySelectedPaths}
              >
                Copy
              </button>
            </li>
            {selectedNodes.length === 1 && (
              <li>
                <button
                  className='w-full text-left px-3 py-3 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-yBlack-900 rounded-xl hover:scale-103 active:scale-97 transition-all duration-100'
                  onClick={() => {
                    const nodeId = String(selectedNodes[0])

                    if (contextMenuPos) {
                      handleOpenNoteDialog(nodeId, contextMenuPos)
                    }
                  }}
                >
                  {(() => {
                    const message = getCurrentMessage(selectedNodes[0])
                    const hasNote = message?.note && message.note.trim().length > 0
                    return hasNote ? 'View Note' : 'Add Note'
                  })()}
                </button>
              </li>
            )}
            <li>
              <button
                className='w-full text-left px-3 py-3 dark:text-stone-200 hover:bg-stone-100 rounded-xl dark:hover:bg-yBlack-900 hover:scale-103 active:scale-97 transition-all duration-100'
                onClick={handleCreateNewChat}
              >
                Create New Chat
              </button>
            </li>
            <li>
              <button
                className='w-full text-left px-3 py-3 hover:bg-stone-100 dark:hover:bg-yBlack-900 rounded-xl text-red-600 dark:text-red-400 hover:scale-103 active:scale-97'
                onClick={handleDeleteNodes}
              >
                Delete
              </button>
            </li>
          </ul>
        </div>
      )}
      <div className='absolute bottom-4 left-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
        <div className='bg-neutral-50  text-stone-800 dark:text-stone-200 px-3 py-2 rounded-lg text-xs space-y-1 w-fit transition-colors border-2 border-stone-300 dark:border-stone-700 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.65)] dark:bg-yBlack-900'>
          <div>Messages: {stats.totalNodes}</div>
          <div>Max depth: {stats.maxDepth}</div>
          <div>Branches: {stats.branches}</div>
          {/* <div className='pt-1 border-t border-gray-700'>Mode: {compactMode ? 'Compact' : 'Full'}</div> */}
        </div>
        <div className='text-stone-800 dark:text-stone-200 text-sm flex items-center gap-2'>
          <Move size={16} />
          <span>Drag to pan • Scroll to zoom • Right-click drag to select</span>
        </div>
      </div>
      {selectedNode && (
        <div
          className={`absolute max-w-md bg-amber-50 dark:bg-neutral-800 text-stone-800 dark:text-stone-200 p-4 rounded-lg shadow-xl z-20 ${compactMode ? 'border-2 border-gray-600' : ''}`}
          style={{
            left: Math.min(mousePosition.x + 10, dimensions.width - 400),
            top: Math.max(mousePosition.y + 10, 10),
            maxWidth: '300px',
          }}
        >
          <div className='text-xs text-stone-800 bg-amber-50 dark:bg-neutral-800 dark:text-stone-200 mb-1'>
            {selectedNode.sender === 'user' ? 'User' : 'Assistant'}
          </div>
          <div className='text-sm whitespace-normal break-words overflow-hidden ygg-line-clamp-6'>
            {selectedNode.message}
          </div>
        </div>
      )}

      {/* Note dialog */}
      {showNoteDialog && noteDialogPos && noteMessageId !== null && (
        <div
          className='note-dialog-container absolute z-40 w-96 bg-neutral-50 dark:bg-yBlack-900 border border-stone-200 dark:border-neutral-700 rounded-2xl shadow-lg'
          style={{
            left: Math.max(8, Math.min(noteDialogPos.x, Math.max(0, dimensions.width - 400))),
            top: Math.max(8, Math.min(noteDialogPos.y, Math.max(0, dimensions.height - 300))),
          }}
          onMouseDown={e => e.stopPropagation()}
          data-heimdall-wheel-exempt='true'
        >
          <div className='px-4 py-2'>
            <div className='flex justify-between items-center mb-4 mt-1 mx-1'>
              <h3 className='text-sm font-medium text-stone-800 dark:text-stone-200'>
                {(() => {
                  const message = getCurrentMessage(noteMessageId)
                  const hasNote = message?.note && message.note.trim().length > 0
                  return hasNote ? 'Edit Note' : 'Add Note'
                })()}
              </h3>
              <button
                onClick={handleCloseNoteDialog}
                className='text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 active:scale-95'
                title='Close'
              >
                ✕
              </button>
            </div>
            <div className='mb-1'>
              <TextArea
                placeholder='Enter your note...'
                value={noteText}
                onChange={handleNoteTextChange}
                minRows={3}
                maxRows={8}
                autoFocus
                className='w-full thin-scrollbar shadow-[0_0px_12px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_0px_18px_3px_rgba(0,0,0,0.5)] rounded-2xl'
                width='w-full'
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(Heimdall)
