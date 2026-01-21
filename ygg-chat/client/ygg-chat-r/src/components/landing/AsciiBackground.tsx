import React, { useEffect, useRef } from 'react'

interface AsciiBackgroundProps {
  scrollY: number
  isDark: boolean
  isActive: boolean
}

export const AsciiBackground: React.FC<AsciiBackgroundProps> = ({ scrollY, isDark, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const treeMaskRef = useRef<Uint8Array | null>(null)
  const blockCharsRef = useRef<Uint16Array | null>(null)
  const blockSeedsRef = useRef<Uint32Array | null>(null)
  const blockColsRef = useRef(0)
  const blockRowsRef = useRef(0)
  const animationFrameRef = useRef<number>(0)
  const renderRef = useRef<(now: number) => void>(() => {})
  const lastFrameRef = useRef(0)
  const isVisibleRef = useRef(true)
  const isActiveRef = useRef(true)
  const scrollYRef = useRef(scrollY)

  const BASE_CHAR_SIZE = 10
  const RENDER_SCALE = 0.75
  const CHAR_SIZE = BASE_CHAR_SIZE * RENDER_SCALE
  const BLOCK_SIZE = 2
  const FPS = 24
  const FRAME_INTERVAL = 1000 / FPS
  const CHARS = '01$#!%&@ABCDEFGHIJKLMNO PQRSTUVWXYZ<>[]{}/\\|'

  useEffect(() => {
    scrollYRef.current = scrollY
  }, [scrollY])

  useEffect(() => {
    isActiveRef.current = isActive
    if (isActive && isVisibleRef.current) {
      lastFrameRef.current = 0
      animationFrameRef.current = requestAnimationFrame(renderRef.current)
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
  }, [isActive])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const generateTreeMask = (width: number, height: number) => {
      const cols = Math.ceil(width / CHAR_SIZE)
      const rows = Math.ceil(height / CHAR_SIZE)
      const mask = new Uint8Array(cols * rows)
      const centerX = Math.floor(cols / 2)

      const setPoint = (c: number, r: number, val: number) => {
        if (c >= 0 && c < cols && r >= 0 && r < rows) {
          const idx = r * cols + c
          mask[idx] = Math.max(mask[idx], val)
        }
      }

      const trunkBottom = rows * 0.85
      const trunkTop = rows * 0.2
      const trunkWidth = 6
      for (let r = trunkBottom; r >= trunkTop; r--) {
        for (let dw = -trunkWidth; dw <= trunkWidth; dw++) {
          const intensity = 255 - Math.abs(dw) * 30
          setPoint(centerX + dw, r, intensity)
        }
      }

      const numTiers = 12
      for (let i = 0; i < numTiers; i++) {
        const y = trunkTop + (i / numTiers) * (trunkBottom - trunkTop)
        const reachFactor = Math.sin((i / numTiers) * Math.PI)
        const maxReach = cols * 0.35 * reachFactor

        for (let l = -2; l <= 2; l++) {
          const yOffset = Math.floor(y + l * 2)
          for (let xOffset = -maxReach; xOffset <= maxReach; xOffset++) {
            const dist = Math.abs(xOffset)
            const intensity = 180 * (1 - dist / (maxReach || 1))
            setPoint(centerX + Math.floor(xOffset), yOffset, intensity)
          }
        }
      }

      const canopyCenterY = trunkTop + rows * 0.1
      const canopyWidth = cols * 0.4
      const canopyHeight = rows * 0.35
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = (c - centerX) / canopyWidth
          const dy = (r - canopyCenterY) / canopyHeight
          const dist = dx * dx + dy * dy
          if (dist < 1) {
            if (Math.random() > 0.4) {
              const intensity = (1 - dist) * 255
              setPoint(c, r, intensity)
            }
          }
        }
      }

      for (let i = 0; i < 5; i++) {
        const y = trunkBottom + i * 4
        const reach = cols * 0.15 * (1 + i * 0.2)
        for (let xOffset = -reach; xOffset <= reach; xOffset++) {
          const intensity = 200 * (1 - Math.abs(xOffset) / reach)
          setPoint(centerX + Math.floor(xOffset), y, intensity)
        }
      }

      treeMaskRef.current = mask
    }

    const buildBlockCache = (cols: number, rows: number) => {
      const blockCols = Math.ceil(cols / BLOCK_SIZE)
      const blockRows = Math.ceil(rows / BLOCK_SIZE)
      const totalBlocks = blockCols * blockRows
      const blockChars = new Uint16Array(totalBlocks * 4)
      const blockSeeds = new Uint32Array(totalBlocks)
      let seed = 0x9e3779b9 ^ (cols * 2654435761) ^ rows

      for (let i = 0; i < totalBlocks; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        blockSeeds[i] = seed
        for (let j = 0; j < 4; j++) {
          seed = (seed * 1664525 + 1013904223) >>> 0
          blockChars[i * 4 + j] = seed % CHARS.length
        }
      }

      blockCharsRef.current = blockChars
      blockSeedsRef.current = blockSeeds
      blockColsRef.current = blockCols
      blockRowsRef.current = blockRows
    }

    const handleResize = () => {
      const scaledWidth = Math.max(1, Math.floor(window.innerWidth * RENDER_SCALE))
      const scaledHeight = Math.max(1, Math.floor(window.innerHeight * RENDER_SCALE))
      canvas.width = scaledWidth
      canvas.height = scaledHeight
      const cols = Math.ceil(canvas.width / CHAR_SIZE)
      const rows = Math.ceil(canvas.height / CHAR_SIZE)
      generateTreeMask(canvas.width, canvas.height)
      buildBlockCache(cols, rows)
    }

    const render = (now: number) => {
      if (!isVisibleRef.current || !isActiveRef.current) return
      if (!treeMaskRef.current) return
      if (now - lastFrameRef.current < FRAME_INTERVAL) {
        animationFrameRef.current = requestAnimationFrame(render)
        return
      }
      lastFrameRef.current = now
      const mask = treeMaskRef.current
      const cols = Math.ceil(canvas.width / CHAR_SIZE)
      const rows = Math.ceil(canvas.height / CHAR_SIZE)
      const blockCols = Math.ceil(cols / BLOCK_SIZE)
      const blockRows = Math.ceil(rows / BLOCK_SIZE)

      ctx.fillStyle = isDark ? '#000000' : '#f4f4f5'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.font = `bold ${CHAR_SIZE}px "JetBrains Mono", monospace`

      const time = now * 0.001
      const timeTick = Math.floor(time * 8)
      const scrollOffset = scrollYRef.current * 0.12 * RENDER_SCALE
      const scrollRows = Math.floor(scrollOffset / CHAR_SIZE)
      const scrollRemainder = scrollOffset % CHAR_SIZE
      const blockChars = blockCharsRef.current
      const blockSeeds = blockSeedsRef.current

      if (!blockChars || !blockSeeds || blockColsRef.current !== blockCols || blockRowsRef.current !== blockRows) {
        buildBlockCache(cols, rows)
      }

      for (let br = 0; br < blockRows; br++) {
        const baseR = br * BLOCK_SIZE
        const sourceR0 = baseR + scrollRows
        const displayY0 = baseR * CHAR_SIZE - scrollRemainder

        for (let bc = 0; bc < blockCols; bc++) {
          const blockIndex = br * blockCols + bc
          const blockSeed = blockSeedsRef.current?.[blockIndex] ?? 0
          const phase = (timeTick + (blockSeed & 3)) & 3
          const baseC = bc * BLOCK_SIZE

          for (let rOffset = 0; rOffset < BLOCK_SIZE; rOffset++) {
            const sourceR = sourceR0 + rOffset
            if (sourceR < 0 || sourceR >= rows) continue
            const displayY = displayY0 + rOffset * CHAR_SIZE

            for (let cOffset = 0; cOffset < BLOCK_SIZE; cOffset++) {
              const c = baseC + cOffset
              if (c >= cols) continue
              const maskValue = mask[sourceR * cols + c]
              if (maskValue === 0) continue

              const flicker = Math.sin(time * 12 + sourceR * 0.4 + c * 0.2)
              const intensity = (maskValue / 255) * (0.5 + 0.5 * (flicker * 0.5 + 0.5))

              const isTrunk = Math.abs(c - Math.floor(cols / 2)) < 6
              const charSet = isTrunk ? '01' : CHARS
              const cellIndex = rOffset * BLOCK_SIZE + cOffset
              const charIndex = blockCharsRef.current
                ? blockCharsRef.current[blockIndex * 4 + ((cellIndex + phase) & 3)]
                : 0
              const char = charSet[charIndex % charSet.length]

              const sparkleSeed = (blockSeed + cellIndex * 17 + timeTick * 131) & 31
              if (intensity > 0.9 && sparkleSeed === 0) {
                ctx.fillStyle = isDark ? `rgba(0, 120, 255, ${intensity})` : `rgba(0, 82, 255, ${intensity})`
              } else {
                ctx.fillStyle = isDark
                  ? `rgba(255, 255, 255, ${intensity * 0.9})`
                  : `rgba(40, 40, 40, ${intensity * 0.7})`
              }

              ctx.fillText(char, c * CHAR_SIZE, displayY)
            }
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(render)
    }

    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible'
      isVisibleRef.current = isVisible
      if (isVisible && isActiveRef.current) {
        lastFrameRef.current = 0
        animationFrameRef.current = requestAnimationFrame(render)
      } else if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }

    renderRef.current = render
    window.addEventListener('resize', handleResize)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    handleResize()
    animationFrameRef.current = requestAnimationFrame(render)

    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      cancelAnimationFrame(animationFrameRef.current)
    }
  }, [isDark])

  return (
    <div className='fixed inset-0 z-0 pointer-events-none'>
      <canvas
        ref={canvasRef}
        className='w-full h-full transition-opacity duration-1000'
        style={{ filter: isDark ? 'contrast(1.2) brightness(1.1)' : 'contrast(1.1) brightness(1.0)' }}
      />
      <div
        className='absolute inset-0 opacity-80'
        style={{
          backgroundImage: `radial-gradient(ellipse at center, transparent 20%, ${isDark ? '#000000' : '#f4f4f5'} 90%)`,
        }}
      />
    </div>
  )
}
