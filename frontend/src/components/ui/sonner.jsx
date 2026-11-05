import { Toaster as Sonner, toast } from "sonner"
import { useSettings } from "@/context/SettingsContext"

/** App-wide toasts, themed with the same tokens as cards and dialogs and following the in-app theme. */
const Toaster = (props) => {
  const { theme } = useSettings() || { theme: "light" }

  return (
    <Sonner
      theme={theme}
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border !border-line !bg-popover !shadow-[var(--pop-shadow)] !font-sans",
          title: "!font-semibold",
          description: "!text-muted-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
