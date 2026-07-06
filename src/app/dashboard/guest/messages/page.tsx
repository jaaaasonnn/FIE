'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Send, Search } from 'lucide-react'

const MOCK_CONVERSATIONS = [
  {
    id: 'c1', hostName: 'Abena Mensah', hostPhoto: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=80&q=70',
    listing: 'Luxury 3BR, East Legon', lastMessage: 'The WiFi password is FieGH2024! See you on the 20th 🙏', time: '2h ago', unread: 2,
    messages: [
      { id: 'm1', from: 'host', text: 'Hello! Thanks for booking. Let me know if you have any questions.', time: '3h ago' },
      { id: 'm2', from: 'guest', text: 'Hi Abena! Quick question — is there parking available?', time: '3h ago' },
      { id: 'm3', from: 'host', text: 'Yes, there is secure parking for 2 cars inside the compound.', time: '2h ago' },
      { id: 'm4', from: 'host', text: 'The WiFi password is FieGH2024! See you on the 20th 🙏', time: '2h ago' },
    ]
  },
  {
    id: 'c2', hostName: 'Kofi Boateng', hostPhoto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&q=70',
    listing: 'Studio, Cantonments', lastMessage: 'The apartment is fully available for those dates.', time: '1d ago', unread: 0,
    messages: [
      { id: 'm1', from: 'guest', text: 'Hello, is the studio available from Jan 5 to Jan 12?', time: '2d ago' },
      { id: 'm2', from: 'host', text: 'The apartment is fully available for those dates.', time: '1d ago' },
    ]
  },
]

export default function GuestMessagesPage() {
  const [activeConv, setActiveConv] = useState(MOCK_CONVERSATIONS[0])
  const [newMsg, setNewMsg] = useState('')
  const [messages, setMessages] = useState(activeConv.messages)

  function selectConv(conv: typeof MOCK_CONVERSATIONS[0]) {
    setActiveConv(conv)
    setMessages(conv.messages)
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMsg.trim()) return
    setMessages((prev) => [...prev, { id: `m${Date.now()}`, from: 'guest', text: newMsg, time: 'Just now' }])
    setNewMsg('')
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

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden" style={{ height: '600px', display: 'flex' }}>
          {/* Sidebar: conversations */}
          <div className="w-full sm:w-72 flex-shrink-0 border-r border-stone-100 flex flex-col">
            <div className="p-4 border-b border-stone-100">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-50">
                <Search size={14} className="text-stone-400" />
                <input placeholder="Search messages..." className="flex-1 text-sm bg-transparent border-none outline-none" style={{ }} />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {MOCK_CONVERSATIONS.map((conv) => (
                <button key={conv.id} onClick={() => selectConv(conv)}
                  className="w-full p-4 flex items-start gap-3 text-left transition-all hover:bg-stone-50 border-b border-stone-50"
                  style={{ backgroundColor: activeConv.id === conv.id ? '#FFF8EE' : undefined }}>
                  <div className="relative flex-shrink-0">
                    <img src={conv.hostPhoto} alt={conv.hostName} className="w-10 h-10 rounded-full object-cover" />
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
            {/* Chat header */}
            <div className="p-4 border-b border-stone-100 flex items-center gap-3">
              <img src={activeConv.hostPhoto} alt={activeConv.hostName} className="w-10 h-10 rounded-full object-cover" />
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{activeConv.hostName}</p>
                <p className="text-xs text-[#6B645C]">{activeConv.listing}</p>
              </div>
              <Link href={`/listings/1`} className="ml-auto text-xs px-3 py-1.5 rounded-full border border-stone-200 text-[#6B645C] hover:bg-stone-50">
                View Listing
              </Link>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Safety banner */}
              <div className="p-3 rounded-xl text-center text-xs"
                style={{ backgroundColor: '#FBE8BB', color: '#92400E' }}>
                🛡️ Never share payment details outside FieGH. Report suspicious requests.
              </div>

              {messages.map((m) => (
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
                style={{ }}
              />
              <button type="submit"
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:opacity-90"
                style={{ backgroundColor: 'var(--color-accent)' }}>
                <Send size={16} style={{ color: '#fff' }} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
