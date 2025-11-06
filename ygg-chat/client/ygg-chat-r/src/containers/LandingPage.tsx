import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button/button'

const LandingPage: React.FC = () => {
  const navigate = useNavigate()
  const [isDarkMode, setIsDarkMode] = useState(false)

  React.useEffect(() => {
    // Sync with existing dark mode system
    const isDark = document.documentElement.classList.contains('dark')
    setIsDarkMode(isDark)
  }, [])

  const toggleTheme = () => {
    const htmlElement = document.documentElement
    htmlElement.classList.toggle('dark')
    setIsDarkMode(!isDarkMode)
    localStorage.setItem('theme', isDarkMode ? 'light' : 'dark')
  }

  const handleNavigation = (path: string) => {
    if (path.startsWith('#')) {
      // For future use - scroll to section
      const element = document.querySelector(path)
      element?.scrollIntoView({ behavior: 'smooth' })
    } else {
      navigate(path)
    }
  }

  return (
    <div className='relative w-full h-screen bg-gradient-to-b from-cyan-400 to-cyan-500 dark:from-yBlack-600 dark:to-yBlack-700 overflow-hidden'>
      {/* Video Background - Light Mode */}
      <video
        autoPlay
        loop
        muted
        className='absolute inset-0 w-full h-full blur-[1px] dark:blur-[1px] 2xl:dark:blur-[2px] object-cover dark:hidden'
      >
        <source src='/video/l1.webm' type='video/webm' />
      </video>

      {/* Video Background - Dark Mode */}
      <video
        autoPlay
        loop
        muted
        className='absolute inset-0 w-full h-full blur-[1px] dark:blur-[1px] 2xl:dark:blur-[2px] object-cover hidden dark:block'
      >
        <source src='/video/d1.webm' type='video/webm' />
      </video>

      {/* Dark Backdrop Filter */}
      <div className='absolute inset-0 w-full h-full bg-black/40 dark:bg-black/40' />

      {/* Background Image Overlay */}
      <div
        className='absolute inset-0 w-full h-full bg-cover bg-center opacity-60 dark:opacity-40'
        style={{
          backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:%2385c5d4;stop-opacity:1" /><stop offset="100%" style="stop-color:%2365b8c9;stop-opacity:1" /></linearGradient></linearGradient></defs><rect width="1200" height="800" fill="url(%23sky)"/></svg>')`,
        }}
      />

      {/* Header Navigation */}
      <nav className='relative z-20 flex items-center justify-between px-6 sm:px-8 md:px-12 py-4 md:py-6'>
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
        <div className='hidden md:flex items-center gap-8 lg:gap-12'>
          <button
            onClick={() => handleNavigation('#features')}
            className='text-white dark:text-gray-200 hover:text-yellow-200 dark:hover:text-yPink-300 transition-colors duration-200 font-medium'
          >
            Features
          </button>
          <button
            onClick={() => handleNavigation('#pricing')}
            className='text-white dark:text-gray-200 hover:text-yellow-200 dark:hover:text-yPink-300 transition-colors duration-200 font-medium'
          >
            Pricing
          </button>
          <button
            onClick={() => handleNavigation('#faq')}
            className='text-white dark:text-gray-200 hover:text-yellow-200 dark:hover:text-yPink-300 transition-colors duration-200 font-medium'
          >
            FAQ
          </button>
        </div>

        {/* Right Side - Theme Toggle & Login */}
        <div className='flex items-center gap-4 md:gap-6'>
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
            rounded='lg'
            className='hover:scale-110 transition-all text-white duration-200 hover:bg-transparent dark:hover:bg-transparent'
          >
            Login
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className='relative z-10 h-full flex flex-col items-center justify-center px-4 sm:px-6'>
        {/* Main Title */}

        <div className=' mr-6 flex items-center flex-wrap gap-10 rounded-full'>
          <img
            src='/img/logo-l-thick.svg'
            alt='Yggdrasil Logo'
            className='w-18 h-18 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-18 lg:h-18 xl:w-20 xl:h-20 2xl:w-32 2xl:h-32 dark:block rounded-full dark:shadow-[0_2px_16px_3px_rgba(0,0,0,0.25)]'
          />
          <h1 className='jaini-regular pb-2 text-5xl sm:text-6xl md:text-7xl lg:text-[104px] font-bold text-white dark:text-white text-center mb-4 md:mb-6 drop-shadow-lg'>
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
        <div className='absolute bottom-6 md:bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce'>
          <span className='text-white/70 dark:text-gray-300 text-xs md:text-sm font-medium'>Scroll to explore</span>
          <i className='bx bx-chevron-down text-white dark:text-gray-300 text-2xl'></i>
        </div>
      </div>
    </div>
  )
}

export default LandingPage
