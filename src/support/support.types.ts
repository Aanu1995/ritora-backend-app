import {
  SupportFeedbackPriority,
  SupportFeedbackSource,
  SupportFeedbackStatus,
  SupportFeedbackType,
} from './entities/support-feedback-item.entity';

export type SupportPaginationMeta = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  limit: number;
  page: number;
  total: number;
  totalPages: number;
};

export type SupportFeedbackContext = {
  appVersion?: string;
  browser?: string;
  locale?: string;
  requestId?: string;
  route?: string;
  [key: string]: unknown;
};

export type SupportFeedbackUserResponse = {
  email: string;
  id: string;
  name: string;
};

export type SupportFeedbackAdminActorResponse = {
  email: string;
  id: string;
  name: string;
};

export type SupportFeedbackResponse = {
  assignedAdmin: SupportFeedbackAdminActorResponse | null;
  assignedAdminId: string | null;
  closedAt: string | null;
  context: SupportFeedbackContext;
  createdAt: string;
  createdByAdmin: SupportFeedbackAdminActorResponse | null;
  createdByAdminId: string | null;
  description: string;
  id: string;
  noteCount: number;
  priority: SupportFeedbackPriority;
  reporterEmail: string | null;
  source: SupportFeedbackSource;
  status: SupportFeedbackStatus;
  title: string;
  type: SupportFeedbackType;
  updatedAt: string;
  user: SupportFeedbackUserResponse | null;
  userId: string | null;
};

export type SupportFeedbackListResponse = SupportPaginationMeta & {
  feedback: SupportFeedbackResponse[];
};

export type SupportFeedbackNoteResponse = {
  author: SupportFeedbackAdminActorResponse | null;
  authorAdminId: string;
  body: string;
  createdAt: string;
  feedbackId: string;
  id: string;
};

export type SupportFeedbackNoteListResponse = SupportPaginationMeta & {
  notes: SupportFeedbackNoteResponse[];
};

export type UserSupportFeedbackCreatedResponse = {
  createdAt: string;
  id: string;
  status: SupportFeedbackStatus;
};
