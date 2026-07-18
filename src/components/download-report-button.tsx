'use client';
import { Download, Printer } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Two ways to take the report away:
//  • Export CSV  → downloads a real spreadsheet from /aevinite/report.csv (issue 3)
//  • Print / PDF → opens the print dialog; the page's print styles hide the app
//    chrome, so "Save as PDF" yields a clean document.
export function DownloadReportButton() {
  return (
    <div className="no-print flex flex-wrap gap-2">
      <a
        href="/aevinite/report.csv"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        download
      >
        <Download className="size-4" />
        Export CSV
      </a>
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="size-4" />
        Print / PDF
      </Button>
    </div>
  );
}
