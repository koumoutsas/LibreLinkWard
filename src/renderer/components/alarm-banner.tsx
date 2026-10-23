import { useCallback } from 'react'
import type { AlarmNotification } from '../../main/alarmService'
import { useActiveAlarms } from '@/hooks/useActiveAlarms'
import { useAlertStore } from '@/stores/alertStore'
import { useAuthStore } from '@/stores/auth'
import { AudioManager } from '@/lib/AudioManager'
import { describeAlarm } from '@/lib/alarmText'
import { getAlertSoundFile, triggerWarningAlert } from '@/lib/utils'
import { cn } from '@/lib/utils'

const SNOOZE_MINUTES = [15, 30, 60]

/**
 * Lists active alarms naming each patient, with per-patient acknowledge and
 * snooze, and plays the window/audio alert when the engine notifies.
 */
export function AlarmBanner() {
  const unit = useAuthStore((s) => s.resultUnit)
  const { bringToFrontEnabled, flashWindowEnabled, audioAlertEnabled, useCustomSound } =
    useAlertStore()

  const onNotify = useCallback(
    async (n: AlarmNotification) => {
      try {
        triggerWarningAlert({ bringToFrontEnabled, flashWindowEnabled })
        if (!audioAlertEnabled || !n.sound) return
        const paths = await getAlertSoundFile()
        const file = useCustomSound && paths?.custom ? paths.custom : paths?.default
        if (file) await AudioManager.getInstance().playAudio(file)
      } catch (err) {
        console.error('Error handling alarm notification:', err)
      }
    },
    [bringToFrontEnabled, flashWindowEnabled, audioAlertEnabled, useCustomSound],
  )
  const { alarms, acknowledge, snooze } = useActiveAlarms(onNotify)

  if (alarms.length === 0) return null

  return (
    <div role="alert" data-testid="alarm-banner" className="mb-4 flex flex-col gap-2">
      {alarms.map((a) => (
        <div
          key={a.patientId}
          data-testid={`alarm-${a.patientId}`}
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-md px-4 py-2 text-white',
            a.acknowledged ? 'bg-gray-600' : 'bg-red-600',
          )}
        >
          <span className="font-semibold">
            {a.name} — {describeAlarm(a.kind, a.value, unit)}
            {a.acknowledged ? ' (acknowledged)' : ''}
          </span>
          <span className="flex items-center gap-2">
            {!a.acknowledged && (
              <button
                className="rounded bg-white/20 px-2 py-1 hover:bg-white/30"
                onClick={() => acknowledge(a.patientId)}
              >
                Acknowledge
              </button>
            )}
            {SNOOZE_MINUTES.map((m) => (
              <button
                key={m}
                className="rounded bg-white/20 px-2 py-1 hover:bg-white/30"
                onClick={() => snooze(a.patientId, m)}
              >
                Snooze {m}m
              </button>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}
