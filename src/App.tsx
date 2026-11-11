import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Welcome } from "@/components/Welcome";
import { Workspace } from "@/components/Workspace";
import type { ProjectInfo } from "@/shared/protocol";

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  return (
    <TooltipProvider>
      {project ? <Workspace project={project} onClose={() => setProject(null)} /> : <Welcome onOpen={setProject} />}
    </TooltipProvider>
  );
}
