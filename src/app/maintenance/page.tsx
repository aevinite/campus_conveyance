import { Bus } from 'lucide-react';

export const metadata = { title: 'Under maintenance · Campus Conveyance' };

export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      {/* Animated loader: a spinning ring around the brand mark. */}
      <div className="relative flex size-28 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-4 border-primary/15" />
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary [animation-duration:1.1s]" />
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bus className="size-8" />
        </span>
      </div>

      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">We&apos;ll be back soon</h1>
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
