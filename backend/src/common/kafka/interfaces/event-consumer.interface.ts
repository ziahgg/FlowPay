export interface ConsumedEventMessage {
  key: string | null;
  value: string;
}

export interface SubscribeParams {
  topic: string;
  groupId: string;
  onMessage: (message: ConsumedEventMessage) => Promise<void>;
}

/**
 * Hides Kafka's consumer-group machinery behind one method so a consumer's message-handling logic
 * (dedupe, side effects) is testable by calling `onMessage` directly with a fake, without a real
 * broker or a running consumer group.
 */
export interface EventConsumer {
  subscribe(params: SubscribeParams): Promise<void>;
}
