import React, { useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "relative rounded-full transition-colors text-sm",
  {
    variants: {
      variant: {
        default: "bg-red-300 dark:bg-secondary peer-checked:bg-primary",
        secondary: "bg-secondary peer-checked:bg-secondary-foreground",
        destructive: "bg-destructive peer-checked:bg-destructive-foreground",
        outline:
          "border border-input bg-transparent peer-checked:bg-accent peer-checked:border-accent-foreground",
        transparent: "bg-transparent peer-checked:bg-primary/10",
        ghost: "bg-transparent peer-checked:bg-accent-foreground",
      },
      size: {
        default: "w-11 h-6",
        sm: "w-9 h-5",
        lg: "w-14 h-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const toggleKnobVariants = cva(
  "absolute bg-white border rounded-full transition-transform top-0.5 left-0.5 w-5 h-5 border-gray-300 dark:border-gray-400",
  {
    variants: {
      checked: {
        true: "translate-x-[100%]",
        false: "",
      },
    },
    defaultVariants: {
      checked: false,
    },
  }
);

interface ToggleSwitchProps {
  variant?: VariantProps<typeof toggleVariants>["variant"];
  size?: VariantProps<typeof toggleVariants>["size"];
  className?: string;
  leftLabel?: string;
  rightLabel?: string;
  checked?: boolean; // Initial state
  onChange?: (checked: boolean) => void; // pass state to parent
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  variant,
  size,
  className,
  leftLabel,
  rightLabel,
  onChange,
  checked: initialChecked,
  ...props
}) => {
  const [isChecked, setIsChecked] = useState(initialChecked || false);

  const handleToggle = () => {
    setIsChecked((prev) => {
      const newState = !prev;
      if (onChange) onChange(newState);
      return newState;
    });
  };

  return (
    <div className="flex items-center gap-2">
      {leftLabel && (
        <p className="text-sm">{leftLabel}</p>
      )}
      <label className="inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={isChecked}
          onChange={handleToggle}
          {...props}
        />
        <div className={cn(toggleVariants({ variant, size, className }))}>
          <div
            className={cn(
              toggleKnobVariants({ checked: isChecked })
            )}
          ></div>
        </div>
      </label>
      {rightLabel && (
        <p className="text-sm">{rightLabel}</p>
      )}
    </div>
  );
};


export { ToggleSwitch, toggleVariants };
