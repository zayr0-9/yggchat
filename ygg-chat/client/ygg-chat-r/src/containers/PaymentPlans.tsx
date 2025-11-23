import React from 'react'
import { useNavigate } from 'react-router-dom'

interface Plan {
  id: string
  name: string
  price: number
  billingCycle: string
  description: string
  featured?: boolean
  cta: string
}

interface Feature {
  name: string
  plans: Record<string, string> // Changed from boolean to string
}

const PaymentPlans: React.FC = () => {
  // Data for 3 pricing plans
  const plans: Plan[] = [
    {
      id: 'basic',
      name: 'Basic',
      price: 9.99,
      billingCycle: '/month',
      description: 'Perfect for individuals getting started',
      cta: 'Subscribe',
    },
    {
      id: 'pro',
      name: 'Pro',
      price: 19.99,
      billingCycle: '/month',
      description: 'Best for growing businesses',
      featured: true,
      cta: 'Subscribe',
    },
    {
      id: 'ultra',
      name: 'Ultra',
      price: 49.99,
      billingCycle: '/month',
      description: 'For large teams and organizations',
      cta: 'Subscribe',
    },
  ]

  const navigate = useNavigate()

  const handleNavigation = (path: string) => {
    if (path.startsWith('#')) {
      const element = document.querySelector(path)
      element?.scrollIntoView({ behavior: 'smooth' })
    } else {
      navigate(path)
    }
  }

  // Data for 6 features across plans with descriptive text
  const features: Feature[] = [
    { name: 'Multiple Models', plans: { basic: '400+', pro: '400+', ultra: '400+' } },
    { name: 'Cloud Sync', plans: { basic: 'Limited Cloud', pro: 'Unlimited', ultra: 'Unlimited' } },
    { name: 'Database', plans: { basic: 'Cloud', pro: 'Cloud + Local', ultra: 'Cloud + Local' } },
    { name: 'Agents', plans: { basic: 'Not included', pro: 'Yes', ultra: 'Yes' } },
    { name: 'Claude Code support', plans: { basic: 'Not included', pro: 'Yes', ultra: 'Yes' } },
    { name: 'Storage', plans: { basic: '1GB', pro: '10GB', ultra: '50GB' } },
    { name: 'Local version', plans: { basic: 'Not included', pro: 'Yes', ultra: 'Yes' } },
  ]

  return (
    <div className='min-h-screen dark:bg-blue-900 bg-blue-200 text-neutral-900 dark:text-neutral-100 py-12 px-6'>
      <div className='max-w-7xl mx-auto'>
        {/* Header */}
        <div className='text-center mb-12'>
          <h1 className='text-4xl md:text-5xl font-bold text-stone-800 dark:text-neutral-100 mb-4'>Choose Your Plan</h1>
          <p className='text-lg text-neutral-900 dark:text-neutral-100 max-w-2xl mx-auto'>
            Select the perfect plan for your needs. Upgrade or downgrade at any time.
          </p>
        </div>

        {/* Plan Cards */}
        <div className='grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-20 xl:gap-20 2xl:gap-24 mb-24'>
          {plans.map(plan => (
            <div
              key={plan.id}
              className={`relative text-[16px] rounded-2xl p-4 transition-all duration-300 transform flex flex-col ${
                plan.featured
                  ? 'bg-transparent mica text-neutral-900 dark:text-neutral-100'
                  : 'bg-transparent mica text-neutral-900 dark:text-neutral-100'
              }`}
            >
              {/* {plan.featured && (
                <div className='absolute -top-6 left-1/2 transform -translate-x-1/2'>
                  <span className='bg-transparent outline-1 acrylic-light dark:outline-neutral-700 text-neutral-900 dark:text-neutral-100 px-3 py-2 rounded-full text-[14px] font-semibold'>
                    Most Popular
                  </span>
                </div>
              )} */}

              <div className='flex-1'>
                <h3 className='text-[28px] font-bold mb-6'>{plan.name}</h3>
                <div className='flex items-baseline mb-3'>
                  <span
                    className={`text-4xl mt-2 font-bold${plan.featured ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-900 dark:text-neutral-100'}`}
                  >
                    ${plan.price}
                  </span>
                  <span
                    className={`ml-2 mb-3 text-[18px] ${plan.featured ? 'text-neutral-900 dark:text-neutral-100/90' : 'text-neutral-900 dark:text-neutral-100'}`}
                  >
                    {plan.billingCycle}
                  </span>
                </div>
                <p
                  className={`mb-6 text-[18px] ${plan.featured ? 'text-neutral-900 dark:text-neutral-100/90' : 'text-neutral-900 dark:text-neutral-100'}`}
                >
                  {plan.description}
                </p>
              </div>

              <button
                className={`w-full py-3 mt-8 px-6 rounded-lg font-semibold transition-all duration-200 ${
                  plan.featured
                    ? 'bg-neutral-50/70 dark:bg-transparent border-2 hover:scale-101 border-neutral-300/50 dark:border-neutral-300/20 text-neutral-900 active:scale-99 dark:text-neutral-100 '
                    : 'bg-neutral-50/70 dark:bg-transparent border-2 hover:scale-101 border-neutral-300/50 dark:border-neutral-300/20 text-neutral-900 active:scale-99 dark:text-neutral-100'
                }`}
                onClick={() => handleNavigation('/login')}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* Features Comparison Table */}
        <div className='bg-transparent mica-light rounded-2xl overflow-hidden'>
          <div className='py-6 px-4'>
            <h2 className='text-2xl font-bold text-neutral-900 dark:text-neutral-100'>Yggdrasil Plans</h2>
          </div>

          <div className='overflow-x-auto'>
            <table className='w-full mb-4'>
              <thead>
                <tr className='border-b border-neutral-700/20'>
                  <th className='text-left py-4 px-6 text-neutral-900 text-[20px] dark:text-neutral-100 font-semibold'>
                    Features
                  </th>
                  {plans.map(plan => (
                    <th key={plan.id} className='py-4 px-6 text-center'>
                      <span className='text-neutral-900 dark:text-neutral-100 text-[20px] font-bold'>{plan.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map(feature => (
                  <tr key={feature.name} className={`border-b border-neutral-200/5`}>
                    <td className='py-4 px-6 text-neutral-900 dark:text-neutral-100 text-[18px] font-medium'>
                      {feature.name}
                    </td>
                    {plans.map(plan => (
                      <td key={plan.id} className='py-4 px-6 text-center text-[17px]'>
                        <span
                          className={`font-medium ${
                            feature.plans[plan.id] === 'Not included'
                              ? 'text-neutral-900 dark:text-neutral-100/90'
                              : 'dark:text-white/90 text-neutral-900'
                          }`}
                        >
                          {feature.plans[plan.id] === 'Not included' ? 'x' : feature.plans[plan.id]}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaymentPlans
