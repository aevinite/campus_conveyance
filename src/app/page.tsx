'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { buttonVariants } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-2xl space-y-6"
      >
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Aevinite
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Campus Conveyance
        </h1>
        <p className="text-lg text-muted-foreground">
          Book, pay for and track school and college transport in one place.
          Live GPS, QR attendance and seat reservations — built for institutions,
          students, parents and drivers.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/register" className={buttonVariants({ size: 'lg' })}>
            Get started
          </Link>
          <Link
            href="/login"
            className={buttonVariants({ size: 'lg', variant: 'outline' })}
          >
            Sign in
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
