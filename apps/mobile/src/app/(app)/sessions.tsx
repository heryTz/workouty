// Route: /sessions — the workout history list. One card per session, newest first, showing the
// three things worth scanning for: when it happened, how long it took, and which template it came
// from (if any). Reached from the home screen's "History" button.
//
// Paginated by a growing window (session/sessions-query.ts): the screen holds a page count, the
// query asks for that many pages' worth of rows, and "Load more" bumps it. The whole list stays
// one reactive @powersync/react query, so a session finishing — here or on another device — updates
// it live without a refetch.
//
// Finished sessions aren't tappable: /session/[id] is the ACTIVE-session screen (live elapsed
// clock, log-a-set form, Finish), so opening a finished workout in it would read as though the
// workout were still running. Only the in-progress session gets a control, and it resumes.
import { useCallback, useState } from 'react'
import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
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

function SessionHistoryCard({ session, onResume }: { session: SessionHistoryRow; onResume: () => void }) {
  const durationSeconds = sessionDurationSeconds(session.started_at, session.ended_at)
  const duration = durationSeconds === null ? 'In progress' : formatSessionDuration(durationSeconds)

  return (
    <View style={styles.card} testID={`session-row-${session.id}`}>
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
  date: {
    fontWeight: '700',
  },
  resume: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
})
