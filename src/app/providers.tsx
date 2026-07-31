'use client';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      // Open in LIGHT by default (not the device theme); users can still switch
      // to Dark or System from the theme toggle. Their choice is remembered.
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
