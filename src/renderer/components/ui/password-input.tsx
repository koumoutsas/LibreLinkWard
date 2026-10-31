import * as React from "react"
import { EyeOpenIcon, EyeNoneIcon } from "@radix-ui/react-icons"
import { useTranslation } from "react-i18next"

import { Input, type InputProps } from "@/components/ui/input"

/** Password field with a button to reveal/hide what was typed. */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<InputProps, "type">
>(({ className, ...props }, ref) => {
  const { t } = useTranslation()
  const [visible, setVisible] = React.useState(false)
  const label = visible ? t("Hide password") : t("Show password")
  return (
    <div className="relative w-full">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={`pr-10 ${className ?? ""}`}
        {...props}
      />
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeNoneIcon /> : <EyeOpenIcon />}
      </button>
    </div>
  )
})
PasswordInput.displayName = "PasswordInput"

export { PasswordInput }
