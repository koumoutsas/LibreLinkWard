import { RouterProvider } from "react-router-dom"
import { AnimatePresence } from "framer-motion"
import { useAuthStore } from "@/stores/auth"
import routes from "@/routes"
import "@/globals.css"
import "@/custom.css"
import "@/i18n/config"
import { useEffect, useMemo } from "react"
import { useTrayReadings } from "@/hooks/useTrayReadings"
import { reloadApp } from "@/lib/reload"

// Own component so patient updates re-render this, not the router below.
function TrayReadings() {
  useTrayReadings()
  return null
}

export default function App() {
  const token = useAuthStore((state) => state.token)
  const router = useMemo(() => routes(!!token), [token])

  useEffect(() => {
    const handleLogout = () => {
      reloadApp();
    };

    const unsubscribe = window.electron.ipcRenderer.on('logout-event', handleLogout);

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <AnimatePresence>
      <TrayReadings />
      <RouterProvider router={router} />
    </AnimatePresence>
  )
}
