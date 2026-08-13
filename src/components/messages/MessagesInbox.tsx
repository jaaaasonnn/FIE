'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Search, Send } from 'lucide-react'
import {
  type ApiMessage,
  type ChatMessage,
  type Conversation,
  apiMessagesToChat,
  conversationKey,
  formatRelativeTime,
  groupConversations,
  mergeChatMessages,
} from '@/lib/messages'

const POLL_MS = 8000

type SeedPeer = {
  otherUserId: string
  otherName?: string
  otherPhoto?: string | null
  listingId?: string | null
  listingTitle?: string | null
  bookingId?: string | null
}

type Props = {
  userId: string
  /** guest | host — only affects empty-state copy */
  role: 'guest' | 'host'
  /** Open / create a thread from query params (Message Host entry) */
  seed?: SeedPeer | null
  nav?: React.ReactNode
}

export function MessagesInbox({ userId, role, seed = null, nav }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mobileThread, setMobileThread] = useState(false)
  const [newMsg, setNewMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [search, setSearch] = useState('')
  const [seedMeta, setSeedMeta] = useState<{
    otherName: string
    otherPhoto: string | null
    listingTitle: string
  } | null>(null)

  const threadEndRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  const activePeerRef = useRef<{
    otherUserId: string
    listingId: string | null
    bookingId: string | null
  } | null>(null)
  activeIdRef.current = activeId

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )

  useEffect(() => {
    activePeerRef.current = activeConv
      ? {
          otherUserId: activeConv.otherUserId,
          listingId:   activeConv.listingId,
          bookingId:   activeConv.bookingId,
        }
      : null
  }, [activeConv])

  // Resolve seed peer display info (listing title / host name)
  useEffect(() => {
    if (!seed?.otherUserId) {
      setSeedMeta(null)
      return
    }
    let cancelled = false

    async function resolve() {
      let otherName = seed!.otherName ?? 'User'
      let otherPhoto = seed!.otherPhoto ?? null
      let listingTitle = seed!.listingTitle ?? 'Conversation'

      if (seed!.listingId && !seed!.listingTitle) {
        try {
          const res = await fetch(`/api/listings/${seed!.listingId}`)
          const data = await res.json()
          const l = data.listing ?? data
          if (l?.title) listingTitle = l.title
          if (l?.host?.name && seed!.otherUserId === l.host.id) {
            otherName = l.host.name
            otherPhoto = l.host.profilePhoto ?? null
          }
        } catch { /* ignore */ }
      }

      if (!seed!.otherName || seed!.otherName === 'User') {
        try {
          const res = await fetch(`/api/users/${seed!.otherUserId}`)
          if (res.ok) {
            const data = await res.json()
            const u = data.user ?? data
            if (u?.name) otherName = u.name
            if (u?.profilePhoto) otherPhoto = u.profilePhoto
          }
        } catch { /* ignore */ }
      }

      if (!cancelled) {
        setSeedMeta({ otherName, otherPhoto, listingTitle })
      }
    }

    resolve()
    return () => { cancelled = true }
  }, [seed])

  const ensureSeedConversation = useCallback(
    (grouped: Conversation[]): Conversation[] => {
      if (!seed?.otherUserId) return grouped
      const id = conversationKey(seed.otherUserId, {
        bookingId: seed.bookingId,
        listingId: seed.listingId,
      })
      if (grouped.some((c) => c.id === id)) return grouped

      const empty: Conversation = {
        id,
        otherUserId:  seed.otherUserId,
        otherName:    seedMeta?.otherName ?? seed.otherName ?? 'User',
        otherPhoto:   seedMeta?.otherPhoto ?? seed.otherPhoto ?? null,
        listingTitle: seedMeta?.listingTitle ?? seed.listingTitle ?? 'Conversation',
        listingId:    seed.listingId ?? null,
        bookingId:    seed.bookingId ?? null,
        lastMessage:  'Start the conversation…',
        time:         '',
        lastAt:       Date.now(),
        unread:       0,
        messages:     [],
      }
      return [empty, ...grouped]
    },
    [seed, seedMeta],
  )

  const markRead = useCallback(async (conv: Conversation) => {
    if (conv.unread === 0) return
    try {
      await fetch('/api/messages', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otherUserId: conv.otherUserId,
          listingId:   conv.listingId,
          bookingId:   conv.bookingId,
        }),
      })
    } catch { /* ignore */ }
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread: 0 } : c)),
    )
  }, [])

  const loadInbox = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch('/api/messages')
      const data = await res.json()
      if (!res.ok) {
        if (!opts?.silent) {
          setConversations(ensureSeedConversation([]))
        }
        return
      }
      const msgs = Array.isArray(data.messages) ? (data.messages as ApiMessage[]) : []
      let grouped = groupConversations(msgs, userId)
      grouped = ensureSeedConversation(grouped)

      // While a thread is open, refresh its messages from the full inbox grouping
      setConversations((prev) => {
        const currentId = activeIdRef.current
        if (!currentId) return grouped
        const fresh = grouped.find((c) => c.id === currentId)
        const old = prev.find((c) => c.id === currentId)
        if (fresh && old) {
          return grouped.map((c) =>
            c.id === currentId
              ? { ...c, messages: mergeChatMessages(old.messages, fresh.messages), unread: c.unread }
              : c,
          )
        }
        return grouped
      })

      setActiveId((prev) => {
        if (prev && grouped.some((c) => c.id === prev)) return prev
        if (seed?.otherUserId) {
          return conversationKey(seed.otherUserId, {
            bookingId: seed.bookingId,
            listingId: seed.listingId,
          })
        }
        return grouped[0]?.id ?? null
      })
    } catch {
      if (!opts?.silent) setConversations(ensureSeedConversation([]))
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [userId, ensureSeedConversation, seed])

  // Open seed thread on mobile when arriving from Message Host
  useEffect(() => {
    if (seed?.otherUserId) setMobileThread(true)
  }, [seed?.otherUserId])

  // Initial load + when seed meta arrives (to refresh empty thread labels)
  useEffect(() => {
    loadInbox()
  }, [loadInbox])

  // Poll while a conversation is open
  useEffect(() => {
    if (!activeId) return

    const tick = async () => {
      const peer = activePeerRef.current
      const convId = activeIdRef.current
      if (!peer || !convId) return
      try {
        const q = new URLSearchParams({ otherUserId: peer.otherUserId })
        if (peer.listingId) q.set('listingId', peer.listingId)
        if (peer.bookingId) q.set('bookingId', peer.bookingId)
        const res = await fetch(`/api/messages?${q}`)
        const data = await res.json()
        if (!res.ok) return
        const msgs = Array.isArray(data.messages) ? (data.messages as ApiMessage[]) : []
        const chat = apiMessagesToChat(msgs, userId)
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c
            const merged = mergeChatMessages(c.messages, chat)
            const last = merged[merged.length - 1]
            return {
              ...c,
              messages:    merged,
              lastMessage: last?.text ?? c.lastMessage,
              time:        last ? formatRelativeTime(last.createdAt) : c.time,
              lastAt:      last ? new Date(last.createdAt).getTime() : c.lastAt,
              unread:      0,
            }
          }),
        )
      } catch { /* ignore */ }
    }

    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [activeId, userId])

  // Mark read when opening a conversation
  useEffect(() => {
    if (!activeConv) return
    markRead(activeConv)
  }, [activeConv?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeConv?.messages.length])

  // Update empty seed labels when meta resolves
  useEffect(() => {
    if (!seedMeta || !seed?.otherUserId) return
    const id = conversationKey(seed.otherUserId, {
      bookingId: seed.bookingId,
      listingId: seed.listingId,
    })
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id && c.messages.length === 0
          ? {
              ...c,
              otherName:    seedMeta.otherName,
              otherPhoto:   seedMeta.otherPhoto,
              listingTitle: seedMeta.listingTitle,
            }
          : c,
      ),
    )
  }, [seedMeta, seed])

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations
    const q = search.toLowerCase()
    return conversations.filter(
      (c) =>
        c.otherName.toLowerCase().includes(q) ||
        c.listingTitle.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q),
    )
  }, [conversations, search])

  function selectConv(conv: Conversation) {
    setActiveId(conv.id)
    setMobileThread(true)
    setSendError('')
    markRead(conv)
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMsg.trim() || !activeConv || sending) return
    setSending(true)
    setSendError('')
    const text = newMsg.trim()
    try {
      const res = await fetch('/api/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverId: activeConv.otherUserId,
          listingId:  activeConv.listingId,
          bookingId:  activeConv.bookingId,
          content:    text,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSendError(data.error || `Failed to send (${res.status})`)
        return
      }

      const msg = data.message as ApiMessage
      const chatMsg: ChatMessage = {
        id:        msg.id,
        mine:      true,
        text:      msg.content,
        time:      'Just now',
        createdAt: msg.createdAt,
      }

      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeConv.id
            ? {
                ...c,
                lastMessage: chatMsg.text,
                time:        'Just now',
                lastAt:      Date.now(),
                messages:    mergeChatMessages(c.messages, [chatMsg]),
              }
            : c,
        )
        return updated.sort((a, b) => b.lastAt - a.lastAt)
      })
      setNewMsg('')
    } catch {
      setSendError('Network error. Please check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  const emptyCopy =
    role === 'guest'
      ? 'When you reach out to a host — or they reply — your chats will show up here.'
      : 'When a guest messages you about a stay, the conversation will land here.'

  if (loading) {
    return (
      <div className="soft-panel flex items-center justify-center" style={{ height: '600px' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading messages…</p>
        </div>
      </div>
    )
  }

  const showEmpty = conversations.length === 0

  return (
    <div>
      {nav}

      {showEmpty ? (
        <div className="soft-panel flex items-center justify-center" style={{ height: '600px' }}>
          <div className="text-center px-4">
            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Your inbox is quiet</h3>
            <p className="text-sm max-w-sm mx-auto" style={{ color: 'var(--color-text-secondary)' }}>{emptyCopy}</p>
          </div>
        </div>
      ) : (
        <div className="soft-panel overflow-hidden" style={{ height: '600px', display: 'flex' }}>
          {/* Sidebar */}
          <div
            className={`w-full sm:w-72 flex-shrink-0 border-r border-stone-100 flex-col ${
              mobileThread ? 'hidden sm:flex' : 'flex'
            }`}
          >
            <div className="p-4 border-b border-stone-100">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-50">
                <Search size={14} className="text-stone-400" />
                <input
                  placeholder={role === 'guest' ? 'Search messages...' : 'Search guests...'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 text-sm bg-transparent border-none outline-none"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => selectConv(conv)}
                  className="w-full p-4 flex items-start gap-3 text-left transition-all hover:bg-stone-50 border-b border-stone-50"
                  style={{ backgroundColor: activeConv?.id === conv.id ? '#FFF8EE' : undefined }}
                >
                  <div className="relative flex-shrink-0">
                    {conv.otherPhoto ? (
                      <img src={conv.otherPhoto} alt={conv.otherName} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}
                      >
                        {(conv.otherName || '?')[0]}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                        {conv.otherName}
                      </span>
                      <span className="text-xs text-stone-400">{conv.time}</span>
                    </div>
                    <p className="text-xs text-[#6B645C] truncate">{conv.listingTitle}</p>
                    <p className="text-xs text-stone-400 truncate mt-0.5">{conv.lastMessage}</p>
                  </div>
                  {conv.unread > 0 && (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                    >
                      {conv.unread}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Thread */}
          <div
            className={`flex-col flex-1 ${
              mobileThread ? 'flex' : 'hidden sm:flex'
            }`}
          >
            {activeConv ? (
              <>
                <div className="p-4 border-b border-stone-100 flex items-center gap-3">
                  <button
                    type="button"
                    className="sm:hidden p-1.5 rounded-lg hover:bg-stone-50"
                    onClick={() => setMobileThread(false)}
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft size={18} style={{ color: 'var(--color-text-primary)' }} />
                  </button>
                  {activeConv.otherPhoto ? (
                    <img src={activeConv.otherPhoto} alt={activeConv.otherName} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}
                    >
                      {(activeConv.otherName || '?')[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {activeConv.otherName}
                    </p>
                    <p className="text-xs text-[#6B645C] truncate">{activeConv.listingTitle}</p>
                  </div>
                  {activeConv.listingId && (
                    <Link
                      href={`/listings/${activeConv.listingId}`}
                      className="text-xs px-3 py-1.5 rounded-full border border-stone-200 text-[#6B645C] hover:bg-stone-50 flex-shrink-0"
                    >
                      View Listing
                    </Link>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ backgroundColor: 'var(--color-bg)' }}>
                  <div
                    className="p-3 rounded-xl text-center text-xs"
                    style={{ backgroundColor: '#FBE8BB', color: '#92400E' }}
                  >
                    Never share payment details outside FieGH. Report suspicious requests.
                  </div>

                  {activeConv.messages.length === 0 && (
                    <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-secondary)' }}>
                      No messages yet — say hello about {activeConv.listingTitle}.
                    </p>
                  )}

                  {activeConv.messages.map((m) => (
                    <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-xs lg:max-w-sm px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          m.mine ? 'rounded-br-md' : 'rounded-bl-md'
                        }`}
                        style={
                          m.mine
                            ? { backgroundColor: 'var(--brown-dark)', color: 'var(--cream)' }
                            : { backgroundColor: '#fff', color: '#1F2937', border: '1px solid #E5E7EB' }
                        }
                      >
                        {m.text}
                        <div className={`text-xs mt-1 ${m.mine ? 'text-right opacity-60' : 'text-stone-400'}`}>
                          {m.time}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={threadEndRef} />
                </div>

                {sendError && (
                  <div
                    className="mx-4 mt-2 rounded-xl px-3 py-2 text-xs font-medium"
                    style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                    role="alert"
                  >
                    {sendError}
                  </div>
                )}

                <form onSubmit={sendMessage} className="p-4 border-t border-stone-100 flex items-center gap-3 bg-white">
                  <input
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    placeholder={role === 'guest' ? 'Type a message...' : 'Type a message to your guest...'}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={sending || !newMsg.trim()}
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:opacity-90"
                    style={{ backgroundColor: 'var(--color-accent)', opacity: sending || !newMsg.trim() ? 0.6 : 1 }}
                  >
                    {sending ? (
                      <Loader2 size={16} className="animate-spin" style={{ color: '#fff' }} />
                    ) : (
                      <Send size={16} style={{ color: '#fff' }} />
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Select a conversation
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
