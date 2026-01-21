import React, { useEffect, useState } from 'react'

export const Hero: React.FC = () => {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setActive(true), 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <section className='relative h-screen flex flex-col justify-end p-6 md:p-12 pb-24 overflow-hidden'>
      <div className='max-w-7xl mx-auto w-full xl:max-w-none xl:mx-0'>
        <div className='mb-1 md:mb-6 xl:mb-12'>
          <span
            className={`mono text-[#0052FF] font-bold block transition-all duration-700 delay-100 ${
              active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            V 1.0.0-STABLE
          </span>
          <h1
            className={`text-[15vw] leading-[0.8] font-black tracking-tighter uppercase mb-4 transition-all duration-1000 delay-200 text-zinc-900 dark:text-white ${
              active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            }`}
          >
            YGGDRASIL
          </h1>
          <div className='flex flex-col md:flex-row md:items-end justify-between gap-8'>
            <p
              className={`text-base md:text-lg xl:text-xl font-light max-w-lg text-zinc-600 dark:text-zinc-300 transition-all duration-1000 delay-300 ${
                active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
            >
              The AI operating system. Access every frontier model through one unified workspace. Build AI apps just by
              describing them. <strong>Control everything.</strong>
              <br></br>{' '}
              <span className='text-zinc-900 dark:text-white font-bold'>
                This is your new desktop—and it understands you.
              </span>
            </p>
            <div
              className={`flex flex-col gap-4 transition-all duration-700 delay-500 ${
                active ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'
              }`}
            >
              <div className='flex gap-2'>
                <div className='w-12 h-1 bg-[#0052FF]' />
                <div className='w-12 h-1 bg-red-600' />
                <div className='w-12 h-1 bg-emerald-600' />
              </div>
              <span className='mono text-xs text-zinc-400 dark:text-zinc-500 uppercase tracking-widest'>
                Status: Online
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
