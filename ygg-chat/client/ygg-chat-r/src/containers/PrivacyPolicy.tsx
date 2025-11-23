import React from 'react'
import { useNavigate } from 'react-router-dom'

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div className='h-screen overflow-hidden flex flex-col dark:bg-blue-900 bg-blue-200 text-neutral-900 dark:text-neutral-100'>
      <div className='flex-1 overflow-y-auto py-12 px-6'>
        <div className='max-w-4xl mx-auto'>
          {/* Header */}
          <div className='text-left p-8 mb-12 mica rounded-2xl'>
            <h1 className='text-4xl md:text-5xl font-bold text-stone-800 dark:text-neutral-100 mb-4'>
              Privacy Policy — Yggchat.com
            </h1>
            <div className='text-lg text-neutral-900 px-2 dark:text-neutral-100 mx-auto space-y-2'>
              <p>
                <strong>Effective Date:</strong> 12 November 2025
              </p>
              <p>
                <strong>Last Updated:</strong> 12 November 2025
              </p>
              <p>
                <strong>Operator/Data Controller:</strong> Independent UK-based developer operating as Yggchat.com
                (“we”, “our”, or “us”)
              </p>
              <p>
                <strong>Contact:</strong> support@yggchat.com
              </p>
              <p>
                <strong>Data Protection Officer:</strong> Not applicable (as a small UK-based developer); contact
                support for data matters.
              </p>
            </div>
          </div>

          <div className='bg-transparent mica rounded-2xl p-8 md:p-12'>
            <p className='mb-8 text-lg'>
              This Privacy Policy explains how independent UK-based developers operating Yggchat.com (“we”, “Service”,
              or the “Platform”), collects, uses, stores, and protects your personal data when you use our online chat
              and AI messaging service. We are committed to protecting your privacy and complying with the UK General
              Data Protection Regulation (UK GDPR) and other applicable data protection laws. By using the Service, you
              consent to the practices described here.
            </p>
            <p className='mb-8 text-lg'>
              If you do not agree, please do not use the Service. For questions, contact support@yggchat.com. This
              Policy forms part of our{' '}
              <a href='/terms' className='text-blue-600 dark:text-blue-400 hover:underline'>
                Terms of Service
              </a>
              .
            </p>

            <hr className='border-neutral-400 dark:border-neutral-600 my-8' />

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>1. Information We Collect</h2>
              <p className='mb-4 text-lg'>
                We collect the minimum data necessary to provide and improve the Service. Types of data include:
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Account and Profile Data</strong>: Email address, username, password (hashed), and age
                  verification (to confirm 18+ eligibility).
                </li>
                <li>
                  <strong>Usage and Content Data</strong>: Chat messages, AI interactions, and user-generated content
                  you create or share. This is stored to enable platform functionality.
                </li>
                <li>
                  <strong>Payment Data</strong>: If you subscribe, billing details (e.g., name, email) via Stripe. We do
                  not store full payment card details—Stripe handles this securely under PCI DSS.
                </li>
                <li>
                  <strong>Technical Data</strong>: Device info (e.g., IP address, browser type), usage logs (e.g.,
                  session times), and analytics data to improve performance.
                </li>
                <li>
                  <strong>Local Mode Data (Pro Feature)</strong>: In "Local Pro Mode" (a paid feature), enabling
                  "Privacy Mode" allows chats and AI data to be collected and processed only on your device (locally
                  stored). No data is sent to our servers in this mode, enhancing privacy.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                We do <strong>not</strong> collect sensitive personal data (e.g., health, political views) unless you
                voluntarily share it in chats (which we advise against).
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>2. How We Collect Data</h2>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Directly from You</strong>: During account creation, subscriptions, or chats.
                </li>
                <li>
                  <strong>Automatically</strong>: Via cookies, logs, and analytics tools (e.g., for crash reporting or
                  usage insights).
                </li>
                <li>
                  <strong>From Third Parties</strong>: Stripe for payment processing; limited analytics providers (e.g.,
                  Google Analytics if used—see Section 6). We do not buy or receive data from advertisers.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                In Local Pro Mode with Privacy Mode enabled, data collection is device-local only—no server transmission
                occurs unless you explicitly sync or share.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>3. How We Use Your Data</h2>
              <p className='mb-4 text-lg'>We use data solely to:</p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>Provide and maintain the Service (e.g., hosting chats, AI responses).</li>
                <li>Process payments and subscriptions (via Stripe).</li>
                <li>Improve the platform (e.g., anonymized analytics for bug fixes).</li>
                <li>Communicate with you (e.g., support emails, billing notices).</li>
                <li>Ensure compliance (e.g., age checks, fraud detection).</li>
                <li>Enforce our Terms (e.g., moderating prohibited content).</li>
              </ul>
              <p className='mb-4 text-lg'>
                Data is retained only as long as necessary for these purposes or until you delete your account (see
                Section 5). In Local Pro Mode, local data is managed by you and not retained by us beyond active
                sessions unless synced.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>4. Data Storage and Security</h2>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Storage Duration</strong>: We store your data until you delete your account or request erasure
                  (subject to legal retention, e.g., 6 years for billing under UK tax law). Upon deletion, all
                  associated data (e.g., chats, profile) is permanently removed from our servers within 30 days, except
                  for anonymized aggregates.
                </li>
                <li>
                  <strong>Local Storage</strong>: In Local Pro Mode with Privacy Mode, data is stored encrypted on your
                  device only. You control deletion—e.g., via app settings or device wipe.
                </li>
                <li>
                  <strong>Security Measures</strong>: Data is encrypted in transit (HTTPS/TLS) and at rest (e.g.,
                  AES-256). We use access controls, regular audits, and comply with PCI DSS via Stripe. As a small
                  developer, we limit access to essential personnel. However, no system is 100% secure—we cannot
                  guarantee against breaches but will notify you if one occurs (per GDPR).
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                We store data primarily in the UK/EU (e.g., secure cloud providers compliant with GDPR adequacy).
                Transfers outside (e.g., to US-based Stripe) use Standard Contractual Clauses for protection.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>5. Your Data Rights (GDPR)</h2>
              <p className='mb-4 text-lg'>
                Under UK GDPR, you have rights regarding your data. Email support@yggchat.com to exercise them—we
                respond within 1 month (free, unless excessive):
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Access</strong>: Request a copy of your data.
                </li>
                <li>
                  <strong>Rectification</strong>: Correct inaccurate data.
                </li>
                <li>
                  <strong>Erasure ("Right to be Forgotten")</strong>: Delete your data/account. In Local Pro Mode,
                  delete via device settings.
                </li>
                <li>
                  <strong>Restriction/Objection</strong>: Limit processing (e.g., for marketing— we don't do targeted
                  ads).
                </li>
                <li>
                  <strong>Portability</strong>: Receive data in a machine-readable format.
                </li>
                <li>
                  <strong>Withdraw Consent</strong>: If consent-based (e.g., non-essential cookies).
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                For account deletion: Log in &gt; Settings &gt; Delete Account. This revokes access and erases server
                data. Local data in Pro Mode requires manual device deletion. Appeals or complaints can be filed with
                the UK Information Commissioner's Office (ico.org.uk).
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>6. Sharing Your Data</h2>
              <p className='mb-4 text-lg'>
                We do <strong>not</strong> sell your data. Sharing is limited to:
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Service Providers</strong>: Stripe (payments), cloud hosts (storage), and analytics tools
                  (e.g., for aggregated insights—data is anonymized). All are GDPR-compliant.
                </li>
                <li>
                  <strong>Legal Requirements</strong>: If required by law (e.g., court order) or to protect
                  rights/safety.
                </li>
                <li>
                  <strong>Business Transfers</strong>: In a merger/acquisition, data may transfer with notice.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                No sharing with third parties for marketing. In Local Pro Mode, no data is shared with us or others
                unless you choose to (e.g., export chats).
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>7. Cookies and Tracking</h2>
              <p className='mb-4 text-lg'>
                We use essential cookies for functionality (e.g., session management) and optional analytics cookies
                (e.g., to track usage trends). You can manage them via browser settings or our app preferences. In Local
                Pro Mode, cookies are minimal/local. We comply with ePrivacy rules—no tracking without consent. For
                details, see our Cookie Policy (if separate) or contact support.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>8. Children's Privacy</h2>
              <p className='mb-4 text-lg'>
                The Service is for users 18+. We do not knowingly collect data from children under 18. If we discover
                such data, we delete it immediately.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>9. International Users</h2>
              <p className='mb-4 text-lg'>
                As a global service under UK jurisdiction, your data is processed per UK GDPR. Non-UK users may have
                additional rights under local laws (e.g., CCPA in California)—we honor verifiable requests where
                possible.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>10. Changes to This Policy</h2>
              <p className='mb-4 text-lg'>
                We may update this Privacy Policy periodically. The current version is at{' '}
                <a href='https://yggchat.com/privacy' className='text-blue-600 dark:text-blue-400 hover:underline'>
                  https://yggchat.com/privacy
                </a>
                . We'll notify you of material changes via email or in-app notice. Continued use after changes means
                acceptance.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>11. Contact</h2>
              <p className='mb-4 text-lg'>
                For privacy questions, data requests, or concerns:
                <br />
                <strong>Email:</strong> support@yggchat.com
                <br />
                We aim to respond within 5 business days. For UK GDPR complaints, contact the ICO first.
              </p>
            </section>
          </div>
        </div>
      </div>
      <footer className='relative z-10 py-4 px-6 text-center border-t border-white/10 bg-neutral-900/30 backdrop-blur-md'>
        <div className='max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4'>
          <div className='text-sm text-neutral-200'>
            © {new Date().getFullYear()} Yggchat.com. All rights reserved.
          </div>

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

export default PrivacyPolicy
