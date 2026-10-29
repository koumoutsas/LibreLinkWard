import { createMemoryRouter } from "react-router-dom"
import LandingPage from "@/pages/landing"
import LoginPage from "@/pages/login"
import DashboardPage from "@/pages/dashboard"
import SettingsGeneralPage from "@/pages/settings/general"
import SettingsAccountsPage from "@/pages/settings/accounts"
import PatientPage from "@/pages/patient"

export default function routes(isloggedIn: boolean) {
  return createMemoryRouter([
    { path: "/",  element: <LandingPage /> },
    { path: "/login",  element: isloggedIn ? <DashboardPage /> : <LoginPage /> },
    { path: "/dashboard",  element: isloggedIn ? <DashboardPage /> : <LoginPage /> },
    { path: "/settings/general",  element: isloggedIn ? <SettingsGeneralPage /> : <LoginPage /> },
    { path: "/settings/accounts",  element: isloggedIn ? <SettingsAccountsPage /> : <LoginPage /> },
    { path: "/patients/:patientId",  element: isloggedIn ? <PatientPage /> : <LoginPage /> },
    { path: "/settings/patients/:patientId",  element: isloggedIn ? <SettingsAccountsPage /> : <LoginPage /> },
  ])
}
