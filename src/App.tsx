import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyTheme, loadTheme } from "@/components/Settings";
import { Welcome } from "@/components/Welcome";
import { Workspace } from "@/components/Workspace";
import type { ProjectInfo } from "@/shared/protocol";

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  useEffect(() => {
    applyTheme(loadTheme());
    const media = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme(loadTheme());
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  return (
    <TooltipProvider>
      {project ? <Workspace project={project} onClose={() => setProject(null)} /> : <Welcome onOpen={setProject} />}
    </TooltipProvider>
  );
}
