import React from 'react'
import { Link } from 'react-router-dom'

const TermsOfService: React.FC = () => {
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
        <div className='flex items-center gap-3 text-[20px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
          <span className='mono'>Legal Node</span>
          <span className='hidden sm:inline'>/</span>
          <span className='mono'>Terms</span>
        </div>
        <Link
          to='/login'
          className='border-2 border-zinc-900 dark:border-white bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-white hover:bg-zinc-800 hover:border-zinc-800 dark:hover:border-white transition-colors'
        >
          Sign In
        </Link>
      </header>

      <main className='relative z-10 px-6 md:px-12 pb-24'>
        <section className='max-w-5xl mx-auto pt-16 md:pt-24'>
          <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[16px]'>[ Legal Matrix ]</span>
          <h1 className='text-5xl md:text-6xl font-black tracking-tighter mt-4'>Terms of Service</h1>
          <p className='mt-6 text-lg text-zinc-600 dark:text-zinc-300 max-w-3xl leading-relaxed'>
            Contractual terms governing the Yggchat service and your use of the platform.
          </p>
        </section>

        <section className='max-w-5xl mx-auto mt-10 border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm'>
          <div className='flex flex-wrap items-center justify-between gap-6 px-6 py-6 border-b border-zinc-200 dark:border-zinc-900'>
            <div>
              <p className='mono text-[16px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>Operator</p>
              <p className='text-lg font-semibold text-zinc-800 dark:text-zinc-100'>Yggchat (UK-based developer)</p>
            </div>
            <div>
              <p className='mono text-[16px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>Contact</p>
              <a href='mailto:support@yggchat.com' className='text-lg font-semibold text-[#0052FF]'>
                support@yggchat.com
              </a>
            </div>
          </div>

          <div className='px-6 py-8 space-y-8 text-zinc-700 dark:text-zinc-300'>
            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>1. Acceptance of Terms</h2>
              <p>
                By creating an account or using Yggchat (the “Service”), you agree to these Terms of Service (“Terms”).
                If you do not agree, do not use the Service.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>2. About Yggchat</h2>
              <p>
                Yggchat is an online chat and AI messaging platform operated by an independent UK-based developer. Full
                legal details are provided on invoices and available on request. The Service is available globally and
                may include free and paid features.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>3. Eligibility</h2>
              <ul className='list-disc ml-6 space-y-2'>
                <li>
                  You must be at least <strong>18 years old</strong> to create an account.
                </li>
                <li>You are responsible for maintaining the confidentiality of your login information.</li>
                <li>You agree to provide accurate and complete information.</li>
              </ul>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>4. Payments & Subscriptions</h2>
              <ul className='list-disc ml-6 space-y-2'>
                <li>
                  All payments are handled securely through <strong>Stripe</strong>.
                </li>
                <li>
                  By providing payment information, you agree to Stripe's Services Agreement and Privacy Policy,
                  available at stripe.com/legal. All payments are processed securely by Stripe, and Yggchat does not
                  store full card details.
                </li>
                <li>Subscriptions automatically renew unless cancelled before the next billing date.</li>
                <li>Fees are displayed in your local currency or GBP depending on region.</li>
                <li>Taxes (if applicable) are your responsibility.</li>
                <li>If a payment fails, access may be suspended until resolved.</li>
              </ul>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>5. Cancellations & Refunds</h2>
              <p>
                You may cancel your subscription at any time from your account settings. Access continues until the end
                of your current billing period. Refund terms are detailed in our{' '}
                <Link to='/refund-policy' className='underline hover:text-[#0052FF]'>
                  Refund Policy
                </Link>
                . All refunds are processed by Stripe on our behalf after we manually approve them.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>6. User Content & Conduct</h2>
              <p>
                You own the content you create on Yggchat. By using the Service, you grant us a limited, worldwide
                licence to host and process your content solely to operate the platform.
              </p>
              <p>
                You agree <strong>not</strong> to:
              </p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>Post illegal, harmful, or hateful content</li>
                <li>Share personal data of others without consent</li>
                <li>Distribute spam or malware</li>
                <li>Exploit or harm minors</li>
                <li>Violate intellectual property rights</li>
                <li>
                  Use the Service for: (i) adult content or services; (ii) gambling or drugs; (iii) weapons or tobacco;
                  (iv) sanctions-listed activities; or (v) any business on Stripe's Restricted Businesses List.
                </li>
              </ul>
              <p>We reserve the right to moderate or remove content and suspend users who breach these Terms.</p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>7. Privacy & Data</h2>
              <p>
                Your use of Yggchat is subject to our{' '}
                <Link to='/privacy' className='underline hover:text-[#0052FF]'>
                  Privacy Policy
                </Link>
                . We comply with the UK GDPR and use trusted third-party processors such as Stripe for payments and
                analytics services to improve the platform. We implement reasonable security measures to protect your
                data, including compliance with PCI DSS standards via Stripe.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>8. Service Availability</h2>
              <p>
                The Service is provided “as is” and “as available.” We may modify, suspend, or discontinue features at
                any time without notice.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>9. Limitation of Liability</h2>
              <p>To the fullest extent permitted by law:</p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>
                  Our total liability for any claim arising from your use of the Service is limited to the greater of
                  <strong> £100 GBP</strong> or the amount you paid in the past 12 months.
                </li>
                <li>We are not liable for indirect or consequential losses, including loss of data or profit.</li>
              </ul>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>10. Termination</h2>
              <p>
                We may suspend or terminate accounts for misuse or legal violations. You may close your account at any
                time. Termination does not affect rights or obligations already accrued.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>11. Governing Law</h2>
              <p>
                These Terms are governed by the laws of <strong>England and Wales</strong>, regardless of where you
                live. Users outside the UK agree that disputes will be handled under UK jurisdiction.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>12. Updates</h2>
              <p>
                We may update these Terms periodically. The current version will always be available at:{' '}
                <strong>https://yggchat.com/terms</strong>. Continued use after an update means you accept the new
                Terms.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>13. Contact</h2>
              <p>
                For questions, billing issues, or legal matters, contact: <strong>support@yggchat.com</strong>
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>14. Disputes</h2>
              <p>
                Any disputes arising from these Terms will be resolved exclusively in the courts of England and Wales.
                You agree to the electronic delivery of notices.
              </p>
            </section>
          </div>
        </section>

        <section className='max-w-5xl mx-auto mt-10 border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm px-6 py-6'>
          <p className='mono text-[16px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400 mb-2'>
            Need help?
          </p>
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <p className='text-sm text-zinc-600 dark:text-zinc-300'>
              If you have questions about these terms, contact our team.
            </p>
            <a
              href='mailto:support@yggchat.com'
              className='inline-flex items-center gap-2 border-2 border-[#0052FF] px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-[#0052FF] hover:bg-[#0052FF] hover:text-white transition-colors'
            >
              Support
              <i className='bx bx-right-arrow-alt text-lg'></i>
            </a>
          </div>
        </section>
      </main>
    </div>
  )
}

export default TermsOfService
