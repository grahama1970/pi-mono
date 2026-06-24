import { createContext, useContext } from 'react'
import { CHAT_READABLE, type ChatReadableTokens } from './spartaChatNvis'

const ChatReadableContext = createContext<ChatReadableTokens>(CHAT_READABLE)

export function ChatReadableProvider({
  value,
  children,
}: {
  value: ChatReadableTokens
  children: React.ReactNode
}) {
  return <ChatReadableContext.Provider value={value}>{children}</ChatReadableContext.Provider>
}

export function useChatReadable(): ChatReadableTokens {
  return useContext(ChatReadableContext)
}
