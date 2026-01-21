import React, { useEffect, useRef, useState } from 'react'
import { AsciiBackground } from '../components/landing/AsciiBackground'
import { Comparison } from '../components/landing/Comparison'
import { Economics } from '../components/landing/Economics'
import { Features } from '../components/landing/Features'
import { Footer } from '../components/landing/Footer'
import { Hero } from '../components/landing/Hero'
import { Navbar } from '../components/landing/Navbar'
import { ScrollReveal } from '../components/landing/ScrollReveal'

const LandingPage: React.FC = () => {
  const [scrollY, setScrollY] = useState(0)
  const [isAsciiActive, setIsAsciiActive] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const storedTheme = window.localStorage.getItem('theme')
    if (storedTheme === 'dark' || storedTheme === 'light') {
      return storedTheme === 'dark'
    }
    return document.documentElement.classList.contains('dark') || true
  })

  useEffect(() => {
    const container = scrollContainerRef.current
    const handleScroll = () => {
      if (container) {
        setScrollY(container.scrollTop)
      } else {
        setScrollY(window.scrollY)
      }
    }

    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true })
    }

    handleScroll()
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll)
      } else {
        window.removeEventListener('scroll', handleScroll)
      }
    }
  }, [])

  useEffect(() => {
    const heroElement = heroRef.current
    if (!heroElement) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsAsciiActive(entry.isIntersecting)
      },
      { root: scrollContainerRef.current, threshold: 0.15 }
    )

    observer.observe(heroElement)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', isDark)
    window.localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const toggleTheme = () => {
    setIsDark(current => !current)
  }

  return (
    <div
      ref={scrollContainerRef}
      className='relative h-full min-h-screen overflow-y-auto selection:bg-[#0052FF] selection:text-white transition-colors duration-500 font-inter overflow-x-hidden'
    >
      <AsciiBackground scrollY={scrollY} isDark={isDark} isActive={isAsciiActive} />

      <div className='relative z-10'>
        <Navbar onToggleTheme={toggleTheme} isDark={isDark} />

        <main>
          <div ref={heroRef}>
            <Hero />
          </div>

          <section
            id='features'
            className='py-24 px-6 md:px-12 bg-white dark:bg-black transition-colors duration-500 border-y border-zinc-200 dark:border-zinc-900'
          >
            <div className='max-w-7xl mx-auto'>
              <ScrollReveal className='mb-20'>
                <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[18px]'>
                  [ System Architecture ]
                </span>
                <h2 className='text-5xl md:text-7xl font-black mt-4 leading-tight text-zinc-900 dark:text-white'>
                  UNIFIED
                  <br />
                  INTELLIGENCE.
                </h2>
                <p className='mt-8 text-2xl text-zinc-600 dark:text-zinc-400 max-w-2xl leading-relaxed'>
                  Not just a chat interface or a simple agent—a complete operating layer for AI-native work. Every
                  model, every tool, one workspace.
                </p>
              </ScrollReveal>

              <Features />
            </div>
          </section>

          <section
            id='economics'
            className='py-24 px-6 md:px-12 bg-zinc-50 dark:bg-zinc-950 transition-colors duration-500'
          >
            <div className='max-w-7xl mx-auto'>
              <ScrollReveal className='mb-16'>
                <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[18px]'>
                  [ Unit Economics ]
                </span>
                <h2 className='text-5xl md:text-6xl font-black mt-4 text-zinc-900 dark:text-white uppercase tracking-tighter'>
                  True Scaling.
                </h2>
                <p className='mt-4 text-2xl text-zinc-500 dark:text-zinc-400 font-medium italic'>
                  Yggdrasil is the only agent orchestrator in market that scales efficiently
                </p>
              </ScrollReveal>
              <Economics />
            </div>
          </section>

          <section
            id='comparison'
            className='py-24 px-6 md:px-12 bg-white dark:bg-black transition-colors duration-500 border-y border-zinc-200 dark:border-zinc-900'
          >
            <div className='max-w-7xl mx-auto'>
              <ScrollReveal className='mb-16'>
                <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[18px]'>
                  [ Market Realities ]
                </span>
                <h2 className='text-5xl md:text-6xl font-black mt-4 text-zinc-900 dark:text-white uppercase tracking-tighter'>
                  The Agent Divergence.
                </h2>
              </ScrollReveal>
              <Comparison />
            </div>
          </section>
        </main>

        <Footer isDark={isDark} />
      </div>
    </div>
  )
}

export default LandingPage
