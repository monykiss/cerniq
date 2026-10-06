'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) { return <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6"><h2 className="text-lg font-bold">Error</h2><button onClick={reset} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm text-white">Retry</button></div>; }
