import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";

// Placeholder shell: library | frame | panel. Features land in later tasks.
export default function App() {
  return (
    <TooltipProvider>
      <ResizablePanelGroup className="h-screen bg-background text-foreground">
        <ResizablePanel defaultSize="20" minSize="12">
          <aside className="h-full p-3 text-sm text-muted-foreground">Library</aside>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="55">
          <main className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
            Frame
          </main>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="25" minSize="16">
          <aside className="h-full p-3 text-sm text-muted-foreground">Panel</aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </TooltipProvider>
  );
}
