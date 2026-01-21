import React, { useEffect, useRef, useState } from 'react'

interface RevealCardProps {
  children: React.ReactNode
  className?: string
  delayClass?: string
}

const RevealCard: React.FC<RevealCardProps> = ({ children, className = '', delayClass = '' }) => {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.1 }
    )

    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={`reveal ${className} ${delayClass} ${isVisible ? 'active' : ''}`.trim()}>
      {children}
    </div>
  )
}

export const Features: React.FC = () => {
  return (
    <div className='grid grid-cols-1 md:grid-cols-12 gap-6'>
      <RevealCard className='md:col-span-8 h-[400px] bg-[#0052FF] p-10 flex flex-col justify-between relative overflow-hidden group'>
        <div className='relative z-10'>
          <div className='w-12 h-12 border-2 border-white flex items-center justify-center mb-6'>
            <span className='font-black text-white'>01</span>
          </div>
          <h3 className='text-4xl md:text-5xl font-black text-white leading-tight'>
            CUSTOM
            <br />
            AI APPS
          </h3>
        </div>
        <p className='relative z-10 text-white text-lg max-w-sm font-medium leading-relaxed'>
          Turn ideas into working tools in under 20 minutes. From Excel analyzers to email agents -- build custom AI
          apps that connect to your local files, APIs, and workflows. No dev team required.
        </p>

        <div className='absolute inset-0 opacity-20 mono text-[8px] leading-[8px] pointer-events-none p-2 break-all overflow-hidden select-none group-hover:opacity-40 transition-opacity'>
          {Array.from({ length: 50 }).map((_, i) => (
            <div key={i}>{Math.random().toString(36).substring(2).repeat(10)}</div>
          ))}
        </div>
      </RevealCard>

      <RevealCard
        delayClass='reveal-delayed-1'
        className='md:col-span-4 h-[400px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-10 flex flex-col justify-between border-t-4 border-t-[#0052FF] transition-colors duration-500'
      >
        <h3 className='text-3xl font-bold uppercase tracking-tighter text-zinc-900 dark:text-white'>
          Parallel
          <br />
          Thinking
        </h3>
        <p className='text-zinc-600 dark:text-zinc-500 text-[17px] leading-relaxed'>
          Stop waiting for linear chat. Fork conversations instantly to explore multiple approaches simultaneously. Each
          branch stays focused -- keeping the AI sharp and your costs low.
        </p>
        <div className='pt-8 flex justify-end items-end'>
          <div className='text-5xl font-black text-zinc-200 dark:text-zinc-800 tracking-tighter'>02</div>
        </div>
      </RevealCard>

      <RevealCard className='md:col-span-4 h-[350px] bg-emerald-50 dark:bg-emerald-900/40 border border-emerald-100 dark:border-emerald-900 p-8 flex flex-col justify-between transition-colors duration-500'>
        <h3 className='text-2xl font-bold uppercase text-emerald-900 dark:text-emerald-100'>
          Local-First
          <br />
          Privacy
        </h3>
        <p className='text-emerald-700 dark:text-emerald-400 text-[17px]'>
          Your data never leaves your machine. Yggdrasil processes logic in the cloud but keeps sensitive files on your
          hardware. Full support for local LLMs via LM Studio -- air-gapped reasoning when you need it.
        </p>
        <div className='text-5xl font-black text-emerald-100 dark:text-emerald-800/30'>03</div>
      </RevealCard>

      <RevealCard
        delayClass='reveal-delayed-1'
        className='md:col-span-4 h-[350px] bg-red-50 dark:bg-red-900/40 border border-red-100 dark:border-red-900 p-8 flex flex-col justify-between transition-colors duration-500'
      >
        <h3 className='text-2xl font-bold uppercase text-red-900 dark:text-red-100'>
          Every Model
          <br />
          One Interface
        </h3>
        <p className='text-red-700 dark:text-red-400 text-[17px]'>
          GPT-4, Claude, Gemini, Llama -- access them all through a single workspace. Mix and match models per task. No
          vendor lock-in, no juggling subscriptions.
        </p>
        <div className='text-5xl font-black text-red-100 dark:text-red-800/30'>04</div>
      </RevealCard>

      <RevealCard
        delayClass='reveal-delayed-2'
        className='md:col-span-4 h-[350px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 flex flex-col justify-between transition-colors duration-500'
      >
        <div>
          <h3 className='text-2xl font-bold uppercase text-zinc-900 dark:text-white tracking-tighter'>
            Agent
            <br />
            Orchestration
          </h3>
        </div>
        <p className='text-zinc-600 dark:text-zinc-500 text-[17px] leading-relaxed'>
          Chain specialized agents that work in parallel. Download a video, transcribe audio, cross-reference with your
          spreadsheet, and generate a report -- executed in one turn, not ten.
        </p>
        <div className='text-5xl font-black text-zinc-300 dark:text-zinc-700 transition-colors duration-500'>05</div>
      </RevealCard>
    </div>
  )
}
