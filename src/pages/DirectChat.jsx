import { useState, useEffect, useRef, useCallback } from 'react'
import { getApiKey, getModel } from '../utils/storage'

const STORAGE_KEY = 'daily_direct_chat'
const BASE_URL = 'https://api.deepseek.com'

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

function saveMessages(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs))
  } catch {}
}

export default function DirectChat({ onBack }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setMessages(loadMessages())
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    if (messages.length > 0) saveMessages(messages)
  }, [messages])

  const doSend = useCallback(async (text, existingMessages) => {
    const apiKey = getApiKey()
    if (!apiKey) {
      setError('请先在设置页面填写 API Key')
      return
    }
    setError('')

    const userMsg = { role: 'user', content: text, timestamp: Date.now() }
    const newMessages = [...existingMessages, userMsg]
    setMessages(newMessages)
    setLoading(true)
    setStreamingText('')

    const model = getModel()
    const systemPrompt = '你是一个智能助手，直接回答用户的问题。'

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...newMessages.map(m => ({ role: m.role, content: m.content })),
    ]

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)

    try {
      const response = await fetch(BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error?.message || `API error: ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullReply = ''
      let reasoningContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (delta?.reasoning_content) {
              reasoningContent += delta.reasoning_content
            }
            if (delta?.content) {
              fullReply += delta.content
              setStreamingText(fullReply)
            }
          } catch {}
        }
      }

      clearTimeout(timeout)
      setLoading(false)
      setStreamingText('')

      if (fullReply) {
        const assistantMsg = { role: 'assistant', content: fullReply, reasoningContent: reasoningContent || undefined, timestamp: Date.now() }
        setMessages([...newMessages, assistantMsg])
      }
    } catch (err) {
      clearTimeout(timeout)
      setLoading(false)
      setStreamingText('')
      if (err.name === 'AbortError') {
        setError('请求超时，请重试')
      } else {
        setError(err.message || '请求失败')
      }
    }
  }, [])

  const handleSend = () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    inputRef.current?.focus()
    doSend(text, messages)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    if (window.confirm('确定要清除所有对话记录吗？')) {
      setMessages([])
      saveMessages([])
      setError('')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.length === 0 && (
          <div className="text-center text-gray-600 mt-8">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-sm">直接对话模式</p>
            <p className="text-[10px] text-gray-700 mt-0.5">简洁聊天，无角色设定</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex items-start gap-2 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${
              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-600 text-gray-300'
            }`}>
              {msg.role === 'user' ? '我' : 'AI'}
            </div>
            <div className={`flex flex-col max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] text-gray-500 mb-0.5 px-1">
                {msg.role === 'user' ? '我' : '助手'}
              </span>
              {msg.role !== 'user' && msg.reasoningContent && (
                <details className="mb-1 cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
                  <summary className="text-[12px] text-gray-500 hover:text-gray-300 inline-block marker:text-gray-600">
                    思考过程
                  </summary>
                  <div className="mt-1 p-2 rounded-lg text-[12px] text-gray-400 leading-relaxed whitespace-pre-wrap" style={{ background: 'rgba(30,30,35,0.95)' }}>
                    {msg.reasoningContent}
                  </div>
                </details>
              )}
              <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : 'bg-gray-700 text-gray-100 rounded-tl-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {streamingText && (
          <div className="flex items-start gap-2 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0 text-xs font-medium text-gray-300">AI</div>
            <div className="flex flex-col max-w-[75%]">
              <span className="text-[10px] text-gray-500 mb-0.5 px-1">助手</span>
              <div className="px-3 py-2 rounded-2xl rounded-tl-sm bg-gray-700 text-gray-100 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {streamingText}
                <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-middle" />
              </div>
            </div>
          </div>
        )}

        {loading && !streamingText && (
          <div className="flex items-start gap-2 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0 text-xs font-medium text-gray-300">AI</div>
            <div className="flex flex-col max-w-[75%]">
              <span className="text-[10px] text-gray-500 mb-0.5 px-1">助手</span>
              <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-gray-700">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center">
            <p className="text-xs text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg inline-block">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-700 bg-gray-800/95 backdrop-blur p-3">
        <div className="flex items-end gap-2">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="px-2 py-2 text-gray-500 hover:text-red-400 transition-colors text-sm flex-shrink-0"
              title="清除对话"
            >
              🗑
            </button>
          )}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              className="w-full bg-gray-700 border border-gray-600 rounded-xl px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              style={{ minHeight: '2.5rem', maxHeight: '8rem' }}
              onInput={(e) => {
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
              }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium transition-colors active:scale-[0.98] flex-shrink-0"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
