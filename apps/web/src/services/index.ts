import { isDemoMode } from "@/lib/env";
import { conversationApi } from "./conversationApi";
import { journeyApi } from "./journeyApi";
import type { JourneyService } from "./journeyTypes";
import { mockConversationApi } from "./mockConversationApi";
import { mockJourneyApi } from "./mockJourneyApi";
import type { ConversationService } from "./types";

/** Active service: scripted mock in demo mode, FastAPI client otherwise. */
export const conversationService: ConversationService = isDemoMode ? mockConversationApi : conversationApi;

/** Journey after confirmation: same rule, the mode is chosen once at build time. */
export const journeyService: JourneyService = isDemoMode ? mockJourneyApi : journeyApi;

export { ApiError, toApiError } from "./types";
export type { JourneyService } from "./journeyTypes";
export type { ConversationService, ErrorKind } from "./types";
