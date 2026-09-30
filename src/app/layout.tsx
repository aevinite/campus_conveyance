import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { NativeAuthListener } from "@/components/auth/native-auth-listener";
import { NativeBackButton } from "@/components/native-back-button";
import { AppClass } from "@/components/app-class";
import { AppSplash } from "@/components/app-splash";
import { getSiteUrl } from "@/lib/site-url";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

// Run the server functions in Tokyo (hnd1) — the SAME region as the Supabase
// database (ap-northeast-1). The Vercel default is US-East (iad1), which forced
// every authenticated page and server action to hop US↔Tokyo on each DB query
// (several per request) — the source of the "delay on every action". Pinning
// the region here co-locates the function with the DB so those round-trips are
// ~1ms instead of ~170ms. Applies to all routes nested under this root layout.
export const preferredRegion = 'hnd1';

const SITE_DESCRIPTION =
  "Book a seat on your regular bus to school or college, see where it is on the way, and keep parents in the loop. Daily campus transport for students, parents, operators and campuses.";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Campus Conveyance — Your daily ride to campus",
    template: "%s · Campus Conveyance",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Campus Conveyance",
  keywords: ["campus bus", "college bus pass", "school transport", "daily commute", "bus tracking"],
  openGraph: {
    type: "website",
    siteName: "Campus Conveyance",
    title: "Campus Conveyance — Your daily ride to campus",
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_IN",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Campus Conveyance" }],
  },
  twitter: {
    card: "summary",
    title: "Campus Conveyance — Your daily ride to campus",
    description: SITE_DESCRIPTION,
    images: ["/icon-512.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Campus Conveyance",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4a521",
  // Draw into the display cutout / status-bar area (the native app is
  // edge-to-edge). This is what makes `env(safe-area-inset-*)` resolve to the
  // real device insets so UI can be padded clear of the status bar and gesture
  // bar. In a normal browser the insets are 0, so nothing changes there.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppSplash />
        <AppClass />
        <ServiceWorkerRegister />
        <NativeAuthListener />
        <NativeBackButton />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
