import crypto from 'node:crypto';
import type { AudioReplyMetadata } from '../../src/types/deviceProtocol';

export interface StoredAudioReply {
  replyId: string;
  deviceId: string;
  buffer: Buffer;
  mimeType: 'audio/wav';
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
  createdAt: number;
  expiresAt: number;
}

export class AudioReplyStore {
  private replies = new Map<string, StoredAudioReply>();
  private readonly maxReplies: number;
  private readonly defaultTtlMs: number;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(options?: { maxReplies?: number; defaultTtlMs?: number }) {
    this.maxReplies = options?.maxReplies ?? 100;
    this.defaultTtlMs = options?.defaultTtlMs ?? 5 * 60 * 1000; // 5 minutes TTL

    // Periodic sweep for expired replies every 30 seconds
    this.pruneTimer = setInterval(() => this.prune(), 30000);
    this.pruneTimer.unref?.();
  }

  public storeReply(params: {
    deviceId: string;
    buffer: Buffer;
    sampleRate?: number;
    channels?: number;
    bitsPerSample?: number;
    durationMs?: number;
    ttlMs?: number;
  }): StoredAudioReply {
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;
    const replyId = `rep-${now}-${crypto.randomBytes(4).toString('hex')}`;
    const sampleRate = params.sampleRate ?? 24000;
    const channels = params.channels ?? 1;
    const bitsPerSample = params.bitsPerSample ?? 16;
    const durationMs =
      params.durationMs ??
      Math.round(
        (Math.max(0, params.buffer.length - 44) / (sampleRate * channels * (bitsPerSample / 8))) * 1000
      );

    const reply: StoredAudioReply = {
      replyId,
      deviceId: params.deviceId,
      buffer: params.buffer,
      mimeType: 'audio/wav',
      sampleRate,
      channels,
      bitsPerSample,
      durationMs,
      createdAt: now,
      expiresAt: now + ttl,
    };

    // Evict oldest or expired entries if at capacity
    if (this.replies.size >= this.maxReplies) {
      this.prune();
      if (this.replies.size >= this.maxReplies) {
        const oldestKey = this.replies.keys().next().value;
        if (oldestKey) {
          this.replies.delete(oldestKey);
        }
      }
    }

    this.replies.set(replyId, reply);
    return reply;
  }

  public getReply(replyId: string, deviceId?: string): StoredAudioReply | null {
    const reply = this.replies.get(replyId);
    if (!reply) return null;

    if (Date.now() > reply.expiresAt) {
      this.replies.delete(replyId);
      return null;
    }

    if (deviceId && reply.deviceId !== deviceId) {
      return null;
    }

    return reply;
  }

  public getMetadata(replyId: string, deviceId?: string): AudioReplyMetadata | null {
    const reply = this.getReply(replyId, deviceId);
    if (!reply) return null;
    return {
      replyId: reply.replyId,
      deviceId: reply.deviceId,
      mimeType: reply.mimeType,
      sampleRate: reply.sampleRate,
      channels: reply.channels,
      bitsPerSample: reply.bitsPerSample,
      durationMs: reply.durationMs,
      sizeBytes: reply.buffer.length,
      createdAt: reply.createdAt,
      expiresAt: reply.expiresAt,
    };
  }

  public deleteReply(replyId: string): boolean {
    return this.replies.delete(replyId);
  }

  public prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, reply] of this.replies.entries()) {
      if (now > reply.expiresAt) {
        this.replies.delete(id);
        removed++;
      }
    }
    return removed;
  }

  public clear(): void {
    this.replies.clear();
  }

  public size(): number {
    this.prune();
    return this.replies.size;
  }

  public destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.clear();
  }
}
