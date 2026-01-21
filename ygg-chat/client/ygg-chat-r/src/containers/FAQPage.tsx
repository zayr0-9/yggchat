import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

interface FaqItem {
  question: string
  answer: string[]
}

interface FaqSection {
  title: string
  items: FaqItem[]
}

const FAQPage: React.FC = () => {
  const sections = useMemo<FaqSection[]>(
    () => [
      {
        title: 'Product Overview & Core Concept',
        items: [
          {
            question: 'What is Yggdrasil and how is it different from ChatGPT, Claude, or other AI interfaces?',
            answer: [
              'Yggdrasil is a branching-first AGI interface. Instead of locking you into a linear chat, every message can be edited and branched so you can explore alternatives without losing history.',
              'Linear chats force you to pick one path; Yggdrasil keeps all paths in one tree so you can compare, iterate, and reroll from any point.',
            ],
          },
          {
            question: 'What does "the most advanced AGI interface" mean?',
            answer: [
              "LLMs can feel like slot machines—lucky or unlucky per run. We call it an 'Artificial Gacha Interface' to acknowledge that randomness. Yggdrasil gives you the most powerful controls to use any 'AGI' model effectively.",
              'Branching, model routing, and agentic control together make it the most capable interface to harness modern models.',
            ],
          },
          {
            question: 'Who is Yggdrasil built for?',
            answer: [
              'Everyone, office work, developers, hobbyists, researchers, enterprises, and power users who need rigorous control over context, branching, and models.',
            ],
          },
          {
            question: 'Do I still need accounts with OpenAI, Anthropic, etc.?',
            answer: [
              'No. We use OpenRouter as the provider and offer 400+ models—no separate provider accounts needed.',
            ],
          },
        ],
      },
      {
        title: 'Branching & Conversation Management',
        items: [
          {
            question: 'How does branching work? Can I really branch from any message?',
            answer: [
              'Yes. Under each message is a control panel. Click edit to modify in place, or branch to send the edited message and create a new branch. The branch shows up in the tree view.',
            ],
          },
          {
            question: "What's the difference between a branch and a regular chat?",
            answer: [
              'Work rarely succeeds in one shot. Branching mirrors iterative thinking—explore multiple takes before committing. A branch is just a focused path you can iterate on without losing others.',
            ],
          },
          {
            question: 'How many branches can I create? Are there limits?',
            answer: [
              'No limits on branch count or depth. We use occlusion (like in games) to cull non-visible nodes and keep performance constant.',
            ],
          },
          {
            question: 'Can I merge branches or combine insights from different paths?',
            answer: [
              'Yes. In tree view, right-click, hold, and drag to select a branch or messages. An options menu lets you start a new chat with the selected messages in order, or copy them.',
              'Use the Notes panel (bottom right) as a scratchpad. Right-click selected text in any message to send it to Notes.',
            ],
          },
          {
            question: 'What happens if I delete a branch? Is my data gone forever?',
            answer: ['Yes. Deleting a branch permanently removes its data.'],
          },
        ],
      },
      {
        title: 'Context Management & Cost Control',
        items: [
          {
            question: 'How does Yggdrasil save me money on API costs?',
            answer: [
              'Spin subtopics into their own branches. Each branch stays short, lowering context tokens per call and improving model quality. Avoids paying for bloated, mixed-topic context.',
            ],
          },
          {
            question: 'What is "context rot" and how do you prevent it?',
            answer: [
              'Context rot = performance drops as context grows and diverges. Branching keeps context short and topic-pure, preventing drift and hallucinations.',
            ],
          },
          {
            question: 'Can I control what context is sent to the model?',
            answer: [
              'Yes. Set a project-level system prompt/context plus a chat-level system prompt/context; they append. You can also edit agent responses and tool calls, and manually prune/compact if you want.',
            ],
          },
          {
            question: 'How much context can I keep in a branch?',
            answer: [
              'Depends on the selected LLM. Click the three-dot menu next to a model name to see its context window.',
            ],
          },
          {
            question: 'Will branching increase my costs since I have multiple conversations?',
            answer: [
              'No. Only the currently selected branch is sent to the model. Parallel branches do not add cost unless used.',
            ],
          },
        ],
      },
      {
        title: 'Agentic Features & Security',
        items: [
          {
            question: 'What are AI agents in Yggdrasil and how do they work?',
            answer: [
              'Yggdrasil ships with Valkyrie, a custom agent. Tools are listed in the chat settings panel (cog on input). Enable/disable what you want.',
              'Valkyrie can read/edit/create/delete files, browse directories, search files, manage todos, search the web, browse web, and run terminal (local mode). In cloud mode: only web search/browse web in app; on website: web search only for now.',
            ],
          },
          {
            question: 'How do permissions work for agents? Can they access my files?',
            answer: [
              'On the chat input, click the three-dot button to set CWD. Agents are sandboxed to that path. VS Code extension can auto-fill your project path.',
              'Valkyrie tools are blocked from paths outside the CWD.',
            ],
          },
          {
            question: "What's the difference between Chat mode and Agent mode?",
            answer: [
              'Chat mode: tool calls (except web search/browse/todo) are denied; the agent must stay in plan mode. Agent mode lifts that block but still respects the allow/don’t allow/allow all permissions layer.',
            ],
          },
          {
            question: 'Can agents maintain state across multiple steps?',
            answer: [
              'Yes. Valkyrie keeps execution state within the branch without bloating global context—stateful runs, minimal token waste.',
            ],
          },
        ],
      },
      {
        title: 'Model Routing & Performance',
        items: [
          {
            question: 'What models does Yggdrasil support?',
            answer: [
              '400+ models via OpenRouter, including Gemini-3, GPT 5.1 Codex Max, Claude Opus 4.5, many open-source and smaller-lab models. Yggdrasil surfaces the newest models fast.',
            ],
          },
          {
            question: 'How does model routing work? Can I switch models mid-conversation?',
            answer: [
              'Yes. Before sending a message or branching, change the model. Use a strong model for planning, a cheaper one for execution or web search. Mix and match per branch.',
            ],
          },
          {
            question: 'Can I compare different models on the same prompt?',
            answer: ['Yes. Branch the same prompt across multiple models to A/B test outputs side by side.'],
          },
          {
            question: 'What are specialized models and when should I use them?',
            answer: [
              'We recommend GPT 5.1 Codex Max (our build workhorse). Other great options: Gemini-3 and Claude family. You can also plan in Yggdrasil and use Claude Code integration (Anthropic harness) to implement within Yggdrasil.',
            ],
          },
        ],
      },
      {
        title: 'Privacy & Data Ownership',
        items: [
          {
            question: 'What does "local-first operation" mean?',
            answer: [
              'You can keep projects/chats entirely on your local PC in a user-accessible SQLite DB. We store nothing for local-mode chats. Cloud-mode projects are stored by us.',
            ],
          },
          {
            question: 'Will my code and conversations be used for training AI models?',
            answer: [
              'We do not store messages in Local Mode. Provider policies are shown to you; you can pick privacy-focused models.',
            ],
          },
          {
            question: 'Can I export my data? In what formats?',
            answer: ['Data is in a simple user-accessible SQLite .db file. A friendlier export is in development.'],
          },
          {
            question: 'What happens if my account is suspended? Do I lose my work?',
            answer: [
              'We comply with legal requirements. Illegal activity can lead to suspension. Your local data remains available to you.',
            ],
          },
        ],
      },
      {
        title: 'Technical & Getting Started',
        items: [
          {
            question: 'How do I get started with Yggdrasil?',
            answer: [
              'Log in with Google or GitHub. Open the default Quick Chat project or create your own. Free users get 50 free messages.',
              'You can also try the Yggdrasil App from the download button on the homepage. Windows/macOS may show SmartScreen; we are working on signed builds. Linux has no such issues.',
            ],
          },
          {
            question: 'What platforms does Yggdrasil support?',
            answer: ['Web, Linux, macOS, and Windows desktop app.'],
          },
          {
            question: 'Do you offer an API or SDK for integration?',
            answer: ['Not yet. Custom MCP and Tool integration are on the roadmap.'],
          },
          {
            question: 'Can I import my conversation history from ChatGPT/Claude?',
            answer: ['Not currently.'],
          },
        ],
      },
      {
        title: 'Pricing & Plans',
        items: [
          {
            question: 'How much does Yggdrasil cost?',
            answer: [
              'Three tiers: Basic (daily assistant, non-dev), Pro (>2x usage, ideal for developers), Ultra (max usage for power users).',
            ],
          },
          {
            question: 'Do I pay you or the model providers directly?',
            answer: ['You pay Yggdrasil. Providers do not access your personal or financial info.'],
          },
          {
            question: 'Is there a free tier or trial?',
            answer: ['Yes. On sign-in, you get 50 free messages.'],
          },
          {
            question: 'What happens if I exceed my usage limits?',
            answer: ['We notify you when you run out of credits.'],
          },
        ],
      },
      {
        title: 'Use Cases & Best Practices',
        items: [
          {
            question: "What's the best way to use branches for software development?",
            answer: [
              'Use Chat mode to explore the problem and its subtopics in separate branches. Once you have a holistic view, guide the model to produce a detailed plan.',
              'Then switch to the best agentic model and ask it to implement. Short, focused context → better performance and lower cost.',
            ],
          },
          {
            question: 'How can researchers benefit from Yggdrasil?',
            answer: ["It's an excellent interface to test and compare LLM outputs quickly across models and branches."],
          },
          {
            question: 'Can teams collaborate on branches?',
            answer: ['Not yet—planned feature.'],
          },
          {
            question: 'What are some common workflows or patterns I should follow?',
            answer: [
              'See best practices: branch early, keep contexts short, compare models via branching, use Notes to merge insights, and switch models per task.',
            ],
          },
        ],
      },
      {
        title: 'Support & Troubleshooting',
        items: [
          {
            question: "I'm stuck. Where can I get help?",
            answer: ['Email support@yggchat.com.'],
          },
          {
            question: 'How do I report bugs or suggest features?',
            answer: ['Join our Discord: https://discord.gg/7Zmvteg5t2'],
          },
          {
            question: 'What if a model gives me bad results? Is that your fault?',
            answer: ["Switch models easily to isolate whether it's Yggdrasil or the model."],
          },
        ],
      },
    ],
    []
  )

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    sections.forEach(section => {
      initial[section.title] = true
    })
    return initial
  })
  const [openItems, setOpenItems] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    sections.forEach(section => {
      section.items.forEach(item => {
        initial[`${section.title}::${item.question}`] = true
      })
    })
    return initial
  })
  const [search, setSearch] = useState('')

  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections
    const q = search.toLowerCase()
    return sections
      .map(section => {
        const items = section.items.filter(
          item => item.question.toLowerCase().includes(q) || item.answer.some(a => a.toLowerCase().includes(q))
        )
        return { ...section, items }
      })
      .filter(section => section.items.length > 0)
  }, [search, sections])

  const toggleSection = (title: string) => {
    setOpenSections(prev => ({ ...prev, [title]: !prev[title] }))
  }

  const toggleItem = (key: string) => {
    setOpenItems(prev => ({ ...prev, [key]: !prev[key] }))
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
        <div className='flex items-center gap-3 text-[20px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
          <span className='mono'>Support Node</span>
          <span className='hidden sm:inline'>/</span>
          <span className='mono'>FAQ</span>
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
          <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[16px]'>[ Support Index ]</span>
          <h1 className='text-5xl md:text-7xl font-black tracking-tighter mt-4'>FAQ NODE</h1>
          <p className='mt-6 text-xl text-zinc-600 dark:text-zinc-300 max-w-3xl leading-relaxed'>
            Direct answers to branching, context control, agentic execution, and routing. Search the knowledge base or
            open a section to drill into operational detail.
          </p>

          <div className='mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6'>
            <div className='flex flex-col gap-3'>
              <label className='mono text-[18px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                Search the index
              </label>
              <div className='flex items-center gap-3 border-2 border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/60 px-4 py-3'>
                <i className='bx bx-search text-zinc-400 text-lg' aria-hidden='true'></i>
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder='Search questions...'
                  className='w-full bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none'
                />
              </div>
            </div>

            <div className='border-2 border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/70 px-6 py-6'>
              <p className=' text-[16px] font-semibold uppercase tracking-[0.3em] text-[#0052FF] mb-4'>
                Priority Support
              </p>
              <p className='text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed'>
                If your question is not covered, route to the support channel and we will respond.
              </p>
              <a
                href='mailto:support@yggchat.com'
                className='mt-6 inline-flex items-center gap-2 border-2 border-[#0052FF] px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-[#0052FF] hover:bg-[#0052FF] hover:text-white transition-colors'
              >
                Contact
                <i className='bx bx-right-arrow-alt text-lg'></i>
              </a>
            </div>
          </div>
        </section>

        <section className='max-w-6xl mx-auto mt-12 space-y-8'>
          {filteredSections.map(section => (
            <div
              key={section.title}
              className='border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm'
            >
              <button
                onClick={() => toggleSection(section.title)}
                className='w-full flex flex-wrap items-center justify-between gap-4 px-6 py-6 text-left'
              >
                <div className='flex items-center gap-4'>
                  <div className='w-1.5 h-10 bg-[#0052FF]' />
                  <div>
                    <p className='mono text-[14px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                      Section
                    </p>
                    <h2 className='text-xl md:text-2xl font-black uppercase tracking-tight'>{section.title}</h2>
                  </div>
                </div>
                <div className='flex items-center gap-4 text-[14px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                  <span>{section.items.length} entries</span>
                  <i
                    className={`bx bx-chevron-${openSections[section.title] ? 'up' : 'down'} text-2xl text-zinc-500 dark:text-zinc-300`}
                  ></i>
                </div>
              </button>

              <div
                className={`px-6 pb-6 border-t border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
                  openSections[section.title] ? 'max-h-[2400px] opacity-100' : 'max-h-0 opacity-0'
                }`}
                aria-hidden={!openSections[section.title]}
              >
                <div className={openSections[section.title] ? 'pt-6 space-y-6' : 'pt-0'}>
                  {section.items.map((item, itemIndex) => {
                    const itemKey = `${section.title}::${item.question}`
                    const isOpen = openItems[itemKey] ?? true
                    const itemId = `faq-item-${section.title.replace(/\\s+/g, '-').toLowerCase()}-${itemIndex}`

                    return (
                      <div key={item.question} className='border-b border-zinc-200/70 dark:border-zinc-800/70 pb-6'>
                        <button
                          type='button'
                          onClick={() => toggleItem(itemKey)}
                          aria-expanded={isOpen}
                          aria-controls={itemId}
                          className='w-full text-left text-lg md:text-xl font-semibold text-zinc-900 dark:text-white flex items-start justify-between gap-4 transition-colors'
                        >
                          <span>{item.question}</span>
                          <i
                            className={`bx bx-chevron-down text-xl text-zinc-500 transition-transform duration-200 ${
                              isOpen ? 'rotate-180' : ''
                            }`}
                          ></i>
                        </button>
                        <div
                          id={itemId}
                          className={`grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out ${
                            isOpen ? 'grid-rows-[1fr] opacity-100' : ''
                          }`}
                        >
                          <div className='min-h-0 overflow-hidden'>
                            <div className='mt-3 space-y-2 text-zinc-600 dark:text-zinc-300 leading-relaxed'>
                              {item.answer.map((line, idx) => (
                                <p key={idx}>{line}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}

          {filteredSections.length === 0 && (
            <div className='text-center text-zinc-500 dark:text-zinc-400 py-12 border-2 border-dashed border-zinc-300 dark:border-zinc-800'>
              No results. Try another keyword.
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default FAQPage
