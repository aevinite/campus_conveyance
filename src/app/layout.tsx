import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { NativeAuthListener } from "@/components/auth/native-auth-listener";
import { NativeBackButton } from "@/components/native-back-button";
import { AppClass } from "@/components/app-class";
import { AppSplash } from "@/components/app-splash";

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

export const metadata: Metadata = {
  title: "Campus Conveyance — Daily campus transport, managed",
  description:
    "Reserve your seat, track your bus live, and travel safely to campus every day. Daily transport management for schools and colleges — by Aevinite.",
  applicationName: "Campus Conveyance",
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
