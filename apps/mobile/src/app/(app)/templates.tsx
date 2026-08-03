// Route: /templates (Milestone 5 Task C1). The templates list screen: browse the user's saved
// templates (each with a summary of its exercises), start a fresh session from one, rename, or
// delete. Reached from the home screen's "Start from template" button (see ../index.tsx);
// saving a NEW template from a session is Task C2, not here — this screen only ever lists
// templates that already exist (seeded server-side for now, created via "save as template" once
// C2 lands).
//
// All reads are reactive (session/templates-queries.ts's useTemplates/useTemplateExercises, both
// thin @powersync/react useQuery wrappers), so renaming/deleting here — or a template
// arriving/changing from ANY source, including syncing down from another device — updates the
// list live, with no manual refetch.
//
// Rename/delete use an inline per-row form/confirm (toggled open, like exercise-picker.tsx's
// add-custom-exercise form) rather than RN's Alert.alert: Alert's button-callback API isn't
// reliably testable via Playwright on web, and this keeps the interaction fully on-screen and
// scriptable for the Playwright verification pass.
import { useCallback, useState } from 'react'
import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useAuth } from '@/auth/useAuth'
import { usePowerSyncApp } from '@/powersync/PowerSyncProvider'
import { useActiveSession } from '@/session/active-session'
import { deleteTemplate, renameTemplate, startSessionFromTemplate } from '@/session/template-writes'
import { useTemplateExercises, useTemplates, type TemplateRow } from '@/session/templates-queries'
import { Button, Field, Heading, Screen, Text, colors, minTapTarget, radii, spacing } from '@/ui'

export default function Templates() {
  const router = useRouter()
  const { userId } = useAuth()
  const { db } = usePowerSyncApp()
  const { data: templates, isLoading } = useTemplates()
  // One active session at a time: while a session is open, block starting a new one from a template
  // (the global banner + home "Resume" point you back to the running one instead).
  const activeSession = useActiveSession()

  const [startingId, setStartingId] = useState<string | null>(null)

  const handleStart = useCallback(
    async (templateId: string) => {
      if (!userId) return
      setStartingId(templateId)
      try {
        const sessionId = await startSessionFromTemplate(db, { userId, templateId })
        router.push({ pathname: '/session/[id]', params: { id: sessionId } })
      } finally {
        setStartingId(null)
      }
    },
    [db, userId, router],
  )

  return (
    <Screen centered={false}>
      <View style={styles.header}>
        <Button
          title="Back"
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          testID="templates-back"
        />
        <Heading size="lg" testID="templates-heading">
          Templates
        </Heading>
      </View>

      {isLoading ? (
        <Text muted testID="templates-loading">
          Loading…
        </Text>
      ) : templates.length === 0 ? (
        <Text muted testID="templates-empty">
          No templates yet — save one from a session
        </Text>
      ) : (
        <View style={styles.list} testID="templates-list">
          {activeSession ? (
            <Text muted size="sm" testID="templates-active-note">
              Finish your session in progress before starting a new one.
            </Text>
          ) : null}
          {templates.map((template) => (
            <TemplateRowView
              key={template.id}
              template={template}
              starting={startingId === template.id}
              startDisabled={activeSession !== null}
              onStart={() => handleStart(template.id)}
            />
          ))}
        </View>
      )}
    </Screen>
  )
}

function TemplateRowView({
  template,
  starting,
  startDisabled,
  onStart,
}: {
  template: TemplateRow
  starting: boolean
  startDisabled: boolean
  onStart: () => void
}) {
  const { db } = usePowerSyncApp()
  const { data: exercises, isLoading: exercisesLoading } = useTemplateExercises(template.id)

  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(template.name)
  const [savingName, setSavingName] = useState(false)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleToggleRename = useCallback(() => {
    setNewName(template.name)
    setRenaming((open) => !open)
  }, [template.name])

  const handleSaveRename = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setSavingName(true)
    try {
      await renameTemplate(db, { templateId: template.id, name: trimmed })
      setRenaming(false)
    } finally {
      setSavingName(false)
    }
  }, [db, template.id, newName])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await deleteTemplate(db, { templateId: template.id })
      // No need to reset confirmingDelete/deleting — a successful delete removes this row
      // (reactively, via useTemplates) so this component unmounts.
    } finally {
      setDeleting(false)
    }
  }, [db, template.id])

  const summary =
    exercises.length === 0
      ? exercisesLoading
        ? 'Loading exercises…'
        : 'No exercises'
      : exercises.map((e) => e.name).join(', ')

  return (
    <View style={styles.card} testID={`template-row-${template.id}`}>
      {renaming ? (
        <View style={styles.renameForm} testID={`template-rename-form-${template.id}`}>
          <Field label="Name" value={newName} onChangeText={setNewName} testID={`template-rename-input-${template.id}`} />
          <View style={styles.rowButtons}>
            <Button
              title="Save"
              onPress={handleSaveRename}
              loading={savingName}
              testID={`template-rename-save-${template.id}`}
            />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setRenaming(false)}
              testID={`template-rename-cancel-${template.id}`}
            />
          </View>
        </View>
      ) : (
        <>
          <Text size="md" style={styles.name} testID={`template-name-${template.id}`}>
            {template.name}
          </Text>
          <Text muted size="sm" testID={`template-summary-${template.id}`}>
            {summary}
          </Text>

          <View style={styles.rowButtons}>
            <Button
              title="Start"
              onPress={onStart}
              loading={starting}
              disabled={startDisabled}
              testID={`template-start-${template.id}`}
            />
            <Button
              title="Rename"
              variant="secondary"
              onPress={handleToggleRename}
              testID={`template-rename-toggle-${template.id}`}
            />
            {confirmingDelete ? (
              <>
                <Button
                  title="Confirm delete"
                  variant="secondary"
                  onPress={handleDelete}
                  loading={deleting}
                  testID={`template-delete-confirm-${template.id}`}
                />
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setConfirmingDelete(false)}
                  testID={`template-delete-cancel-${template.id}`}
                />
              </>
            ) : (
              <Button
                title="Delete"
                variant="secondary"
                onPress={() => setConfirmingDelete(true)}
                testID={`template-delete-toggle-${template.id}`}
              />
            )}
          </View>
        </>
      )}
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
  name: {
    fontWeight: '700',
  },
  rowButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  renameForm: {
    gap: spacing.sm,
  },
})
