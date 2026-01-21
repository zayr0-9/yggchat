import React, { useEffect, useRef } from 'react'

interface ChatDemoProps {
  isDark: boolean
  onDownload: () => void
}

const DotMatrixIcon: React.FC<{ isDark: boolean; type: 'tree' | 'small-download' }> = ({ isDark, type }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrame: number
    let frame = 0

    const isSmall = type === 'small-download'
    const dotSize = isSmall ? 1.4 : 3
    const gap = isSmall ? 0.8 : 2
    const step = dotSize + gap

    const render = () => {
      frame += 1
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const cols = Math.floor(canvas.width / step)
      const rows = Math.floor(canvas.height / step)

      if (type === 'tree') {
        const centerX = cols / 2
        const bottomY = rows - 2
        const drawBranch = (x: number, y: number, length: number, angle: number, depth: number) => {
          if (depth <= 0) return
          for (let i = 0; i < length; i++) {
            const px = x + Math.cos(angle) * i
            const py = y - Math.sin(angle) * i
            const gridX = Math.round(px)
            const gridY = Math.round(py)
            if (gridX >= 0 && gridX < cols && gridY >= 0 && gridY < rows) {
              const pulse = Math.sin(frame * 0.05 + (gridX + gridY) * 0.1) * 0.5 + 0.5
              const opacity = (depth / 8) * (0.3 + 0.7 * pulse)
              ctx.fillStyle = isDark ? `rgba(0, 82, 255, ${opacity})` : `rgba(0, 82, 255, ${opacity * 0.8})`
              ctx.fillRect(gridX * step, gridY * step, dotSize, dotSize)
            }
          }
          const nextX = x + Math.cos(angle) * length
          const nextY = y - Math.sin(angle) * length
          const newLength = length * 0.75
          const spread = 0.4 + Math.sin(frame * 0.01) * 0.1
          drawBranch(nextX, nextY, newLength, angle - spread, depth - 1)
          drawBranch(nextX, nextY, newLength, angle + spread, depth - 1)
        }

        drawBranch(centerX, bottomY, rows * 0.25, Math.PI / 2, 8)
      } else {
        const centerX = Math.floor(cols / 2)
        const arrowHeight = Math.floor(rows * 0.55)
        const time = frame * 0.08
        const movement = Math.sin(time) * 1.2

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const adjustedR = r - movement - rows * 0.1
            const isShaft = c === centerX && adjustedR < arrowHeight && adjustedR > 0
            const isHead =
              adjustedR >= arrowHeight && Math.abs(c - centerX) <= Math.floor((adjustedR - arrowHeight) * 1.2)

            if (isShaft || isHead) {
              ctx.fillStyle = `rgba(0, 82, 255, ${0.7 + 0.3 * Math.sin(time + r * 0.5)})`
              ctx.fillRect(c * step, r * step, dotSize, dotSize)
            }
          }
        }
      }

      animationFrame = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animationFrame)
  }, [isDark])

  const width = type === 'tree' ? 400 : 16
  const height = type === 'tree' ? 250 : 16

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={type === 'tree' ? 'max-w-full h-auto opacity-70' : 'shrink-0'}
    />
  )
}

export const ChatDemo: React.FC<ChatDemoProps> = ({ isDark, onDownload }) => {
  return (
    <div className='bg-white dark:bg-black border-2 border-zinc-300 dark:border-zinc-800 rounded-none overflow-hidden flex flex-col h-[420px] shadow-2xl relative transition-colors duration-500'>
      <div className='bg-zinc-200 dark:bg-zinc-800 p-3 flex justify-between items-center px-6 transition-colors duration-500'>
        <div className='flex items-center gap-4'>
          <div className='flex gap-2'>
            <div className='w-2 h-2 rounded-full bg-red-500' />
            <div className='w-2 h-2 rounded-full bg-yellow-500' />
            <div className='w-2 h-2 rounded-full bg-green-500' />
          </div>
          <span className='mono text-[10px] text-zinc-500 uppercase tracking-widest hidden sm:inline'>
            root@yggdrasil:~/branch-matrix
          </span>
        </div>

        <div className='mono text-[8px] text-zinc-400 uppercase font-black px-2 py-1 border border-zinc-300 dark:border-zinc-700'>
          TREE_SYNC
        </div>
      </div>

      <div className='flex-1 flex flex-col items-center justify-center gap-5 p-6 mono text-sm text-zinc-500 dark:text-zinc-400'>
        <DotMatrixIcon isDark={isDark} type='tree' />
        <span className='uppercase tracking-widest text-[10px] text-[#0052FF]'>[ BRANCH MATRIX ONLINE ]</span>
        <button
          type='button'
          onClick={onDownload}
          className='flex items-center gap-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-[#0052FF] dark:hover:border-[#0052FF] px-4 py-2 transition-all duration-300 group hover:translate-x-1'
        >
          <DotMatrixIcon isDark={isDark} type='small-download' />
          <span className='mono text-[10px] font-black uppercase tracking-widest text-[#0052FF]'>Download Now</span>
          {/* <span className='mono text-[9px] text-zinc-400 dark:text-zinc-600 font-bold'>[MB]</span> */}
        </button>
      </div>

      <div className='absolute inset-0 pointer-events-none opacity-[0.05] dark:opacity-[0.03] bg-[radial-gradient(#000_1px,transparent_1px)] dark:bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]' />
    </div>
  )
}
