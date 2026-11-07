import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { PublicLayout } from "@/layouts/public-layout"
import { Button } from "@/components/ui/button"
import { languages } from "@/config/app"
import { useAuthStore } from "@/stores/auth"
import { cn } from "@/lib/utils"
import logo from "../../../assets/logo.png"

// English is preselected (the other translations are still rough), but the
// user has to confirm the choice before the app opens.
const DEFAULT_LANGUAGE = "en"

/** First-run screen: pick the app language, then land on an empty dashboard. */
export default function LoginPage() {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const setLanguage = useAuthStore((state) => state.setLanguage)
  const country = useAuthStore((state) => state.country)
  const setCountry = useAuthStore((state) => state.setCountry)
  const [selected, setSelected] = useState(DEFAULT_LANGUAGE)

  const choose = (value: string) => {
    setSelected(value)
    i18n.changeLanguage(value)
  }

  const confirm = () => {
    setLanguage(selected)
    if (!country) setCountry("global")
    navigate("/dashboard")
  }

  return (
    <PublicLayout className="flex flex-col justify-center items-center">
      <div className="flex flex-col items-center p-12">
        <img className="mb-3" src={logo} width={80} />
        <h2 className="font-semibold text-2xl">LibreLinkWard</h2>
        <p className="text-gray-400">{t("Welcome")}</p>
      </div>
      <div className="w-full max-w-md p-6 flex flex-col items-center gap-6">
        <p className="font-medium">{t("SelectLanguage")}</p>
        <div role="radiogroup" aria-label={t("Language")} className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full">
          {languages.map((language) => (
            <button
              key={language.value}
              type="button"
              role="radio"
              data-testid={`language-${language.value}`}
              aria-checked={selected === language.value}
              onClick={() => choose(language.value)}
              className={cn(
                "rounded-md border px-3 py-2 text-sm transition-colors hover:bg-foreground/10",
                selected === language.value && "border-primary bg-primary/10 font-semibold",
              )}
            >
              {t(language.label)}
            </button>
          ))}
        </div>
        <Button type="button" className="w-48" onClick={confirm}>
          {t("Continue")}
        </Button>
      </div>
    </PublicLayout>
  )
}
