// Route: /sessions — the workout history list. One card per session, newest first, showing the
// three things worth scanning for: when it happened, how long it took, and which template it came
// from (if any). Reached from the home screen's "History" button.
//
// Paginated by a growing window (session/sessions-query.ts): the screen holds a page count, the
// query asks for that many pages' worth of rows, and "Load more" bumps it. The whole list stays
// one reactive @powersync/react query, so a session finishing — here or on another device — updates
// it live without a refetch.
//
// Two destinations, because a workout that happened and a workout you're in the middle of are
// different things. Tapping any card opens /sessions/[id] — the read-only detail view of what was
// performed. The in-progress session additionally gets a "Resume" button to /session/[id], the
// ACTIVE-session screen (live elapsed clock, log-a-set form, Finish); opening a finished workout
// in THAT would read as though it were still running, which is why it isn't the tap target here.
import { useCallback, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  formatSessionDate,
  formatSessionDuration,
  formatSessionTime,
  sessionDurationSeconds,
} from '@/session/session-history'
import {
  SESSION_HISTORY_PAGE_SIZE,
  useSessionHistory,
  type SessionHistoryRow,
} from '@/session/sessions-query'
import { Button, Heading, Screen, Text, colors, minTapTarget, radii, spacing } from '@/ui'

export default function Sessions() {
  const router = useRouter()
  const [pageCount, setPageCount] = useState(1)
  const { sessions, hasMore, isLoading } = useSessionHistory(pageCount * SESSION_HISTORY_PAGE_SIZE)

  const handleLoadMore = useCallback(() => setPageCount((count) => count + 1), [])

  return (
    <Screen centered={false}>
      <View style={styles.header}>
        <Button
          title="Back"
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          testID="sessions-back"
        />
        <Heading size="lg" testID="sessions-heading">
          History
        </Heading>
      </View>

      {isLoading && sessions.length === 0 ? (
        <Text muted testID="sessions-loading">
          Loading…
        </Text>
      ) : sessions.length === 0 ? (
        <Text muted testID="sessions-empty">
          No sessions yet — start one to build your history.
        </Text>
      ) : (
        <>
          <View style={styles.list} testID="sessions-list">
            {sessions.map((session) => (
              <SessionHistoryCard
                key={session.id}
                session={session}
                onOpen={() => router.push({ pathname: '/sessions/[id]', params: { id: session.id } })}
                onResume={() => router.push({ pathname: '/session/[id]', params: { id: session.id } })}
              />
            ))}
          </View>

          {hasMore ? (
            <Button title="Load more" variant="secondary" onPress={handleLoadMore} testID="sessions-load-more" />
          ) : (
            <Text muted size="sm" testID="sessions-end">
              No older sessions.
            </Text>
          )}
        </>
      )}
    </Screen>
  )
}

function SessionHistoryCard({
  session,
  onOpen,
  onResume,
}: {
  session: SessionHistoryRow
  onOpen: () => void
  onResume: () => void
}) {
  const durationSeconds = sessionDurationSeconds(session.started_at, session.ended_at)
  const duration = durationSeconds === null ? 'In progress' : formatSessionDuration(durationSeconds)

  return (
    <View style={styles.card} testID={`session-row-${session.id}`}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.cardBody} testID={`session-open-${session.id}`}>
        <Text size="md" style={styles.date} testID={`session-date-${session.id}`}>
          {formatSessionDate(session.started_at)}
        </Text>
        <Text muted size="sm" testID={`session-meta-${session.id}`}>
          {formatSessionTime(session.started_at)} · {duration}
        </Text>
        {session.template_name ? (
          <Text muted size="sm" testID={`session-template-${session.id}`}>
            {session.template_name}
          </Text>
        ) : null}
      </Pressable>
      {session.ended_at === null ? (
        <Button title="Resume" onPress={onResume} style={styles.resume} testID={`session-resume-${session.id}`} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    minHeight: minTapTarget,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  cardBody: {
    gap: spacing.xs,
  },
  date: {
    fontWeight: '700',
  },
  resume: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
})
