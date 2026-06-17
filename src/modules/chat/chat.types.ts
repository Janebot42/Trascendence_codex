export type ChatMessageScope = 'lobby' | 'direct' | 'system';

export type ChatMessage = {
  id: string;
  authorUserId: string;
  recipientUserId: string | null;
  body: string;
  scope: ChatMessageScope;
  readAt: Date | null;
  createdAt: Date;
};

export type CreateChatMessageInput = {
  authorUserId: string;
  recipientUserId?: string | null;
  body: string;
};
