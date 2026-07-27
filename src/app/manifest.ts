import type { MetadataRoute } from "next";

/**
 * Web App Manifest — makes the site installable as an app (Android/iOS "Add to
 * Home screen") and is what PWABuilder / Bubblewrap read to generate the APK.
 *
 * The packaged app is a full-screen shell around the live site, so login and
 * every action still hit the same Supabase backend — nothing to re-wire.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus Conveyance",
    short_name: "Conveyance",
    description:
      "Reserve your seat, track your bus live, and travel safely to campus every day.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1c1917",
    theme_color: "#f4a521",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
