import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Better Auth's user/session/account/verification tables are supplied by the
 * @convex-dev/better-auth component and are deliberately NOT declared here.
 */

export const questionValidator = v.object({
  id: v.string(), // permanent — answers key off this, so it is never reused
  label: v.string(),
  helpText: v.optional(v.string()),
  scope: v.union(v.literal('song'), v.literal('submission')),
  required: v.boolean(),
  maxLength: v.number(),
  archived: v.optional(v.boolean()), // archive rather than delete: hard deletes orphan answers
});

export const playlistTargetValidator = v.object({
  label: v.string(),
  // Only valid for the account that issued it. Cleared on provider switch.
  providerPlaylistId: v.union(v.string(), v.null()),
});

export const preScreenValidator = v.object({
  status: v.union(v.literal('clean'), v.literal('flagged'), v.literal('unverified')),
  isExplicitTag: v.boolean(),
  matchedKeywords: v.array(v.string()),
});

export default defineSchema({
  surveys: defineTable({
    teacherId: v.string(), // Better Auth user id — every teacher query filters on this
    code: v.string(),
    className: v.string(),
    questions: v.array(questionValidator),
    allowedPlaylists: v.array(playlistTargetValidator),
    provider: v.union(v.literal('spotify'), v.literal('youtube'), v.null()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_teacher', ['teacherId'])
    .index('by_code', ['code']),

  submissions: defineTable({
    surveyId: v.id('surveys'),
    studentName: v.string(),
    studentSeat: v.optional(v.string()),
    answers: v.record(v.string(), v.string()), // questionId -> answer, submission scope
    createdAt: v.number(),
  }).index('by_survey', ['surveyId']),

  songs: defineTable({
    submissionId: v.id('submissions'),
    surveyId: v.id('surveys'), // denormalised so sync/screening scope without a join
    source: v.union(v.literal('catalog'), v.literal('manual')),
    title: v.string(),
    artist: v.string(),
    // All null for source: "manual".
    isrc: v.union(v.string(), v.null()),
    deezerId: v.union(v.number(), v.null()),
    /** Exact provider URI: either captured when the student picked from that
     *  provider's own catalog, or set by the teacher resolving it by hand.
     *  Present -> sync needs no lookup at all. */
    providerTrackId: v.optional(v.union(v.string(), v.null())),
    /** What the URI actually points at, when a teacher resolved it manually.
     *  Kept separate from `title`/`artist` so the student's original request
     *  stays on the record — the teacher matched it, they did not rewrite it. */
    providerTrackTitle: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    durationSec: v.union(v.number(), v.null()),
    artworkUrl: v.union(v.string(), v.null()),
    playlistTarget: v.string(),
    answers: v.record(v.string(), v.string()), // questionId -> answer, song scope
    preScreen: preScreenValidator,
    decision: v.union(v.literal('pending'), v.literal('approved'), v.literal('denied')),
    denialReason: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.string()),
    teacherOverride: v.optional(v.boolean()), // the audit trail that protects the teacher
    isSynced: v.boolean(),
    syncedTrackUri: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_submission', ['submissionId'])
    .index('by_survey', ['surveyId']),

  /**
   * Deployment-wide ISRC -> provider id cache. Shared on purpose: it holds no
   * user data and is worth far more shared. On YouTube this is what keeps sync
   * inside the 10,000 units/day quota — a cache hit costs 0 search units.
   */
  trackResolutions: defineTable({
    isrc: v.string(), // uppercase, no dashes
    provider: v.union(v.literal('spotify'), v.literal('youtube')),
    providerTrackId: v.string(), // Spotify URI, or YouTube videoId
    title: v.string(), // what was matched, so a bad fuzzy match is visible
    durationSec: v.union(v.number(), v.null()),
    confidence: v.union(v.literal('exact'), v.literal('fuzzy')),
    resolvedAt: v.number(),
  }).index('by_isrc_provider', ['isrc', 'provider']),

  /**
   * Teacher-level settings: the connected provider and the pool of real
   * provider playlists students may be offered. A survey snapshots its own
   * selection from this pool, so editing the pool never breaks a live survey.
   */
  teacherSettings: defineTable({
    teacherId: v.string(),
    provider: v.union(v.literal('spotify'), v.literal('youtube'), v.null()),
    playlists: v.array(playlistTargetValidator),
  }).index('by_teacher', ['teacherId']),

  /** Per-session throttle for the unauthenticated student endpoints. */
  rateLimits: defineTable({
    key: v.string(),
    count: v.number(),
    windowStart: v.number(),
  }).index('by_key', ['key']),
});
