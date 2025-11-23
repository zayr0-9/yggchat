import React from 'react'
import { Link, useNavigate } from 'react-router-dom'

const TermsOfService: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div className='h-screen overflow-hidden flex flex-col text-neutral-900 dark:text-neutral-100'>
      <div className='flex-1 overflow-y-auto py-12 px-6'>
        <div className='max-w-4xl mx-auto'>
          <button onClick={() => navigate('/')} className='mb-6 px-4 py-2 mica text-white rounded-lg transition-colors'>
            ← Back to Home
          </button>
          {/* Header */}
          <div className='text-left mb-12 rounded-2xl p-8 mica'>
            <h1 className='text-4xl md:text-5xl font-bold text-stone-800 dark:text-neutral-100 mb-4'>
              Terms of Service — Yggchat
            </h1>
            <div className='text-lg text-neutral-900 text-left px-2 dark:text-neutral-100 mx-auto space-y-3'>
              <p>
                <strong>Operator:</strong> An independent UK-based developer operating as Yggchat (“we”, “our”, or “us”)
              </p>
              <p>
                <strong>Contact:</strong> support@yggchat.com
              </p>
            </div>
          </div>

          <div className='bg-transparent mica rounded-2xl p-8 md:p-12'>
            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>1. Acceptance of Terms</h2>
              <p className='mb-4 text-lg'>
                By creating an account or using Yggchat (the “Service”), you agree to these Terms of Service (“Terms”).
                <br />
                If you do not agree, do not use the Service.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>2. About Yggchat</h2>
              <p className='mb-4 text-lg'>
                Yggchat is an online chat and AI messaging platform operated by an independent UK-based developer. Full
                legal details are provided on invoices and available on request.
                <br />
                The Service is available globally and may include free and paid features.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>3. Eligibility</h2>
              <ul className='list-disc ml-6 mb-4 text-lg'>
                <li>
                  You must be at least <strong>18 years old</strong> to create an account.
                </li>
                <li>You are responsible for maintaining the confidentiality of your login information.</li>
                <li>You agree to provide accurate and complete information.</li>
              </ul>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>4. Payments & Subscriptions</h2>
              <ul className='list-disc ml-6 mb-4 text-lg'>
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

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>5. Cancellations & Refunds</h2>
              <p className='mb-4 text-lg'>
                You may cancel your subscription at any time from your account settings.
                <br />
                Access continues until the end of your current billing period.
                <br />
                Refund terms are detailed in our{' '}
                <a
                  href='https://yggchat.com/refund-policy'
                  className='underline hover:text-blue-600 dark:hover:text-blue-400'
                >
                  Refund Policy
                </a>
                . All refunds are processed by Stripe on our behalf after we manually approve them.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>6. User Content & Conduct</h2>
              <p className='mb-4 text-lg'>
                You own the content you create on Yggchat.
                <br />
                By using the Service, you grant us a limited, worldwide licence to host and process your content solely
                to operate the platform.
              </p>
              <p className='mb-4 text-lg'>
                You agree <strong>not</strong> to:
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg'>
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
              <p className='mb-4 text-lg'>
                We reserve the right to moderate or remove content and suspend users who breach these Terms.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>7. Privacy & Data</h2>
              <p className='mb-4 text-lg'>
                Your use of Yggchat is subject to our{' '}
                <a
                  href='https://yggchat.com/privacy'
                  className='underline hover:text-blue-600 dark:hover:text-blue-400'
                >
                  Privacy Policy
                </a>
                .
                <br />
                We comply with the UK GDPR and use trusted third-party processors such as Stripe for payments and
                analytics services to improve the platform.
                <br />
                We implement reasonable security measures to protect your data, including compliance with PCI DSS
                standards via Stripe.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>8. Service Availability</h2>
              <p className='mb-4 text-lg'>
                The Service is provided “as is” and “as available.”
                <br />
                We may modify, suspend, or discontinue features at any time without notice.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>9. Limitation of Liability</h2>
              <p className='mb-4 text-lg'>To the fullest extent permitted by law:</p>
              <ul className='list-disc ml-6 mb-4 text-lg'>
                <li>
                  Our total liability for any claim arising from your use of the Service is limited to the greater of{' '}
                  <strong>£100 GBP</strong> or the amount you paid in the past 12 months.
                </li>
                <li>We are not liable for indirect or consequential losses, including loss of data or profit.</li>
              </ul>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>10. Termination</h2>
              <p className='mb-4 text-lg'>
                We may suspend or terminate accounts for misuse or legal violations.
                <br />
                You may close your account at any time. Termination does not affect rights or obligations already
                accrued.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>11. Governing Law</h2>
              <p className='mb-4 text-lg'>
                These Terms are governed by the laws of <strong>England and Wales</strong>, regardless of where you
                live.
                <br />
                Users outside the UK agree that disputes will be handled under UK jurisdiction.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>12. Updates</h2>
              <p className='mb-4 text-lg'>
                We may update these Terms periodically.
                <br />
                The current version will always be available at: <strong>https://yggchat.com/terms</strong>
                <br />
                Continued use after an update means you accept the new Terms.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>13. Contact</h2>
              <p className='mb-4 text-lg'>
                For questions, billing issues, or legal matters, contact:
                <br />
                <strong>support@yggchat.com</strong>
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>14. Disputes</h2>
              <p className='mb-4 text-lg'>
                Any disputes arising from these Terms will be resolved exclusively in the courts of England and Wales.
                You agree to the electronic delivery of notices.
              </p>
            </section>
          </div>
        </div>
      </div>
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
    </div>
  )
}

export default TermsOfService
