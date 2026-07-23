import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';

/**
 * Shared backdrop for every auth portal (student, agency, driver, admin) so the
 * sign-in surfaces are visually identical: a soft dotted grid, an indigo glow,
 * a centered brand mark and a theme toggle. A "Back" button sits in the very
 * top-left corner so it's always easy to leave any login / forgot-password
 * screen and return to the home page.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden">
      <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 -z-10 opacity-90" />
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-30 [mask-image:radial-gradient(80%_60%_at_50%_0%,black,transparent)]" />
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4 sm:p-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/"
            aria-label="Back to home"
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
              className: 'gap-1.5 text-muted-foreground hover:text-foreground',
            })}
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
          <Logo />
        </div>
        <ThemeToggle />
      </div>
      {/* Each page's Card sets its own max width (e.g. max-w-sm for login,
          max-w-4xl for the wide agency application). `my-auto` centers a short
          card vertically, but a form taller than the viewport falls back to the
          top padding (clearing the header) and the page scrolls — so nothing is
          ever pushed up underneath the header. */}
      <div className="my-auto flex w-full justify-center px-4 pt-28 pb-12 sm:pt-32">
        {children}
      </div>
    </div>
  );
}
