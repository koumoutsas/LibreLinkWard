import { ThemeType, useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { ToggleSwitch } from "@/components/ui/toggle-switch"
import SettingsLayout from "@/layouts/settings-layout"
import { cn } from "@/lib/utils"
import { useNavigate } from "react-router-dom"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuthStore } from "@/stores/auth"
import { countries, languages, themes, resultUnits } from "@/config/app"
import { useTranslation } from "react-i18next"
import { setRedirectTo, sendRefreshPrimaryWindow, getTrayVisibility, setTrayVisibility, uploadCustomAlertSoundFile } from "@/lib/utils"
import { useAlertStore } from "@/stores/alertStore"
import { useEffect, useState, useCallback  } from 'react';

export default function SettingsGeneralPage() {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const theme = localStorage.getItem('vite-ui-theme')
  const language = useAuthStore((state) => state.language)
  const setLanguage = useAuthStore((state) => state.setLanguage)
  const country = useAuthStore((state) => state.country)
  const setCountry = useAuthStore((state) => state.setCountry)

  const resultUnit = useAuthStore((state) => state.resultUnit)
  const setResultUnit = useAuthStore((state) => state.setResultUnit)

  const showForecast = useAuthStore((state) => state.showForecast)
  const setShowForecast = useAuthStore((state) => state.setShowForecast)

  const { setTheme } = useTheme()
  const setAndRefreshTheme = (t: ThemeType) => {
    setTheme(t)
    setRedirectTo('/settings/general')
    window.location.reload();
  }
  const setAndRefreshLanguage = (l: string) => {
    i18n.changeLanguage(l)
    setLanguage(l)
  }

  const handleSetResultUnit = (value: string) => {
    setResultUnit(value);
    sendRefreshPrimaryWindow();
  }

  const [trayVisible, setTrayVisible] = useState<boolean>(true);

  useEffect(() => {
    const initializeTrayVisibility = () => {
      const visibility = getTrayVisibility();
      setTrayVisible(visibility);
    };

    initializeTrayVisibility();
  }, []);

  const handleToggleTray = useCallback(async (checked: boolean) => {
    setTrayVisible(checked);
    await setTrayVisibility(checked);
  }, []);

  const toggleSwitchKey = `tray-toggle-${trayVisible}`;

  const {
    bringToFrontEnabled,
    flashWindowEnabled,
    audioAlertEnabled,
    useCustomSound,
    setBringToFrontEnabled,
    setFlashWindowEnabled,
    setAudioAlertEnabled,
    setUserCustomSoundEnabled,
  } = useAlertStore();

  // TODO:: use a button and trigger this function
  const uploadCustomAlertSound = async () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.mp3';
    fileInput.onchange = async (event) => {
      const target = event.target as HTMLInputElement;
      const file = target?.files ? target.files[0] : null;
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          if (reader.result) {
            const arrayBuffer = reader.result as ArrayBuffer;
            const uint8Array = new Uint8Array(arrayBuffer);
            await uploadCustomAlertSoundFile(Array.from(uint8Array));
          }
        };

        reader.onerror = () => {
          console.error('uploadCustomAlertSound:', reader.error);
        };

        reader.readAsArrayBuffer(file);
      }
    };
    fileInput.click();
  };

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Theme')}</p>
          <Select onValueChange={setAndRefreshTheme} defaultValue={theme ?? ''}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("SelectTheme")} />
            </SelectTrigger>
            <SelectContent>
              {themes.map(item => (
                <SelectItem value={item.value} key={item.value}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Country')}</p>
          <Select onValueChange={setCountry} defaultValue={country ?? ''}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("SelectCountry")} />
            </SelectTrigger>
            <SelectContent>
              {countries.map(coun => (
                <SelectItem value={coun.value} key={coun.value}>
                  {t(coun.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Language')}</p>
          <Select onValueChange={setAndRefreshLanguage} defaultValue={language ?? ''}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("SelectLanguage")} />
            </SelectTrigger>
            <SelectContent>
              {languages.map(lan => (
                <SelectItem value={lan.value} key={lan.value}>
                  {t(lan.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Unit')}</p>
          <Select onValueChange={handleSetResultUnit} defaultValue={resultUnit ?? 'mg/dL'}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={("SelectUnit")} />
            </SelectTrigger>
            <SelectContent>
              {resultUnits.map(item => (
                <SelectItem value={item.value} key={item.value}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Show glucose values in tray')}</p>
          <ToggleSwitch
            key={toggleSwitchKey}
            checked={trayVisible}
            onChange={handleToggleTray}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-row justify-between gap-4">
            <p className="text-gray-400">{t('Show AR2 forecast')}</p>
            <ToggleSwitch checked={showForecast} onChange={setShowForecast} />
          </div>
          <p className="text-xs text-gray-500">{t('FORECAST_DESCRIPTION')}</p>
        </div>

        <div className="text-gray-400">{t('ALERT_DESCRIPTION')}</div>

        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Bring Window to Front')}</p>
          <ToggleSwitch checked={bringToFrontEnabled} onChange={setBringToFrontEnabled} />
        </div>

        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Flash Window')}</p>
          <ToggleSwitch checked={flashWindowEnabled} onChange={setFlashWindowEnabled} />
        </div>

        <div className="flex flex-row justify-between gap-4">
          <p className="text-gray-400">{t('Play Sound')}</p>
          <ToggleSwitch checked={audioAlertEnabled} onChange={setAudioAlertEnabled} />
        </div>

        {audioAlertEnabled && (
          <div className="flex flex-row justify-between gap-4">
            <p className="text-gray-400">{t('Use Custom Sound')}</p>
            <ToggleSwitch checked={useCustomSound} onChange={setUserCustomSoundEnabled} />
          </div>
        )}

        {audioAlertEnabled && useCustomSound && (
          <div className="flex flex-row justify-between gap-4">
            <Button onClick={uploadCustomAlertSound}>{t('Upload Sound')}</Button>
          </div>
        )}

        <div>
          <Button onClick={() => sendRefreshPrimaryWindow()}>{t('Apply Changes')}</Button>
        </div>
      </div>
    </SettingsLayout>
  )
}
