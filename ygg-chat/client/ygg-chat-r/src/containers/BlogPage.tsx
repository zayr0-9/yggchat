import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface BlogMeta {
  id: string
  slug: string
  title: string
  date: string
}

const BlogPage = () => {
  const [blogs, setBlogs] = useState<BlogMeta[]>([])
  const [selectedBlog, setSelectedBlog] = useState<BlogMeta | null>(null)
  const [blogContent, setBlogContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    let isActive = true

    fetch('/blogs/index.json')
      .then(res => res.json())
      .then((data: BlogMeta[]) => {
        if (!isActive) return
        setBlogs(data)
        if (data.length > 0) {
          setSelectedBlog(data[0])
        }
        setLoading(false)
      })
      .catch(() => {
        if (!isActive) return
        setLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!selectedBlog) return
    setBlogContent('')

    fetch(`/blogs/${selectedBlog.slug}.html`)
      .then(res => res.text())
      .then(html => setBlogContent(html))
      .catch(() => setBlogContent('<p>Failed to load blog content.</p>'))
  }, [selectedBlog])

  return (
    <div className='relative h-full min-h-screen w-full overflow-y-auto bg-white text-zinc-900 dark:bg-black dark:text-white'>
      <div className='pointer-events-none absolute inset-0 opacity-80'>
        <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,82,255,0.12),_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(0,82,255,0.2),_transparent_55%)]' />
        <div className='absolute inset-0 bg-[linear-gradient(to_right,rgba(24,24,27,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,24,27,0.08)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:80px_80px]' />
      </div>

      <header className='relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 md:px-12 py-6 border-b border-zinc-200 dark:border-zinc-900'>
        <Link
          to='/'
          className='mono text-[18px] tracking-[0.4em] text-white uppercase bg-zinc-900 px-3 py-2 hover:text-white/80 transition-colors'
        >
          ← Back
        </Link>
        <div className='flex items-center gap-3 text-[20px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
          <span className='mono'>Archive Node</span>
          <span className='hidden sm:inline'>/</span>
          <span className='mono'>Blog</span>
        </div>
        <Link
          to='/login'
          className='border-2 border-zinc-900 bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-white hover:bg-white hover:border-white hover:text-black transition-colors'
        >
          Sign In
        </Link>
      </header>

      <main className='relative z-10 px-6 md:px-12 pb-24'>
        <section className='max-w-6xl mx-auto pt-16 md:pt-24'>
          <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[16px]'>[ Research Logs ]</span>
          <h1 className='text-5xl md:text-6xl font-black tracking-tighter mt-4'>Yggdrasil Journal</h1>
          <p className='mt-6 text-lg text-zinc-600 dark:text-zinc-300 max-w-3xl leading-relaxed'>
            Dispatches from the root system: product updates, research notes, and architecture deep dives.
          </p>
        </section>

        <section className='max-w-6xl mx-auto mt-10 flex flex-col lg:flex-row gap-6'>
          <aside
            className={`border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm transition-all duration-300 lg:sticky lg:top-6 ${
              sidebarCollapsed ? 'lg:w-20' : 'lg:w-80'
            }`}
          >
            <div className='flex items-center justify-between px-6 py-5 border-b border-zinc-200 dark:border-zinc-900'>
              {!sidebarCollapsed && (
                <div>
                  <p className='mono text-[16px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
                    Archive
                  </p>
                  <h2 className='text-xl font-black uppercase tracking-tight'>Entries</h2>
                </div>
              )}
              <button
                type='button'
                onClick={() => setSidebarCollapsed(current => !current)}
                className='mono text-[#0052FF] text-lg hover:text-[#0052FF]/70 transition-colors'
                aria-label={sidebarCollapsed ? 'Expand archive' : 'Collapse archive'}
              >
                {sidebarCollapsed ? '›' : '‹'}
              </button>
            </div>

            <div className='px-4 py-4 max-h-[70vh] overflow-y-auto no-scrollbar'>
              {loading && <p className='text-sm text-zinc-500'>Loading entries...</p>}
              {!loading && blogs.length === 0 && <p className='text-sm text-zinc-500'>No blog entries found.</p>}
              {!loading &&
                blogs.map(blog => {
                  const isSelected = selectedBlog?.id === blog.id
                  return (
                    <button
                      key={blog.id}
                      type='button'
                      onClick={() => setSelectedBlog(blog)}
                      className={`w-full text-left px-4 py-3 mb-2 border-l-2 transition-colors ${
                        isSelected
                          ? 'border-[#0052FF] bg-[#0052FF]/10'
                          : 'border-transparent hover:bg-zinc-100/70 dark:hover:bg-white/5'
                      }`}
                    >
                      <div className='flex items-center justify-between gap-3'>
                        <span className='mono text-[12px] uppercase tracking-[0.3em] text-[#0052FF]'>#{blog.id}</span>
                        {!sidebarCollapsed && (
                          <span className='mono text-[12px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400'>
                            {blog.date}
                          </span>
                        )}
                      </div>
                      {!sidebarCollapsed && (
                        <div className='mt-2 text-sm font-semibold text-zinc-900 dark:text-white'>{blog.title}</div>
                      )}
                    </button>
                  )
                })}
            </div>
          </aside>

          <article className='flex-1 border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm px-6 py-8'>
            {selectedBlog ? (
              <>
                <header className='border-b border-zinc-200/70 dark:border-zinc-800/70 pb-6 mb-6'>
                  <span className='mono text-[16px] uppercase tracking-[0.3em] text-[#0052FF]'>#{selectedBlog.id}</span>
                  <h2 className='text-3xl md:text-4xl font-black mt-3'>{selectedBlog.title}</h2>
                  <p className='mono text-[16px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400 mt-2'>
                    {selectedBlog.date}
                  </p>
                </header>
                <div
                  className='blog-entry prose prose-lg dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300'
                  dangerouslySetInnerHTML={{ __html: blogContent }}
                />
              </>
            ) : (
              <div className='text-center text-zinc-500 dark:text-zinc-400 py-20'>
                Select a blog entry from the archive.
              </div>
            )}
          </article>
        </section>
      </main>
    </div>
  )
}

export default BlogPage
