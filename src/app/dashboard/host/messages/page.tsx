'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Send, Search } from 'lucide-react'

const MOCK_CONVS = [
  {
    id: 'c1', guestName: 'Kwame Asante', guestPhoto: null,
    listing: 'Luxury 3BR, East Legon', lastMessage: 'Yes, there is secure parking for 2 cars inside the compound.', time: '2h ago', unread: 0,
    messages: [
      { id: 'm1', from: 'guest', text: 'Hi Abena! Quick question — is there parking available?', time: '3h ago' },
      { id: 'm2', from: 'host', text: 'Yes, there is secure parking for 2 cars inside the compound.', time: '2h ago' },
      { id: 'm3', from: 'guest', text: 'Brilliant! Thank you!', time: '2h ago' },
    ]
  },
  {
    id: 'c2', guestName: 'Ama Boateng', guestPhoto: null,
    listing: 'Furnished 2BR, Labone', lastMessage: 'When can I come to view the apartment?', time: '1d ago', unread: 1,
    messages: [
      { id: 'm1', from: 'guest', text: 'Hello, I submitted a rental application. When can I come to view?', time: '1d ago' },
      { id: 'm2', from: 'guest', text: 'When can I come to view the apartment?', time: '1d ago' },
    ]
  },
]

export default function HostMessagesPage() {
  const [activeConv, setActiveConv] = useState(MOCK_CONVS[0])
  const [messages, setMessages] = useState(activeConv.messages)
  const [newMsg, setNewMsg] = useState('')

  function selectConv(conv: typeof MOCK_CONVS[0]) {
    setActiveConv(conv)
    setMessages(conv.messages)
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMsg.trim()) return
    setMessages((prev) => [...prev, { id: `m${Date.now()}`, from: 'host', text: newMsg, time: 'Just now' }])
    setNewMsg('')
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div style={{ backgroundColor: 'var(--brown-dark)' }} className="py-8 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--cream)' }}>Messages</h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(250,247,242,0.6)' }}>Chat with your guests</p>
          </div>
          <Link href="/dashboard/host" className="text-sm px-4 py-2 rounded-full"
            style={{ backgroundColor: 'rgba(245,192,106,0.2)', color: 'var(--color-accent)', border: '1px solid rgba(245,192,106,0.3)' }}>
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden" style={{ height: '600px', display: 'flex' }}>
          {/* Sidebar */}
          <div className="w-full sm:w-72 flex-shrink-0 border-r border-stone-100 flex flex-col">
            <div className="p-4 border-b border-stone-100">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-50">
                <Search size={14} className="text-stone-400" />
                <input placeholder="Search guests..." className="flex-1 text-sm bg-transparent border-none outline-none" style={{ }} />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {MOCK_CONVS.map((conv) => (
                <button key={conv.id} onClick={() => selectConv(conv)}
                  className="w-full p-4 flex items-start gap-3 text-left border-b border-stone-50 transition-all hover:bg-stone-50"
                  style={{ backgroundColor: activeConv.id === conv.id ? '#FFF8EE' : undefined }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                    style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                    {conv.guestName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{conv.guestName}</span>
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

          {/* Chat */}
          <div className="hidden sm:flex flex-col flex-1">
            <div className="p-4 border-b border-stone-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                style={{ backgroundColor: 'var(--gold-light)', color: 'var(--color-text-primary)' }}>
                {activeConv.guestName[0]}
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{activeConv.guestName}</p>
                <p className="text-xs text-[#6B645C]">{activeConv.listing}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="p-3 rounded-xl text-center text-xs"
                style={{ backgroundColor: '#FBE8BB', color: '#92400E' }}>
                🛡️ Remind your guest: all payments must go through FieGH only.
              </div>
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.from === 'host' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-sm px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.from === 'host' ? 'rounded-br-md' : 'rounded-bl-md'}`}
                    style={m.from === 'host'
                      ? { backgroundColor: 'var(--brown-dark)', color: 'var(--cream)' }
                      : { backgroundColor: '#F3F4F6', color: '#1F2937' }}>
                    {m.text}
                    <div className={`text-xs mt-1 ${m.from === 'host' ? 'text-right opacity-60' : 'text-stone-400'}`}>{m.time}</div>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={sendMessage} className="p-4 border-t border-stone-100 flex items-center gap-3">
              <input
                value={newMsg}
                onChange={(e) => setNewMsg(e.target.value)}
                placeholder="Type a message to your guest..."
                className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                style={{ }}
              />
              <button type="submit"
                className="w-10 h-10 rounded-xl flex items-center justify-center"
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
