import { Bus } from 'lucide-react';

export const metadata = { title: 'Under maintenance · Campus Conveyance' };

export default function MaintenancePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-6 text-center">
      <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 -z-10 opacity-90" />
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-30 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
      {/* Animated loader: a spinning ring around the brand mark. */}
      <div className="relative flex size-28 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-4 border-primary/15" />
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary [animation-duration:1.1s]" />
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bus className="size-8" />
        </span>
      </div>

      <div className="max-w-md space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Campus Conveyance</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">We&apos;ll be <span className="text-gradient">back soon</span></h1>
        <p className="text-muted-foreground">
          Campus Conveyance is currently under maintenance. Service is paused for a short
          while — please check back in a little bit. Thanks for your patience.
        </p>
      </div>

      {/* Bouncing dots to reinforce the "in progress" feel. */}
      <div className="flex items-center gap-1.5" aria-hidden>
        <span className="size-2.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
        <span className="size-2.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <span className="size-2.5 animate-bounce rounded-full bg-primary" />
      </div>
    </main>
  );
}
