import Studio from "../components/Studio";

export default function Home() {
  return (
    <div className="min-h-screen grid grid-rows-[64px_1fr]">
      <header className="h-16 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold">FloraFauna Studio</span>
          <span className="text-xs text-foreground/60">Blocks</span>
        </div>
        <div className="text-xs text-foreground/60">Local session</div>
      </header>
      <Studio />
    </div>
  );
}
