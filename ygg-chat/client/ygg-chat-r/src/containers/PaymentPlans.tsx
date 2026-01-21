import React from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { getFeaturesForPlan, PLANS, PRICING_FEATURES } from '../constants/pricingData'

const PaymentPlans: React.FC = () => {
  const plans = PLANS
  const features = PRICING_FEATURES
  const navigate = useNavigate()

  const handleNavigation = (path: string) => {
    if (path.startsWith('#')) {
      const element = document.querySelector(path)
      element?.scrollIntoView({ behavior: 'smooth' })
    } else {
      navigate(path)
    }
  }

  return (
    <div className='relative h-full min-h-screen w-full overflow-y-auto bg-white text-zinc-900 dark:bg-black dark:text-white'>
      <div className='pointer-events-none absolute inset-0 opacity-80'>
        <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,82,255,0.12),_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(0,82,255,0.2),_transparent_55%)]' />
        <div className='absolute inset-0 bg-[linear-gradient(to_right,rgba(24,24,27,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,24,27,0.08)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:80px_80px]' />
      </div>

      <header className='relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 md:px-12 py-6 border-b border-zinc-200 dark:border-zinc-900'>
        <Link
          to='/'
          className='mono text-[18px] tracking-[0.4em] text-white bg-zinc-900 px-3 py-2 uppercase hover:bg-zinc-800 hover:text-white/90 transition-colors'
        >
          ← Back
        </Link>
        <div className='flex items-center gap-3 text-[18px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
          <span className='mono'>Pricing Node</span>
          <span className='hidden sm:inline'>/</span>
          <span className='mono'>Plans</span>
        </div>
        <Link
          to='/login'
          className='border-2 border-zinc-900 dark:border-white bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-white hover:bg-zinc-800 hover:border-zinc-800 dark:hover:border-white transition-colors'
        >
          Sign In
        </Link>
      </header>

      <main className='relative z-10 px-6 md:px-12 pb-24'>
        <section className='max-w-6xl mx-auto pt-16 md:pt-24'>
          <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-xs'>[ Pricing Matrix ]</span>
          <h1 className='text-5xl md:text-7xl font-black tracking-tighter mt-4'>RUNTIME PLANS</h1>
          <p className='mt-6 text-lg text-zinc-600 dark:text-zinc-300 max-w-3xl leading-relaxed'>
            Select the capacity that matches your workload. Every plan includes the full branching core and model
            routing stack.
          </p>
        </section>

        <section className='max-w-6xl mx-auto mt-12 grid gap-6 md:grid-cols-3'>
          {plans.map(plan => {
            const highlight = plan.featured
            const featureList = getFeaturesForPlan(plan.id).slice(0, 5)

            return (
              <div
                key={plan.id}
                className={`relative flex h-full flex-col border-2 px-6 py-8 backdrop-blur-sm transition-transform duration-300 ${
                  highlight
                    ? 'border-[#0052FF] bg-white/90 dark:bg-zinc-950/80 shadow-[0_0_0_1px_rgba(0,82,255,0.35)]'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/60'
                }`}
              >
                {highlight && (
                  <span className='absolute -top-4 left-6 bg-[#0052FF] px-3 py-1 text-[10px] font-black uppercase tracking-[0.3em] text-white'>
                    Most Popular
                  </span>
                )}
                <div className='flex items-start justify-between'>
                  <div>
                    <p className='mono text-[14px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>Tier</p>
                    <h2 className='text-2xl font-black uppercase tracking-tight'>{plan.name}</h2>
                  </div>
                  <span className='mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                    {plan.id}
                  </span>
                </div>

                <div className='mt-6 flex items-end gap-2'>
                  <span className='text-4xl font-black'>${plan.price}</span>
                  <span className='text-xs uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                    {plan.billingCycle}
                  </span>
                </div>

                <p className='mt-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed'>{plan.description}</p>

                <ul className='mt-6 space-y-2 text-sm text-zinc-600 dark:text-zinc-300'>
                  {featureList.map(feature => (
                    <li key={feature} className='flex items-start gap-2'>
                      <span className='mt-1 h-1.5 w-1.5 rounded-full bg-[#0052FF]' />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  className={`mt-8 w-full border-2 px-4 py-3 text-xs font-bold uppercase tracking-[0.25em] transition-colors ${
                    highlight
                      ? 'border-[#0052FF] text-[#0052FF] hover:bg-[#0052FF] hover:text-white'
                      : 'border-zinc-900 dark:border-white text-zinc-900 dark:text-white hover:bg-[#0052FF] hover:border-[#0052FF] hover:text-white'
                  }`}
                  onClick={() => handleNavigation('/login')}
                  type='button'
                >
                  {plan.cta}
                </button>
              </div>
            )
          })}
        </section>

        <section className='max-w-6xl mx-auto mt-16'>
          <div className='border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm'>
            <div className='flex flex-wrap items-center justify-between gap-6 px-6 py-6 border-b border-zinc-200 dark:border-zinc-900'>
              <div className='flex items-center gap-4'>
                <div className='w-1.5 h-10 bg-[#0052FF]' />
                <div>
                  <p className='mono text-[14px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                    Comparison Grid
                  </p>
                  <h2 className='text-2xl font-black uppercase tracking-tight'>Plan Matrix</h2>
                </div>
              </div>
              <span className='mono text-[14px] uppercase tracking-[0.3em] text-[#0052FF]'>Billed Monthly</span>
            </div>

            <div className='overflow-x-auto'>
              <table className='min-w-[720px] w-full'>
                <thead>
                  <tr className='border-b border-zinc-200/70 dark:border-zinc-800/70'>
                    <th className='text-left py-4 px-6 text-xs uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                      Feature
                    </th>
                    {plans.map(plan => (
                      <th key={plan.id} className='py-4 px-6 text-center text-xs uppercase tracking-[0.3em]'>
                        {plan.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {features.map(feature => (
                    <tr key={feature.name} className='border-b border-zinc-200/40 dark:border-zinc-800/60'>
                      <td className='py-4 px-6 text-sm font-semibold text-zinc-700 dark:text-zinc-200'>
                        {feature.name}
                      </td>
                      {plans.map(plan => {
                        const value = feature.plans[plan.id]
                        const isMissing = value === 'Not included' || value === 'x'
                        return (
                          <td key={plan.id} className='py-4 px-6 text-center text-sm'>
                            <span
                              className={
                                isMissing ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-900 dark:text-white'
                              }
                            >
                              {isMissing ? '—' : value}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default PaymentPlans
