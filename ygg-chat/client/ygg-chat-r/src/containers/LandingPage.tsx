import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button/button'
import { getAssetPath } from '../utils/assetPath'

interface Feature {
  id: number
  title: string
  superscript: string
  description: string
  videoSrc?: string
}

const LandingPage: React.FC = () => {
  const navigate = useNavigate()
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [activeFeatureIndex, setActiveFeatureIndex] = useState(0)
  const [isInFeaturesSection, setIsInFeaturesSection] = useState(false)
  const featureRefs = useRef<(HTMLDivElement | null)[]>([])
  // const featuresContainerRef = useRef<HTMLDivElement>(null)
  const featuresSectionRef = useRef<HTMLElement>(null)

  const features: Feature[] = [
    {
      id: 1,
      title: 'Branch',
      superscript: '01',
      description:
        "As conversations naturally branch into tangents and follow-up questions, Yggdrasil's intelligent navigation system visualizes and manages the full structure of your dialogue. Every edit spawns a new branch, ensuring an immutable, accurate log of every message. Nothing is ever lost, delivering complete transparency into the evolution of your thought.",
      videoSrc: getAssetPath('video/d2.webm'),
    },
    {
      id: 2,
      title: 'Context Management',
      superscript: '02',
      description:
        'Intelligent context management ensures your AI always remembers what matters. Track, organize, and maintain conversation state across branches with precision. Never lose important details in long conversations.',
      videoSrc: getAssetPath('video/l3.webm'),
    },
    {
      id: 3,
      title: 'Agentic Capabilities',
      superscript: '03',
      description:
        'Empower your AI with autonomous capabilities. Create agents that can act independently, make decisions, and accomplish complex tasks. Perfect for automation and advanced workflows.',
      videoSrc: getAssetPath('video/d2.webm'),
    },
    {
      id: 4,
      title: 'Multiple Models',
      superscript: '04',
      description:
        'Switch between different AI models seamlessly. Leverage the best model for each task—whether you need speed, creativity, or specialized expertise. Compare outputs across models in real-time.',
      videoSrc: getAssetPath('video/l3.webm'),
    },
  ]

  // Initialize theme
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark')
    setIsDarkMode(isDark)
  }, [])

  // Monitor scroll position for features section and active feature
  useEffect(() => {
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

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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

  const handleNavigation = (path: string) => {
    if (path.startsWith('#')) {
      const element = document.querySelector(path)
      element?.scrollIntoView({ behavior: 'smooth' })
    } else {
      navigate(path)
    }
  }

  return (
    <div className='w-full dark:bg-blue-900 bg-blue-200 min-h-screen' style={{ scrollSnapType: 'y mandatory' }}>
      {/* Header Navigation */}
      <nav className='sticky top-0 rounded-b-2xl z-30 flex items-center justify-between px-6 sm:px-4 md:px-8 py-2 md:py-3 bg-transparent dark:bg-transparent transition-all duration-300'>
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
            onClick={() => handleNavigation('#faq')}
            className={`${isInFeaturesSection ? 'text-black' : 'text-white'} dark:text-gray-200 hover:bg-neutral-200/30 rounded-2xl p-2 px-3 active:scale-97 dark:hover:text-neutral-50 transition-colors duration-200 font-medium`}
          >
            FAQ
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
        <div className='relative z-10 h-full flex flex-col items-center justify-center px-4 sm:px-6'>
          {/* Main Title */}

          <div className='mr-2 lg:mr-6 flex items-center flex-wrap gap-6 lg:gap-10 rounded-full'>
            <img
              src={getAssetPath('img/logo-l-thick.svg')}
              alt='Yggdrasil Logo'
              className='acrylic-light-dark w-18 h-18 sm:w-14 sm:h-14 md:w-18 md:h-18 lg:w-26 lg:h-26 xl:w-28 xl:h-28 2xl:w-36 2xl:h-36 dark:block rounded-full dark:shadow-[0_2px_16px_3px_rgba(0,0,0,0.25)]'
            />
            <h1 className='pb-2 2xl:pb-1 text-[64px] sm:text-6xl md:text-7xl lg:text-[104px] text-white dark:text-white text-center mb-4 md:mb-6 drop-shadow-lg'>
              yggdrasil
            </h1>
          </div>

          {/* Tagline */}
          <p className='text-base mt-2 sm:text-lg md:text-xl lg:text-2xl text-white dark:text-gray-100 text-center max-w-2xl leading-relaxed drop-shadow-md font-light'>
            Use AI like Humans are Supposed to
            <br />
            Make mistakes Learn Improve
          </p>

          {/* Scroll Indicator */}
          <div className='absolute bottom-6 mb-20 md:bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce'>
            <span className='text-white/70 dark:text-gray-300 text-xs md:text-sm font-medium'>Scroll to explore</span>
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
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-screen'>
            {/* Left Side - Features List */}
            <div className='lg:sticky lg:top-0 lg:h-screen mr-8 flex items-center justify-center p-8 md:p-12 lg:p-16'>
              <div className='w-full max-w-md'>
                <h2 className='text-3xl md:text-4xl  lg:text-6xl font-bold text-gray-900 dark:text-white mb-8'>
                  Features
                </h2>
                <div className='space-y-2'>
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
                  className='min-h-screen snap-start snap-always flex items-center justify-center p-8 md:p-12 lg:p-16'
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
                    <div className='w-full aspect-video rounded-2xl bg-gray-100 dark:bg-yBlack-600 overflow-hidden mb-8 shadow-lg group'>
                      {feature.videoSrc ? (
                        <video
                          autoPlay
                          loop
                          muted
                          playsInline
                          className='w-full h-full object-cover transition-transform duration-300 group-hover:scale-105'
                        >
                          <source src={feature.videoSrc} type='video/webm' />
                          <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-200 dark:from-yBlack-600 dark:to-yBlack-700'>
                            <div className='text-center'>
                              <i className='bx bx-video text-4xl text-gray-400 mb-2'></i>
                              <p className='text-gray-500'>Video preview</p>
                            </div>
                          </div>
                        </video>
                      ) : (
                        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-200 dark:from-yBlack-600 dark:to-yBlack-700'>
                          <div className='text-center'>
                            <i className='bx bx-image text-4xl text-gray-400 mb-2'></i>
                            <p className='text-gray-500'>Feature preview</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <p className='text-xl pl-2 text-gray-900 dark:text-gray-300 leading-relaxed'>
                      {feature.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className='relative z-10 py-4 px-6 text-center border-t border-white/10 bg-neutral-900/30 backdrop-blur-md'>
        <div className='max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4'>
          <div className='text-sm text-neutral-200'>© {new Date().getFullYear()} Yggdrasil. All rights reserved.</div>

          <div className='flex items-center gap-6'>
            <button
              onClick={() => navigate('/terms')}
              className='text-sm text-neutral-200 hover:text-white transition-colors'
            >
              Terms of Service
            </button>
            <button
              onClick={() => navigate('/privacy')}
              className='text-sm text-neutral-200 hover:text-white transition-colors'
            >
              Privacy Policy
            </button>
            <button
              onClick={() => navigate('/refund-policy')}
              className='text-sm text-neutral-200 hover:text-white transition-colors'
            >
              Refund Policy
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
