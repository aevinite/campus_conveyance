import { Logo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Shared backdrop for every auth portal (student, agency, driver, admin) so the
 * sign-in surfaces are visually identical: a premium dark "ink" canvas with a
 * warm yellow aurora glow and a masked grid. The brand mark is centered ABOVE
 * the sign-in surface (and, on the app's User / Agency chooser, above that
 * toggle), and the light/dark theme switch sits BELOW the card — there is no top
 * navbar and no "Back" button, so the whole screen reads as one centered stack.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark relative flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 -z-10 opacity-95" />
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-30 [mask-image:radial-gradient(80%_60%_at_50%_0%,black,transparent)]" />
      {/* One centered column: logo on top, the page's card in the middle, the
          theme toggle underneath. Each page's Card sets its own max width (e.g.
          max-w-sm for login, max-w-4xl for the wide agency application).
          `my-auto` centers a short stack vertically; a stack taller than the
          viewport falls back to the top/bottom padding and the page scrolls. */}
      <div className="my-auto flex w-full flex-col items-center gap-6 px-4 py-12">
        <Logo className="justify-center" />
        {children}
        <ThemeToggle />
      </div>
    </div>
  );
}
