/**
 * SENTRA Real-time Streaming Conversation Service
 * Feature 2: Real-time Streaming AI Conversation
 *
 * Implements:
 * 1. Low-latency chunked SSE stream from backend Gemini 3.8 Flash model.
 * 2. Incremental sentence-based speech dispatch for near-instant speech feedback.
 * 3. Barge-in / interruption support using AbortController.
 * 4. Automatic fallback to standard analysis if streaming is interrupted.
 */

export interface StreamingConversationCallbacks {
  onChunk: (chunk: string, fullText: string) => void;
  onSentence: (sentence: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: string) => void;
}

export class StreamingConversationService {
  private activeAbortController: AbortController | null = null;
  private spokenSentenceIndex: number = 0;
  private accumulatedText: string = '';

  /**
   * Start a real-time streaming conversational turn.
   */
  public async streamTurn(
    payload: {
      query: string;
      image?: string | null;
      mode?: string;
      goal?: string | null;
      memory?: any[];
      history?: any[];
      heading?: number | null;
      sensors?: string;
      useWearableFrame?: boolean;
    },
    callbacks: StreamingConversationCallbacks
  ): Promise<string> {
    this.cancelActiveStream();

    this.activeAbortController = new AbortController();
    this.spokenSentenceIndex = 0;
    this.accumulatedText = '';

    try {
      const response = await fetch('/api/sentra/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: this.activeAbortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Streaming failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const data = JSON.parse(jsonStr);
              if (data.chunk) {
                this.accumulatedText += data.chunk;
                callbacks.onChunk(data.chunk, this.accumulatedText);
                this.checkAndEmitSentences(callbacks);
              }
              if (data.isComplete) {
                // Emit any trailing remaining sentence
                this.emitRemainingText(callbacks);
                callbacks.onComplete(this.accumulatedText);
                return this.accumulatedText;
              }
            } catch {}
          }
        }
      }

      this.emitRemainingText(callbacks);
      callbacks.onComplete(this.accumulatedText);
      return this.accumulatedText;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Stream cancelled intentionally by user barge-in
        return this.accumulatedText;
      }
      callbacks.onError(err.message || 'Stream connection lost');
      return this.accumulatedText;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Checks for complete sentences in the accumulated stream and emits them for early TTS.
   */
  private checkAndEmitSentences(callbacks: StreamingConversationCallbacks) {
    const sentenceDelimiters = /(?<=[.!?])\s+/;
    const parts = this.accumulatedText.split(sentenceDelimiters);

    // If there is more than 1 sentence, the earlier ones are complete!
    while (this.spokenSentenceIndex < parts.length - 1) {
      const completeSentence = parts[this.spokenSentenceIndex].trim();
      if (completeSentence.length > 2) {
        callbacks.onSentence(completeSentence);
      }
      this.spokenSentenceIndex++;
    }
  }

  private emitRemainingText(callbacks: StreamingConversationCallbacks) {
    const sentenceDelimiters = /(?<=[.!?])\s+/;
    const parts = this.accumulatedText.split(sentenceDelimiters);
    if (this.spokenSentenceIndex < parts.length) {
      const remaining = parts.slice(this.spokenSentenceIndex).join(' ').trim();
      if (remaining.length > 0) {
        callbacks.onSentence(remaining);
        this.spokenSentenceIndex = parts.length;
      }
    }
  }

  /**
   * Barge-in cancellation: immediately halts pending network stream.
   */
  public cancelActiveStream() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }
}

export const streamingConversation = new StreamingConversationService();
