import { isDemoMode } from "@/lib/env";
import { conversationApi } from "./conversationApi";
import { mockConversationApi } from "./mockConversationApi";
import type { ConversationService } from "./types";

/** Active service: scripted mock in demo mode, FastAPI client otherwise. */
export const conversationService: ConversationService = isDemoMode ? mockConversationApi : conversationApi;

export { ApiError, toApiError } from "./types";
export type { ConversationService, ErrorKind } from "./types";
