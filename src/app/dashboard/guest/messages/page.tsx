'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Send, Search, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

type ApiMessage = {
  id: string
  senderId: string
  receiverId: string
  bookingId: string | null
  content: string
  isRead: boolean
  createdAt: string
  sender:   { id: string; name: string | null; profilePhoto: string | null }
  receiver: { id: string; name: string | null; profilePhoto: string | null }
  booking:  { id: string; listing: { id: string; title: string } } | null
}

type ChatMessage = {
  id: string
  from: 'guest' | 'host'
  text: string
  time: string
}

type Conversation = {
  id: string
  otherUserId: string
  hostName: string
  hostPhoto: string | null
  listing: string
  listingId: string | null
  bookingId: string | null
  lastMessage: string
  time: string
  unread: number
  messages: ChatMessage[]
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })
}

function groupConversations(messages: ApiMessage[], userId: string): Conversation[] {
  const map = new Map<string, ApiMessage[]>()

  for (const m of messages) {
    const otherId = m.senderId === userId ? m.receiverId : m.senderId
    const key = m.bookingId ? `${otherId}:${m.bookingId}` : otherId
    const list = map.get(key) ?? []
    list.push(m)
    map.set(key, list)
  }

  const conversations: Conversation[] = []

  for (const [key, msgs] of map) {
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const last = msgs[msgs.length - 1]
    const other = last.senderId === userId ? last.receiver : last.sender
    const unread = msgs.filter((m) => m.receiverId === userId && !m.isRead).length
    const booking = msgs.find((m) => m.booking)?.booking ?? null

    conversations.push({
      id:          key,
      otherUserId: other.id,
      hostName:    other.name ?? 'Host',
      hostPhoto:   other.profilePhoto,
      listing:     booking?.listing.title ?? 'Conversation',
      listingId:   booking?.listing.id ?? null,
      bookingId:   booking?.id ?? null,
      lastMessage: last.content,
      time:        formatRelativeTime(last.createdAt),
      unread,
      messages: msgs.map((m) => ({
        id:   m.id,
        from: m.senderId === userId ? 'guest' : 'host',
        text: m.content,
        time: formatRelativeTime(m.createdAt),
      })),
    })
  }

  conversations.sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.id
    const bLast = b.messages[b.messages.length - 1]?.id
    const aMsg = messages.find((m) => m.id === aLast)
    const bMsg = messages.find((m) => m.id === bLast)
    return new Date(bMsg?.createdAt ?? 0).getTime() - new Date(aMsg?.createdAt ?? 0).getTime()
  })

  return conversations
}

export default function GuestMessagesPage() {
  const { user, loading: authLoading } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [newMsg, setNewMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setConversations([])
      setActiveConv(null)
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/messages?userId=${user.id}`)
      .then((r) => r.json())
      .then((data) => {
        const msgs = Array.isArray(data.messages) ? data.messages as ApiMessage[] : []
        const grouped = groupConversations(msgs, user.id)
        setConversations(grouped)
        setActiveConv((prev) => {
          if (prev) {
            const still = grouped.find((c) => c.id === prev.id)
            return still ?? grouped[0] ?? null
          }
          return grouped[0] ?? null
        })
      })
      .catch(() => {
        setConversations([])
        setActiveConv(null)
      })
      .finally(() => setLoading(false))
  }, [user, authLoading])

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations
    const q = search.toLowerCase()
    return conversations.filter(
      (c) =>
        c.hostName.toLowerCase().includes(q) ||
        c.listing.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q),
    )
  }, [conversations, search])

  function selectConv(conv: Conversation) {
    setActiveConv(conv)
    if (!user || conv.unread === 0) return
    fetch('/api/messages', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ receiverId: user.id, senderId: conv.otherUserId }),
    }).catch(() => {})
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread: 0 } : c)),
    )
    setActiveConv((c) => (c && c.id === conv.id ? { ...c, unread: 0 } : c))
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMsg.trim() || !user || !activeConv || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId:   user.id,
          receiverId: activeConv.otherUserId,
          bookingId:  activeConv.bookingId,
          content:    newMsg.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) return

      const chatMsg: ChatMessage = {
        id:   data.message.id,
        from: 'guest',
        text: data.message.content,
        time: 'Just now',
      }

      setActiveConv((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          lastMessage: chatMsg.text,
          time:        'Just now',
          messages:    [...prev.messages, chatMsg],
        }
      })
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConv.id
            ? {
                ...c,
                lastMessage: chatMsg.text,
                time:        'Just now',
                messages:    [...c.messages, chatMsg],
              }
            : c,
        ),
      )
      setNewMsg('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>Messages</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(250,247,242,0.6)' }}>Chat with your hosts</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Dashboard nav */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {[
            { href: '/dashboard/guest', label: '📋 Bookings' },
            { href: '/dashboard/guest/wishlist', label: '❤️ Wishlist' },
            { href: '/dashboard/guest/messages', label: '💬 Messages', active: true },
            { href: '/dashboard/guest/payments', label: '💳 Payments' },
          ].map(({ href, label, active }) => (
            <Link key={href} href={href} className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{ backgroundColor: active ? 'var(--brown-dark)' : '#fff', color: active ? 'var(--gold)' : '#374151', border: active ? 'none' : '1px solid #E5E7EB' }}>
              {label}
            </Link>
          ))}
        </div>

        {loading || authLoading ? (
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm flex items-center justify-center" style={{ height: '600px' }}>
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading messages…</p>
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm flex items-center justify-center" style={{ height: '600px' }}>
            <div className="text-center px-4">
              <div className="text-5xl mb-4">💬</div>
              <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>No messages yet</h3>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Conversations with hosts will appear here after you book or reach out.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden" style={{ height: '600px', display: 'flex' }}>
            {/* Sidebar: conversations */}
            <div className="w-full sm:w-72 flex-shrink-0 border-r border-stone-100 flex flex-col">
              <div className="p-4 border-b border-stone-100">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-50">
                  <Search size={14} className="text-stone-400" />
                  <input
                    placeholder="Search messages..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="flex-1 text-sm bg-transparent border-none outline-none"
                  />
                </div>
              </div>
              <div className="overflow-y-auto flex-1">
                {filtered.map((conv) => (
                  <button key={conv.id} onClick={() => selectConv(conv)}
                    className="w-full p-4 flex items-start gap-3 text-left transition-all hover:bg-stone-50 border-b border-stone-50"
                    style={{ backgroundColor: activeConv?.id === conv.id ? '#FFF8EE' : undefined }}>
                    <div className="relative flex-shrink-0">
                      {conv.hostPhoto ? (
                        <img src={conv.hostPhoto} alt={conv.hostName} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                          style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                          {conv.hostName[0]}
                        </div>
                      )}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{conv.hostName}</span>
                        <span className="text-xs text-stone-400">{conv.time}</span>
                      </div>
                      <p className="text-xs text-[#6B645C] truncate">{conv.listing}</p>
                      <p className="text-xs text-stone-400 truncate mt-0.5">{conv.lastMessage}</p>
                    </div>
                    {conv.unread > 0 && (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                        {conv.unread}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat area */}
            <div className="hidden sm:flex flex-col flex-1">
              {activeConv ? (
                <>
                  {/* Chat header */}
                  <div className="p-4 border-b border-stone-100 flex items-center gap-3">
                    {activeConv.hostPhoto ? (
                      <img src={activeConv.hostPhoto} alt={activeConv.hostName} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                        {activeConv.hostName[0]}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{activeConv.hostName}</p>
                      <p className="text-xs text-[#6B645C]">{activeConv.listing}</p>
                    </div>
                    {activeConv.listingId && (
                      <Link href={`/listings/${activeConv.listingId}`}
                        className="ml-auto text-xs px-3 py-1.5 rounded-full border border-stone-200 text-[#6B645C] hover:bg-stone-50">
                        View Listing
                      </Link>
                    )}
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    <div className="p-3 rounded-xl text-center text-xs"
                      style={{ backgroundColor: '#FBE8BB', color: '#92400E' }}>
                      🛡️ Never share payment details outside FieGH. Report suspicious requests.
                    </div>

                    {activeConv.messages.map((m) => (
                      <div key={m.id} className={`flex ${m.from === 'guest' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xs lg:max-w-sm px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.from === 'guest' ? 'rounded-br-md' : 'rounded-bl-md'}`}
                          style={m.from === 'guest'
                            ? { backgroundColor: 'var(--brown-dark)', color: 'var(--cream)' }
                            : { backgroundColor: '#F3F4F6', color: '#1F2937' }}>
                          {m.text}
                          <div className={`text-xs mt-1 ${m.from === 'guest' ? 'text-right opacity-60' : 'text-stone-400'}`}>{m.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Input */}
                  <form onSubmit={sendMessage} className="p-4 border-t border-stone-100 flex items-center gap-3">
                    <input
                      value={newMsg}
                      onChange={(e) => setNewMsg(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                    />
                    <button type="submit" disabled={sending}
                      className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:opacity-90"
                      style={{ backgroundColor: 'var(--color-accent)', opacity: sending ? 0.7 : 1 }}>
                      <Send size={16} style={{ color: '#fff' }} />
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
    </div>
  )
}
