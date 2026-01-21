import React, { useEffect, useState } from 'react'
import { ScrollReveal } from './ScrollReveal'

export const Economics: React.FC = () => {
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setAnimate(true), 500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <>
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-8'>
        <ScrollReveal className='bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 p-8 shadow-sm transition-colors duration-500'>
          <div className='flex items-start gap-4 mb-6'>
            <div className='w-1.5 h-10 bg-[#0052FF]' />
            <div>
              <h3 className='text-xl font-black uppercase text-zinc-900 dark:text-white'>
                THE MILLION-ROW SPREADSHEET
              </h3>
              <p className='text-sm text-zinc-500 mt-1'>
                Difference in handling high-cardinality datasets for enterprise analysis.
              </p>
            </div>
          </div>

          <div className='space-y-10'>
            <div>
              <div className='flex justify-between text-xs font-bold uppercase mb-2'>
                <span className='text-zinc-400'>LEGACY CONTEXT (1M ROWS)</span>
                <span className='text-red-600'>TOKEN LIMIT EXCEEDED / CRASH</span>
              </div>
              <div className='h-4 bg-zinc-100 dark:bg-zinc-800 relative overflow-hidden'>
                <div
                  className='h-full bg-red-500 transition-all duration-1000 ease-out'
                  style={{ width: animate ? '100%' : '0%' }}
                />
              </div>
            </div>

            <div>
              <div className='flex justify-between text-xs font-bold uppercase mb-2'>
                <span className='text-[#0052FF]'>YGGDRASIL RUNTIME</span>
                <span className='text-[#0052FF]'>150 TOKENS (QUERY GENERATION ONLY)</span>
              </div>
              <div className='h-4 bg-zinc-100 dark:bg-zinc-800 relative overflow-hidden'>
                <div
                  className='h-full bg-[#0052FF] transition-all duration-1000 delay-500 ease-out'
                  style={{ width: animate ? '2%' : '0%' }}
                />
              </div>
            </div>
          </div>

          <p className='mt-8 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed italic'>
            <strong>The Outcome:</strong> Other agents crash or truncate data. Yggdrasil isolates display from logic,
            allowing the user to view and act on all 1,000,000 rows while the AI only writes the SQL code to query it.
          </p>
        </ScrollReveal>

        <ScrollReveal
          delay='reveal-delayed-1'
          className='bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 p-8 shadow-sm transition-colors duration-500'
        >
          <div className='flex justify-between items-start mb-6'>
            <div className='flex items-start gap-4'>
              <div className='w-1.5 h-10 bg-[#0052FF]' />
              <div>
                <h3 className='text-xl font-black uppercase text-zinc-900 dark:text-white'>THE AWS BILL ANALYSIS</h3>
                <p className='text-sm text-zinc-500 mt-1'>Problem: "Why did S3 costs spike?" (Input: 5GB Logs)</p>
              </div>
            </div>
          </div>

          <div className='mt-6'>
            <span className='text-[10px] font-black uppercase text-zinc-400 mb-6 block'>Compute Cost Per Query</span>

            <div className='space-y-8'>
              <div>
                <div className='flex justify-between text-[11px] font-black uppercase mb-1'>
                  <span className='text-red-600'>LEGACY AGENT</span>
                  <span className='text-red-600'>~$400.00</span>
                </div>
                <div className='h-3 bg-zinc-200 dark:bg-zinc-800 relative overflow-hidden'>
                  <div
                    className='h-full bg-red-500 flex items-center justify-end px-2'
                    style={{ width: animate ? '100%' : '0%', transition: 'width 1s ease-out' }}
                  >
                    <span className='text-[8px] text-white font-black whitespace-nowrap'>CONTEXT OVERFLOW</span>
                  </div>
                </div>
              </div>

              <div>
                <div className='flex justify-between text-[11px] font-black uppercase mb-1'>
                  <span className='text-[#0052FF]'>YGGDRASIL RUNTIME</span>
                  <span className='text-[#0052FF]'>$0.02 (LOCAL)</span>
                </div>
                <div className='h-3 bg-zinc-200 dark:bg-zinc-800 relative overflow-hidden'>
                  <div
                    className='h-full bg-[#0052FF]'
                    style={{ width: animate ? '1%' : '0%', transition: 'width 1.5s ease-out' }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className='mt-12 flex justify-between items-center text-[10px] font-black uppercase tracking-wider'>
            <span className='text-zinc-400'>Privacy: Uploads map to 3rd party</span>
            <span className='text-[#0052FF]'>Privacy: Zero Egress</span>
          </div>
        </ScrollReveal>
      </div>
      <ScrollReveal className='mt-10 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 p-6 md:p-8 shadow-sm transition-colors duration-500'>
        <p className='text-base md:text-lg xl:text-xl text-zinc-700 dark:text-zinc-300 leading-relaxed font-medium'>
          This pattern repeats across thousands of use cases -- any task involving sensitive data, large files, or
          real-time analysis.
        </p>
      </ScrollReveal>
    </>
  )
}
