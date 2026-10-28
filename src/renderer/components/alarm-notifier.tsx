import { useCallback } from 'react'
import type { AlarmNotification } from '../../main/alarmService'
import { useActiveAlarms } from '@/hooks/useActiveAlarms'
import { useAlertStore } from '@/stores/alertStore'
import { AudioManager } from '@/lib/AudioManager'
import { getAlertSoundFile, triggerWarningAlert } from '@/lib/utils'

/** Renders nothing; plays the window/audio alert when the alarm engine notifies. */
export function AlarmNotifier() {
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
  useActiveAlarms(onNotify)
  return null
}
