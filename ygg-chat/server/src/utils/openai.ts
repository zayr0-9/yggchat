import { openai } from '@ai-sdk/openai'
import { stepCountIs, streamText } from 'ai'
import tools from './tools'

export async function generateResponse(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk: (chunk: string) => void,
  model: string = 'gpt-4o'
): Promise<void> {
  const formattedMessages = messages.map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
  }))
  const { textStream } = streamText({
    model: openai(model),
    tools: tools.reduce(
      (acc, tool) => {
        acc[tool.name] = tool.tool
        return acc
      },
      {} as Record<string, any>
    ),
    providerOptions: {
      openai: {
        reasoningEffort: 'low',
      },
    },
    stopWhen: stepCountIs(40),

    messages: formattedMessages,
  })
  for await (const chunk of textStream) {
    onChunk(chunk)
  }
}
