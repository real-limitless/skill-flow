import * as React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthPage } from "@/pages/auth";
import { ConsolePage } from "@/pages/console";

function useHashRoute() {
  const read = () => location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = React.useState(read);
  React.useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function App() {
  const route = useHashRoute();
  const page = route === "setup" ? <AuthPage key="setup" mode="setup" /> : route === "login" ? <AuthPage key="login" mode="login" /> : <ConsolePage />;
  return (
    <ThemeProvider>
      <TooltipProvider>
        {page}
        <Toaster richColors={false} />
      </TooltipProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
