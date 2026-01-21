import React from 'react'
import { Link } from 'react-router-dom'
import { Logo } from './Logo'

interface NavbarProps {
  onToggleTheme: () => void
  isDark: boolean
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleTheme, isDark }) => {
  return (
    <nav className='fixed top-0 left-0 w-full z-50 p-6 md:p-8 flex justify-between items-center transition-all'>
      <div className='flex items-center gap-3 text-zinc-900 dark:text-white'>
        <Logo className='w-8 h-8 md:w-10 md:h-10 transition-all duration-300' isDark={isDark} />
        <span className='text-3xl font-black tracking-tighter uppercase'>Yggdrasil</span>
      </div>

      <div className='hidden md:flex items-center gap-8 flex-wrap font-bold uppercase text-xs tracking-widest text-zinc-900 dark:text-white'>
        <a href='#features' className='border-none hover:text-[#0052FF] transition-colors'>
          Infrastructure
        </a>

        <Link to='/faq' className='hover:text-[#0052FF] transition-colors'>
          FAQ
        </Link>
        <Link to='/paymentplan' className='hover:text-[#0052FF] transition-colors'>
          Pricing
        </Link>
        <Link to='/blog' className='hover:text-[#0052FF] transition-colors'>
          Blog
        </Link>

        <button
          onClick={onToggleTheme}
          className='p-2 border-2 border-zinc-900 dark:border-white hover:bg-[#0052FF] hover:border-[#0052FF] hover:text-white transition-all flex items-center justify-center w-10 h-10'
          title='Toggle Theme'
          type='button'
        >
          {isDark ? '☼' : '☾'}
        </button>

        <Link
          to='/login'
          className='bg-zinc-900 dark:bg-white text-white dark:text-black px-6 py-2 hover:bg-[#0052FF] dark:hover:bg-[#0052FF] dark:hover:text-white transition-all'
        >
          Login
        </Link>
      </div>

      <div className='md:hidden'>
        <button
          onClick={onToggleTheme}
          className='p-2 border-2 border-zinc-900 dark:border-white text-zinc-900 dark:text-white'
          type='button'
          aria-label='Toggle Theme'
        >
          {isDark ? '☼' : '☾'}
        </button>
      </div>
    </nav>
  )
}
