import {
  MapPin,
  Shield,
  Bell,
  Calendar,
  Users,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';

// Shared marketing/trust copy — the single source of truth for the landing page
// stats/trust/FAQ sections AND the signed-in pre-booking dashboards + Help &
// Support page. Keeping it here stops the two from drifting apart.

export type TrustItem = { icon: LucideIcon; title: string; desc: string };

/** "Why Campus Conveyance" trust + safety highlights. */
export const trustHighlights: TrustItem[] = [
  { icon: MapPin, title: 'Live Vehicle Tracking', desc: 'Track buses and vans in real time on every route.' },
  { icon: Shield, title: 'Safe Transportation', desc: 'Verified drivers and continuously monitored routes.' },
  { icon: Bell, title: 'Instant Notifications', desc: 'Arrival, delay, and route alerts as they happen.' },
  { icon: Calendar, title: 'Easy Booking', desc: 'Reserve a seat for your daily route in a few steps.' },
  { icon: Users, title: 'Parent Transparency', desc: 'Parents can monitor student travel status live.' },
  { icon: CreditCard, title: 'Secure Payments', desc: 'A safe and reliable UPI payment experience.' },
];

export type Faq = { question: string; answer: string };

/** Top questions — shown in full on Help & Support, a preview on the dashboard. */
export const faqs: Faq[] = [
  { question: 'How can students book transportation?', answer: 'Students register an account, select their school or college, choose a verified bus or van, pick their pickup stop, and reserve a seat on the route for their daily commute.' },
  { question: 'Can parents track buses?', answer: "Yes, parents can monitor their child's travel status and track buses in real time through the parent dashboard." },
  { question: 'Are drivers verified?', answer: 'Absolutely — all drivers are thoroughly verified and routes are continuously monitored for safety.' },
  { question: 'How are payments handled?', answer: 'Payments are made over UPI to the platform, then confirmed once verified — a safe and reliable flow with a clear payment window.' },
  { question: 'Is live tracking available?', answer: 'Yes, real-time live tracking is available for all buses and vans while the driver is online for your ride.' },
  { question: 'Can I cancel or get a refund?', answer: 'You can cancel from My bookings. If you had already paid, you can request a refund while cancelling and the team processes it.' },
];
