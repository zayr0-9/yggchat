import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../components/Button/button'
import { getAssetPath } from '../utils/assetPath'
gsap.registerPlugin(MotionPathPlugin)

interface Feature {
  id: number
  title: string
  superscript: string
  description: string[]
  videoSrc?: string
}

const PATH_IDS = [1, 2, 3, 4, 5, 6] as const
const PATH_DEFS: Record<(typeof PATH_IDS)[number], string> = {
  1: 'M 100 300 L 210 100 L 330 100 L 450 40 L 590 40',
  2: 'M 100 300 L 210 100 L 330 100 L 450 160 L 590 160',
  3: 'M 100 300 L 210 300 L 330 300 L 450 250 L 590 250',
  4: 'M 100 300 L 210 300 L 330 300 L 450 350 L 590 350',
  5: 'M 100 300 L 210 500 L 330 500 L 450 440 L 590 440',
  6: 'M 100 300 L 210 500 L 330 500 L 450 560 L 590 560',
}
const FALLBACK_PATH_LENGTHS: Record<(typeof PATH_IDS)[number], number> = {
  1: 623, // p1: steep climb to top
  2: 557, // p2: climb to upper-middle
  3: 500, // p3: mostly horizontal, slight rise
  4: 500, // p4: mostly horizontal, slight drop
  5: 557, // p5: drop to lower-middle
  6: 623, // p6: steep drop to bottom
}
const DOT_SPEED_PX_PER_SEC = 100

const LandingPage: React.FC = () => {
  const navigate = useNavigate()

  const features = useMemo<Feature[]>(
    () => [
      {
        id: 1,
        title: 'Branch: Never Abandon Work Again',
        superscript: '01',
        description: [
          'Break linear traps → Branch from any message to explore alternatives without losing progress. Discover a dead-end? Roll back instantly and reroll from any promising point in history.',
          'Parallel experimentation → Run multiple solution paths in parallel branches. Compare architectural approaches side-by-side before committing code.',
          'Immutable audit trail → Every edit spawns a new branch. Full provenance of how decisions evolved—critical for debugging and compliance.',
        ],
        videoSrc: getAssetPath('video/branching.webm'),
      },
      {
        id: 2,
        title: 'Context Management: Cut Costs, Eliminate Hallucinations',
        superscript: '02',
        description: [
          `Branch-isolated costs → Pay only for tokens in the active branch. No auto-compression, no hidden overhead.`,
          'Manual curation → You choose what context to keep. No black-box algorithms—full deterministic control.',
          `Zero drift → Keeping context short via branches, eliminates context contamination and model hallucinations`,
        ],
        videoSrc: getAssetPath('video/branchactions.webm'),
      },
      {
        id: 3,
        title: 'Agentic Control: Autonomous Execution, Human Oversight',
        superscript: '03',
        description: [
          'Zero-overhead branch separation → Dedicate one branch to planning, another to agent execution. Distribute tasks manually with full visibility— with complete manual state management.',
          'Stateful task execution → Agents maintain precise context across complex multi-step workflows without bloating costs.',
          'Complete permission system → Lock agents to specific tools. Every action is permissioned, no blind trust, no overreach. Stay safe in Chat mode for planning before execution.',
        ],
        videoSrc: getAssetPath('video/agent.webm'),
      },
      {
        id: 4,
        title: 'Model Routing: Eliminate LLM Inconsistency',
        superscript: '04',
        description: [
          'Dynamic model selection → Route specific tasks to optimal models in real-time—Claude 4.5 for reasoning, GPT-5-mini for speed, or specialized models for literature, image etc.',
          'Branch-level comparison → Spawn branches to test the same prompt across models simultaneously. A/B test outputs without restarting conversations.',
          'Cost-performance optimization → Automatically downgrade models for low-risk tasks and upgrade for critical decisions—cut spend without sacrificing quality.',
        ],
        videoSrc: getAssetPath('video/models.webm'),
      },
    ],
    []
  )

  const [isDarkMode, setIsDarkMode] = useState(false)
  const [activeFeatureIndex, setActiveFeatureIndex] = useState(0)
  const [isInFeaturesSection, setIsInFeaturesSection] = useState(false)
  const featureRefs = useRef<(HTMLDivElement | null)[]>([])
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // const featuresContainerRef = useRef<HTMLDivElement>(null)
  const featuresSectionRef = useRef<HTMLElement>(null)
  const [loadedVideos, setLoadedVideos] = useState<boolean[]>(() => new Array(features.length).fill(false))
  const videoWrappersRef = useRef<(HTMLDivElement | null)[]>([])
  const videoElementsRef = useRef<(HTMLVideoElement | null)[]>([])
  const prevLoadedVideosRef = useRef<boolean[]>(new Array(features.length).fill(false))
  const observerRef = useRef<IntersectionObserver | null>(null)
  const [expandedVideoSrc, setExpandedVideoSrc] = useState<string | null>(null)
  const [highlightedPath, setHighlightedPath] = useState<number>(1)
  const pathLengthsRef = useRef<Record<number, number>>(FALLBACK_PATH_LENGTHS)
  const [pathLengthsVersion, setPathLengthsVersion] = useState(0)
  const heroSvgRef = useRef<SVGSVGElement | null>(null)
  const dotRef = useRef<SVGCircleElement | null>(null)
  const dotGroupRef = useRef<SVGGElement | null>(null)
  const pathRefs = useRef<(SVGPathElement | null)[]>([])
  const timelineRef = useRef<gsap.core.Timeline | null>(null)

  // Text labels for each path
  const pathLabels = useMemo(
    () => ({
      1: 'Should I use REST or GraphQL?',
      2: 'How does GraphQL work?',
      3: 'How does JWT auth work?',
      4: 'Compare JWT vs OAuth2',
      5: 'Handle token expiration',
      6: 'Deploy auth to production',
    }),
    []
  )

  // Path data derived from measured lengths (fallback to constants)
  // const pathData = useMemo(() => {
  //   const lengths = pathLengthsRef.current
  //   return Object.fromEntries(
  //     Object.entries(lengths).map(([id, length]) => [
  //       Number(id),
  //       { length, duration: (length / DOT_SPEED_PX_PER_SEC) * 1000 }, // duration in ms
  //     ])
  //   ) as Record<number, { length: number; duration: number }>
  // }, [pathLengthsVersion])

  // Measure path lengths once SVG is in the DOM
  useEffect(() => {
    if (!heroSvgRef.current) return

    const paths = pathRefs.current.filter(Boolean) as SVGPathElement[]
    if (!paths.length) return

    const measured: Record<number, number> = { ...FALLBACK_PATH_LENGTHS }
    paths.forEach((pathEl, idx) => {
      if (pathEl && typeof pathEl.getTotalLength === 'function') {
        measured[idx + 1] = pathEl.getTotalLength()
      }
    })

    pathLengthsRef.current = measured
    setPathLengthsVersion(v => v + 1)
  }, [])

  // Build GSAP timeline once paths are measured
  useEffect(() => {
    if (!heroSvgRef.current) return
    if (timelineRef.current) {
      timelineRef.current.kill()
      timelineRef.current = null
    }

    const paths: SVGPathElement[] = PATH_IDS.map((id, idx) => {
      const p = heroSvgRef.current?.querySelector(`#p${id}`) as SVGPathElement | null
      pathRefs.current[idx] = p
      return p
    }).filter(Boolean) as SVGPathElement[]

    if (!paths.length || !dotGroupRef.current) return

    const tl = gsap.timeline({ repeat: -1, defaults: { ease: 'power1.inOut' } })

    paths.forEach((pathEl, idx) => {
      const duration = pathEl.getTotalLength() / DOT_SPEED_PX_PER_SEC
      const fadeDuration = 0.5

      // Update highlighted path at the start
      tl.add(() => setHighlightedPath(PATH_IDS[idx]))

      // Fade in
      tl.fromTo(
        dotGroupRef.current,
        { opacity: 0 },
        {
          opacity: 1,
          duration: fadeDuration,
          ease: 'power2.out',
        }
      )

      // Travel along the path - starts at same time as fade-in (overlapped)
      tl.to(
        dotGroupRef.current,
        {
          motionPath: {
            path: pathEl,
            align: pathEl,
            alignOrigin: [0.5, 0.85],
            autoRotate: false,
          },
          duration,
        },
        `-=${fadeDuration}`
      )

      // Fade out - starts before travel ends (overlapped)
      tl.to(
        dotGroupRef.current,
        {
          opacity: 0,
          duration: fadeDuration,
          ease: 'power2.in',
        },
        `-=${fadeDuration}`
      )
    })

    timelineRef.current = tl

    return () => {
      tl.kill()
      timelineRef.current = null
    }
  }, [pathLengthsVersion])

  // Initialize theme
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark')
    setIsDarkMode(isDark)
  }, [])

  useEffect(() => {
    const initialState = features.map(feature => !feature.videoSrc)
    setLoadedVideos(initialState)
    prevLoadedVideosRef.current = initialState
  }, [features])

  // Monitor scroll position for features section and active feature
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (!featuresSectionRef.current) return

      const rect = featuresSectionRef.current.getBoundingClientRect()
      const isInSection = rect.top <= 0 && rect.bottom > window.innerHeight / 2
      setIsInFeaturesSection(isInSection)

      // Find the most visible feature
      let maxVisibleIndex = 0
      let maxVisibleRatio = 0

      featureRefs.current.forEach((ref, index) => {
        if (!ref) return
        const rect = ref.getBoundingClientRect()
        const visibleRatio =
          Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) / window.innerHeight

        if (visibleRatio > maxVisibleRatio) {
          maxVisibleRatio = visibleRatio
          maxVisibleIndex = index
        }
      })

      if (maxVisibleRatio > 0.1) {
        setActiveFeatureIndex(maxVisibleIndex)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!('IntersectionObserver' in window)) {
      setLoadedVideos(features.map(feature => !feature.videoSrc))
      return
    }

    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          const index = videoWrappersRef.current.findIndex(ref => ref === entry.target)
          if (index === -1) return

          setLoadedVideos(prev => {
            if (prev[index]) return prev
            const next = [...prev]
            next[index] = true
            return next
          })

          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '200px 0px', threshold: 0.35 }
    )

    observerRef.current = observer
    videoWrappersRef.current.forEach(ref => {
      if (ref) observer.observe(ref)
    })

    return () => observer.disconnect()
  }, [features])

  useEffect(() => {
    const nextPrev = [...prevLoadedVideosRef.current]
    loadedVideos.forEach((isLoaded, index) => {
      if (!isLoaded || nextPrev[index]) return
      const videoEl = videoElementsRef.current[index]
      if (videoEl) {
        videoEl.load()
        videoEl.play().catch(() => {})
      }
      nextPrev[index] = true
    })
    prevLoadedVideosRef.current = nextPrev
  }, [loadedVideos])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedVideoSrc(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    document.body.style.overflow = expandedVideoSrc ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [expandedVideoSrc])

  const handleFeatureClick = (index: number) => {
    const targetElement = featureRefs.current[index]
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const toggleTheme = () => {
    const htmlElement = document.documentElement
    htmlElement.classList.toggle('dark')
    const newIsDarkMode = !isDarkMode
    setIsDarkMode(newIsDarkMode)
    localStorage.setItem('theme', newIsDarkMode ? 'dark' : 'light')
  }

  const handleExpandedVideoClose = () => {
    setExpandedVideoSrc(null)
  }

  const handleNavigation = (path: string) => {
    if (path.startsWith('#')) {
      const element = document.querySelector(path)
      element?.scrollIntoView({ behavior: 'smooth' })
    } else {
      navigate(path)
    }
  }

  const handleTryNow = () => {
    navigate('/login')
  }

  return (
    <div
      ref={scrollContainerRef}
      className='w-full h-full dark:bg-black/40 dark:bg-black/40 overflow-y-auto min-h-screen'
    >
      {/* Header Navigation */}
      <nav className='sticky top-0 rounded-b-2xl z-30 flex items-center justify-end sm:justify-between px-6 sm:px-4 md:px-8 py-2 md:py-3 bg-transparent dark:bg-transparent transition-all duration-300'>
        {/* Logo */}
        {/* <div className='flex items-center flex-wrap gap-3 rounded-full'>
          <img
            src='/img/logo-l.svg'
            alt='Yggdrasil Logo'
            className='w-14 h-14 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-18 lg:h-18 xl:w-20 xl:h-20 2xl:w-22 2xl:h-22 dark:hidden rounded-full shadow-[0_2px_16px_3px_rgba(0,0,0,0.25)]'
          />
          <img
            src='/img/logo-l.svg'
            alt='Yggdrasil Logo'
            className='w-14 h-14 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-18 lg:h-18 xl:w-20 xl:h-20 2xl:w-22 2xl:h-22  hidden dark:block rounded-full dark:shadow-[0_2px_16px_3px_rgba(0,0,0,0.25)]'
          />
        </div> */}

        {/* Center Navigation Links */}
        <div className='hidden md:flex items-center gap-2 lg:gap-2 xl:gap-2 '>
          <button
            onClick={() => handleNavigation('#features')}
            className={` ${isInFeaturesSection ? 'text-black' : 'text-white'} dark:text-gray-200 hover:bg-neutral-200/30 rounded-2xl p-2 px-3 active:scale-97 dark:hover:text-neutral-50 transition-colors duration-200 font-medium`}
          >
            Features
          </button>
          <button
            onClick={() => handleNavigation('/paymentplan')}
            className={`${isInFeaturesSection ? 'text-black' : 'text-white'} dark:text-gray-200 hover:bg-neutral-200/30 rounded-2xl p-2 px-3 active:scale-97 dark:hover:text-neutral-50 transition-colors duration-200 font-medium`}
          >
            Pricing
          </button>
          <button
            onClick={() => handleNavigation('/faq')}
            className={`${isInFeaturesSection ? 'text-black' : 'text-white'} dark:text-gray-200 hover:bg-neutral-200/30 rounded-2xl p-2 px-3 active:scale-97 dark:hover:text-neutral-50 transition-colors duration-200 font-medium`}
          >
            FAQ
          </button>
          <button
            onClick={() => handleNavigation('/blog')}
            className={`${isInFeaturesSection ? 'text-black' : 'text-white'} dark:text-gray-200 hover:bg-neutral-200/30 rounded-2xl p-2 px-3 active:scale-97 dark:hover:text-neutral-50 transition-colors duration-200 font-medium`}
          >
            Blog
          </button>
        </div>

        {/* Right Side - Theme Toggle & Login */}
        <div className='flex items-center gap-2 md:gap-2 xl:gap-4'>
          {/* Theme Toggle Button */}
          <Button
            onClick={toggleTheme}
            variant='outline2'
            size='circle'
            className='hover:scale-110 transition-all duration-200 hover:bg-transparent dark:hover:bg-transparent'
            rounded='lg'
            aria-label='Toggle theme'
          >
            <div className='relative w-10 h-10'>
              <div
                className={`        absolute inset-0 bg-gradient-to-br from-yellow-300 to-orange-400 
        rounded-full transition-all duration-500 ease-in-out
${isDarkMode ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}
      `}
              />
              <div
                className={`
        absolute inset-0 bg-gradient-to-br from-blue-200 to-indigo-300 
        rounded-full transition-all duration-500 ease-in-out
${isDarkMode ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}
      `}
                style={{
                  mask: isDarkMode
                    ? 'radial-gradient(circle at 70% 50%, transparent 40%, black 40%)' // Changed from 30% to 70%
                    : 'none',
                }}
              />
            </div>
          </Button>

          {/* Login Button */}
          <Button
            onClick={() => navigate('/login')}
            variant='outline2'
            size='large'
            className={`hover:scale-110 ${isInFeaturesSection ? 'text-black' : 'text-white'} hover:bg-neutral-200/40 transition-all duration-200 dark:hover:bg-transparent`}
          >
            Login
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className='relative h-screen bg-transparent overflow-hidden'>
        {/* Subtle pattern overlay */}
        {/* <div
          className='absolute inset-0 opacity-30 dark:opacity-20'
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            backgroundSize: '30px 30px',
          }}
        /> */}

        {/* Hero Section */}
        <div className='relative z-10 md:h-full grid grid-cols-1 md:grid-cols-2 px-4 sm:px-6 lg:px-12'>
          {/* Left Side - Logo, Heading, Subheading */}
          <div className='flex flex-col sm:mt-7 2xl:mt-25 items-start md:pt-16 md:pt-0'>
            <div className='flex items-center gap-4 lg:gap-6'>
              <img
                src={getAssetPath('img/logo-l-thick.svg')}
                alt='Yggdrasil Logo'
                className='acrylic-light-dark w-22 h-22 sm:w-16 sm:h-16 md:w-18 md:h-18 lg:w-24 lg:h-24 xl:w-28 xl:h-28 2xl:w-32 2xl:h-32 dark:block rounded-full dark:shadow-[0_2px_16px_3px_rgba(0,0,0,0.25)]'
              />
              <h1 className='text-5xl pb-3 2xl:pb-7 sm:text-6xl md:text-6xl lg:text-7xl xl:text-8xl 2xl:text-[104px] text-white dark:text-white drop-shadow-lg'>
                yggdrasil
              </h1>
            </div>

            {/* Tagline */}
            <p className='text-[24px] mt-8 pl-2 sm:text-lg md:text-xl lg:text-[42px] text-white dark:text-gray-100 max-w-xl leading-relaxed drop-shadow-md font-light'>
              AI Chat / Agent / Workflow Builder
            </p>

            <p className='text-[16px] acrylic-ultra-light-nolight rounded-4xl mt-6 py-5 pr-20 pl-6 sm:text-lg md:text-xl lg:text-[26px] text-white dark:text-gray-100 max-w-2xl leading-[2.5rem] 2xl:leading-[3.5rem] font-light'>
              Parallel Branching Conversations <br />
              Upto 80% Context Cost Reduction <br />
              400+ Models <br />
              13 million tokens with GPT-5.1 codex max <br />
              Private Local-First Storage <br />
              <a
                href='https://marketplace.visualstudio.com/items?itemName=YggdrasilAI97.yggdrasil-extension'
                target='_blank' // open in a new tab
                rel='noopener noreferrer' // security best‑practice
                className='text-blue-400 hover:underline'
              >
                Code Context With IDE Extension{' '}
                <i className='bx bx-link-external text-sm relative right-1.5 -top-3'></i>
              </a>{' '}
              <br />
              Claude Code Support
            </p>
          </div>

          {/* Right Side - Animated SVG with GSAP */}
          <div className='flex items-start w-full max-w-md md:max-w-full pt-12 2xl:pt-45'>
            <svg
              ref={heroSvgRef}
              viewBox='-50 0 800 600'
              xmlns='http://www.w3.org/2000/svg'
              className='acrylic-ultra-light-nolight rounded-4xl w-full h-auto'
            >
              <defs>
                <filter id='glow' x='-50%' y='-50%' width='200%' height='200%'>
                  <feGaussianBlur stdDeviation='5' result='coloredBlur' />
                  <feMerge>
                    <feMergeNode in='coloredBlur' />
                    <feMergeNode in='SourceGraphic' />
                  </feMerge>
                </filter>
                <filter id='glowBright' x='-100%' y='-100%' width='300%' height='300%'>
                  <feGaussianBlur stdDeviation='8' result='coloredBlur' />
                  <feMerge>
                    <feMergeNode in='coloredBlur' />
                    <feMergeNode in='coloredBlur' />
                    <feMergeNode in='SourceGraphic' />
                  </feMerge>
                </filter>
              </defs>

              {/* All paths as dotted lines */}
              <g
                fill='none'
                stroke='rgba(255, 255, 255, 0.27)'
                strokeWidth='2'
                strokeDasharray='4,4'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                {PATH_IDS.map(i => (
                  <path
                    key={`path-${i}`}
                    id={`p${i}`}
                    ref={el => {
                      pathRefs.current[i - 1] = el
                    }}
                    d={PATH_DEFS[i]}
                  />
                ))}
              </g>

              {/* Active path highlight */}
              <path
                d={PATH_DEFS[highlightedPath]}
                fill='none'
                stroke='rgba(255,255,255,0.8)'
                strokeWidth='3'
                strokeLinecap='round'
                strokeLinejoin='round'
                filter='url(#glow)'
              />

              {/* Traveling dot controlled by GSAP */}
              <g id='dot-group' ref={dotGroupRef}>
                <circle ref={dotRef} r='7' fill='#ff6600ff' fillOpacity='0.9' filter='url(#glowBright)' />
                <text
                  transform='translate(0, -20)'
                  textAnchor='middle'
                  fontFamily='system-ui, sans-serif'
                  fontSize='12'
                  fill='#fff'
                >
                  {pathLabels[highlightedPath as keyof typeof pathLabels] || pathLabels[1]}
                </text>
              </g>
            </svg>
          </div>

          {/* Scroll Indicator */}
          <div className='absolute -bottom-20 2xl:mb-20 md:bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce'>
            <span className='text-white dark:text-gray-300 text-xs md:text-sm font-medium '>Scroll to explore</span>
            <i className='bx bx-chevron-down text-white dark:text-gray-300 text-2xl'></i>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section
        ref={featuresSectionRef}
        id='features'
        className={`transition-colors duration-500 pt-20 ${
          isInFeaturesSection
            ? 'bg-transparent acrylic dark:bg-yBlack-700'
            : 'bg-transparent acrylic-light dark:bg-yBlack-800'
        }`}
      >
        <div className='sm:max-w-6xl lg:max-w-7xl xl:max-w-[1600px] 2xl:max-w-full mx-auto'>
          {/* Issues Section */}
          <div className='px-6 md:px-12 lg:px-16 pt-50 pb-50'>
            <h2 className='text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-8 text-center'>
              The Problem
            </h2>
            <p className='text-2xl text-gray-600 dark:text-gray-200 text-center max-w-2xl mx-auto mb-34'>
              Current AI interfaces are inefficient. Here's what we're fixing.
            </p>

            <div className='grid grid-cols-1 mx-auto sm:grid-cols-1 md:grid-cols-3 gap-6 md:gap-12 2xl:gap-22'>
              {/* Issue 1: Data & Privacy */}
              <div className='group p-6 lg:p-8 rounded-2xl bg-white/50 dark:bg-yBlack-600/50 backdrop-blur-sm border border-gray-200/50 dark:border-white/10 hover:border-amber-100/50 dark:hover:border-amber-500/20 transition-all duration-300 hover:shadow-lg hover:shadow-red-500/10'>
                <div className='w-16 h-16 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300'>
                  <i className='bx bx-git-branch text-2xl text-amber-600 dark:text-amber-400'></i>
                </div>
                <h3 className='text-2xl sm:text-2xl md:text-md lg:text-xl font-semibold text-gray-900 dark:text-white mb-3'>
                  Linear Chat Constraints
                </h3>
                <ul className='text-gray-600 dark:text-gray-400 leading-relaxed text-lg sm:text-xl md:text-sm lg:text-lg list-disc pl-5'>
                  <li className='mb-4'>
                    Linear chats force premature commitment to a single path—discovering a fundamental flaw means
                    abandoning hours of work.
                  </li>
                  <li className='mb-4'>
                    Exploration is penalized: you can't branch to test alternatives or clarify requirements without
                    starting over.
                  </li>
                  <li className='mb-4'>
                    LLM inconsistency becomes a liability; you can't "reroll" from a promising point in history to
                    explore different outcomes.
                  </li>
                </ul>
              </div>

              {/* Issue 2: Workflow & Structure */}
              <div className='group p-6 lg:p-8 rounded-2xl bg-white/50 dark:bg-yBlack-600/50 backdrop-blur-sm border border-gray-200/50 dark:border-white/10 hover:border-purple-200/50 dark:hover:border-purple-500/20 transition-all duration-300 hover:shadow-lg hover:shadow-amber-500/10'>
                <div className='w-16 h-16 rounded-xl bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300'>
                  <i className='bx bx-brain text-2xl text-purple-600 dark:text-purple-400'></i>
                </div>
                <h3 className='text-2xl sm:text-2xl md:text-md lg:text-xl font-semibold text-gray-900 dark:text-white mb-3'>
                  Context Rot & Runaway Costs
                </h3>
                <ul className='text-gray-600 dark:text-gray-400 leading-relaxed text-lg sm:text-xl md:text-sm lg:text-lg list-disc pl-5'>
                  <li className='mb-4'>
                    Conversations bloat over time, pushing token costs up while response quality deteriorates from
                    stale, distorted history.
                  </li>
                  <li className='mb-4'>
                    Agentic workflows accelerate the damage with excessive tool calls and naive truncation that discards
                    critical state.
                  </li>
                  <li className='mb-4'>
                    Hallucinations compound as models lose semantic grounding, turning long sessions from useful to
                    unreliable.
                  </li>
                </ul>
              </div>

              {/* Issue 3: Context Management */}
              <div className='group p-6 lg:p-8 rounded-2xl bg-white/50 dark:bg-yBlack-600/50 backdrop-blur-sm border border-gray-200/50 dark:border-white/10 hover:border-red-200/50 dark:hover:border-red-500/20 transition-all duration-300 hover:shadow-lg hover:shadow-red-500/10'>
                <div className='w-16 h-16 rounded-xl bg-red-100 dark:bg-red-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300'>
                  <i className='bx bx-lock-alt text-2xl text-red-600 dark:text-red-400'></i>
                </div>
                <h3 className='text-2xl sm:text-2xl md:text-md lg:text-xl font-semibold text-gray-900 dark:text-white mb-3'>
                  Zero Data Ownership & Privacy Exposure
                </h3>
                <ul className='text-gray-600 dark:text-gray-400 leading-relaxed text-lg sm:text-xl md:text-sm lg:text-lg list-disc pl-5'>
                  <li className='mb-4'>
                    Proprietary code and conversations are absorbed into corporate training pipelines and retention
                    policies.
                  </li>
                  <li className='mb-4'>
                    Account suspensions can instantly erase months of project history with no recourse—your data is held
                    hostage.
                  </li>
                  <li className='mb-4'>
                    We provide local-first operation and zero-knowledge cloud options with no telemetry or profiling,
                    ensuring complete control.
                  </li>
                </ul>
              </div>
            </div>

            {/* <p className='text-3xl md:text-4xl  lg:text-4xl font-bold text-gray-900 dark:text-white text-center max-w-2xl mx-auto mt-48 mb-24'>
              Yggdrasil solves this.
            </p>
            <div className='relative bottom-6 mb-20 md:bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce'>
              <span className='text-black/70 dark:text-gray-300 text-md md:text-lg font-medium'></span>
              <i className='bx bx-chevron-down text-black dark:text-gray-300 text-2xl'></i>
            </div> */}
            <div className='relative left-1/2 transform -translate-x-1/2 flex flex-col items-center mt-40 animate-bounce'>
              <span className='text-black/70 dark:text-gray-300 text-md md:text-lg font-medium'></span>
              <i className='bx bx-chevron-down text-black dark:text-gray-300 text-2xl'></i>
            </div>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-screen'>
            {/* Left Side - Features List */}
            <div className='lg:sticky lg:top-0 lg:h-screen mr-8 flex items-center justify-center p-8 md:p-12 lg:p-16'>
              <div className='w-full max-w-lg'>
                <h2 className='text-3xl md:text-4xl  lg:text-6xl font-bold text-gray-900 dark:text-white mb-12'>
                  Features
                </h2>
                <div className='space-y-6'>
                  {features.map((feature, index) => (
                    <button
                      key={feature.id}
                      onClick={() => handleFeatureClick(index)}
                      className={`w-full text-left p-4 rounded-xl transition-all duration-300 group ${
                        activeFeatureIndex === index
                          ? 'bg-transparent dark:bg-transparent scale-105'
                          : 'hover:scale-105 dark:hover:bg-transparent scale-102'
                      }`}
                    >
                      <div className='flex items-center gap-1.5'>
                        <h3
                          className={`text-3xl font-semibold ${
                            activeFeatureIndex === index
                              ? 'text-black-600 dark:text-neutral-50'
                              : 'text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-neutral-50'
                          }`}
                        >
                          {feature.title}
                        </h3>
                        <span
                          className={`text-xs pb-5 font-mono text-blue-500 dark:text-neutral-200 ${
                            activeFeatureIndex === index
                              ? 'text-black-600 dark:text-neutral-50'
                              : 'text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-neutral-50'
                          }`}
                        >
                          {feature.superscript}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Side - Feature Details */}
            <div className='flex flex-col'>
              {features.map((feature, index) => (
                <div
                  key={feature.id}
                  ref={el => {
                    featureRefs.current[index] = el
                  }}
                  className='min-h-screen flex items-center justify-center p-8 md:p-12 lg:p-16'
                >
                  <div className='w-full max-w-2xl rounded-3xl'>
                    {/* Mobile Feature Title */}
                    <div className='lg:hidden mb-6'>
                      {/* <span className='pl-0.5 text-sm font-mono text-blue-500 dark:text-neutral-300'>
                        {feature.superscript}
                      </span> */}
                      <h3 className='text-2xl font-bold text-gray-900 dark:text-white mt-1'>{feature.title}</h3>
                    </div>

                    {/* Video/Image Placeholder */}
                    <div
                      className='relative w-full aspect-video rounded-2xl bg-gray-100 dark:bg-yBlack-600 overflow-hidden mb-8 shadow-lg group'
                      ref={el => {
                        videoWrappersRef.current[index] = el
                      }}
                    >
                      <video
                        autoPlay
                        onClick={() => {
                          if (loadedVideos[index] && feature.videoSrc) {
                            setExpandedVideoSrc(feature.videoSrc)
                          }
                        }}
                        loop
                        muted
                        playsInline
                        preload='none'
                        ref={el => {
                          videoElementsRef.current[index] = el
                        }}
                        className='w-full h-full object-cover transition-transform duration-300 group-hover:scale-105'
                      >
                        {loadedVideos[index] && feature.videoSrc ? (
                          <source src={feature.videoSrc} type='video/webm' />
                        ) : null}
                      </video>

                      {!loadedVideos[index] && (
                        <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-200 dark:from-yBlack-600 dark:to-yBlack-700'>
                          <div className='text-center'>
                            <i className='bx bx-video text-4xl text-gray-400 mb-2'></i>
                            <p className='text-gray-500'>Video preview</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <ul className='text-xl pl-2 pt-4 text-gray-900 dark:text-gray-300 leading-relaxed list-disc ml-4 space-y-10'>
                      {feature.description.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {expandedVideoSrc && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4'>
          <div className='absolute inset-0 cursor-pointer' onClick={handleExpandedVideoClose} />
          <div className='relative w-full max-w-5xl rounded-3xl overflow-hidden bg-black shadow-2xl'>
            <video controls autoPlay muted loop className='w-full h-full object-cover' src={expandedVideoSrc} />
            <button
              className='absolute top-4 right-4 bg-black/60 text-white rounded-full p-2 hover:bg-black/80 transition'
              onClick={handleExpandedVideoClose}
              aria-label='Close fullscreen video'
            >
              <i className='bx bx-x text-2xl'></i>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className='relative z-10 w-full border-t border-white/10 bg-neutral-900/30 backdrop-blur-md font-sans'>
        <div className='max-w-[1400px] mx-auto px-6 py-4 flex flex-col lg:flex-row items-center justify-between gap-4 text-xs'>
          {/* LEFT SIDE: Copyright + Business Info (Merged perfectly) */}
          <div className='flex flex-col md:flex-row items-center gap-2 md:gap-4 text-center md:text-left'>
            {/* Copyright */}
            <span className='text-neutral-300 font-medium'>© {new Date().getFullYear()} Yggchat</span>
            {/* Desktop Divider */}
            <span className='hidden md:block text-white/10 h-3 border-l border-white/10'></span>

            {/* Business Details - Subtle & Horizontal */}
            <div className='flex flex-wrap justify-center md:justify-start gap-x-3 text-neutral-500'>
              <span>[Karanraj Singh] t/a Yggchat.com</span>
              <span className='hidden sm:inline'>•</span>
              <span>[225, Whittock Road, Bristol, BS14 8DB]</span>
              <span className='hidden sm:inline'>•</span>
              <a href='mailto:support@yggchat.com' className='hover:text-neutral-300 transition-colors'>
                support@yggchat.com
              </a>
            </div>
          </div>

          {/* RIGHT SIDE: Legal Links (Using proper Link tags for Stripe bots) */}
          <div className='flex items-center gap-6 text-neutral-400'>
            <Link to='/terms' className='hover:text-white transition-colors'>
              Terms
            </Link>
            <Link to='/privacy' className='hover:text-white transition-colors'>
              Privacy
            </Link>
            <Link to='/refund-policy' className='hover:text-white transition-colors'>
              Refunds
            </Link>
          </div>
        </div>
      </footer>
      <button
        type='button'
        onClick={handleTryNow}
        className='fixed z-50 bottom-10 right-6 md:bottom-16 md:right-16 rounded-full acrylic px-8 py-4 text-base font-semibold text-black dark:text-white dark:border dark:border-white dark:shadow-[0_2px_16px_3px_rgba(0,0,0,0.25)] transition duration-200 hover:scale-105'
      >
        Start Free Trial
      </button>
    </div>
  )
}

export default LandingPage
