import { useEffect, useRef, useState, type FormEvent } from 'react'
import { emitIntent, onChatMessage, type ChatMessage } from 'client'

const MAX_VISIBLE_MESSAGES = 50

function ChatBox() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return onChatMessage((message) => {
      setMessages((previous) => [...previous, message].slice(-MAX_VISIBLE_MESSAGES))
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const text = draft.trim()
    if (!text) return

    emitIntent({ type: 'chat', text })
    setDraft('')
  }

  return (
    <div className="chat-box">
      <div className="chat-log" ref={logRef}>
        {messages.map((message, index) => (
          <div className="chat-line" key={index}>
            <span className="chat-sender">{message.sender}:</span> {message.text}
          </div>
        ))}
      </div>
      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Say something..."
          value={draft}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}

export default ChatBox
