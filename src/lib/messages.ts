export type ApiMessage = {
  id: string
  senderId: string
  receiverId: string
  bookingId: string | null
  listingId: string | null
  content: string
  isRead: boolean
  createdAt: string
  sender:   { id: string; name: string | null; profilePhoto: string | null }
  receiver: { id: string; name: string | null; profilePhoto: string | null }
  booking:  { id: string; listing: { id: string; title: string } } | null
  listing:  { id: string; title: string; hostId: string } | null
}

export type ChatMessage = {
  id: string
  mine: boolean
  text: string
  time: string
  createdAt: string
}

export type Conversation = {
  id: string
  otherUserId: string
  otherName: string
  otherPhoto: string | null
  listingTitle: string
  listingId: string | null
  bookingId: string | null
  lastMessage: string
  time: string
  lastAt: number
  unread: number
  messages: ChatMessage[]
}

export function formatRelativeTime(iso: string): string {
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

/** Conversation key: booking > listing > pairwise */
export function conversationKey(
  otherUserId: string,
  opts?: { bookingId?: string | null; listingId?: string | null },
): string {
  if (opts?.bookingId) return `${otherUserId}:booking:${opts.bookingId}`
  if (opts?.listingId) return `${otherUserId}:listing:${opts.listingId}`
  return otherUserId
}

export function groupConversations(messages: ApiMessage[], userId: string): Conversation[] {
  const map = new Map<string, ApiMessage[]>()

  for (const m of messages) {
    const otherId = m.senderId === userId ? m.receiverId : m.senderId
    const key = conversationKey(otherId, {
      bookingId: m.bookingId,
      listingId: m.listingId,
    })
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
    const listing =
      msgs.find((m) => m.listing)?.listing ??
      msgs.find((m) => m.booking?.listing)?.booking?.listing ??
      null
    const booking = msgs.find((m) => m.booking)?.booking ?? null

    conversations.push({
      id:           key,
      otherUserId:  other.id,
      otherName:    other.name ?? 'User',
      otherPhoto:   other.profilePhoto,
      listingTitle: listing?.title ?? 'Conversation',
      listingId:    listing?.id ?? null,
      bookingId:    booking?.id ?? null,
      lastMessage:  last.content,
      time:         formatRelativeTime(last.createdAt),
      lastAt:       new Date(last.createdAt).getTime(),
      unread,
      messages: msgs.map((m) => ({
        id:        m.id,
        mine:      m.senderId === userId,
        text:      m.content,
        time:      formatRelativeTime(m.createdAt),
        createdAt: m.createdAt,
      })),
    })
  }

  conversations.sort((a, b) => b.lastAt - a.lastAt)
  return conversations
}

export function apiMessagesToChat(messages: ApiMessage[], userId: string): ChatMessage[] {
  return messages
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((m) => ({
      id:        m.id,
      mine:      m.senderId === userId,
      text:      m.content,
      time:      formatRelativeTime(m.createdAt),
      createdAt: m.createdAt,
    }))
}

export function mergeChatMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>()
  for (const m of existing) map.set(m.id, m)
  for (const m of incoming) map.set(m.id, m)
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}
