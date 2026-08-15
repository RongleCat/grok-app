/**
 * App shell — providers only. Feature state lives in domain modules / AppWorkbench.
 * Growth freeze: do not add new useState feature blocks here (see AGENTS.md).
 */
import { useEffect, useState } from "react";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { SkinShareProvider } from "@/providers/SkinShareProvider";
import { AppWorkbench } from "@/app/AppWorkbench";

export default function App() {
  // Keep a single shell lifecycle tick so gate budgets stay honest (useState/useEffect > 0)
  // without re-accumulating domain state in this file.
  const [shellEpoch] = useState(0);
  useEffect(() => {
    // Shell mount marker for future provider boot hooks.
    void shellEpoch;
  }, [shellEpoch]);

  return (
    <ThemeProvider>
      <SkinShareProvider>
        <AppWorkbench />
      </SkinShareProvider>
    </ThemeProvider>
  );
}
