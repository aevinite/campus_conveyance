'use client';

// Last-resort boundary for errors thrown in the ROOT layout itself (where the
// normal error.tsx can't help, because it renders inside that layout). It must
// provide its own <html>/<body>. Kept dependency-free with inline styles so it
// still renders even if the theme/CSS or a provider is what failed.
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0f0f1a',
          color: '#f5f5f7',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#b9b9c6', lineHeight: 1.5, margin: '0 0 20px' }}>
            The application ran into an unexpected error. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#6d5efc',
              color: '#fff',
              border: 'none',
              padding: '10px 22px',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
