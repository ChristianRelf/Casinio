import type { Metadata } from "next";
import { DM_Sans, Libre_Caslon_Display } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });
const display = Libre_Caslon_Display({ variable: "--font-display", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000"),
  title: "Low Stakes — Private blackjack with friends",
  description: "A private, play-money blackjack table for friends. No purchases, prizes, or cash value.",
  openGraph: {
    title: "Low Stakes — Private blackjack with friends",
    description: "A private, play-money blackjack table for friends. No purchases, prizes, or cash value.",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "Low Stakes private blackjack with friends" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Low Stakes — Private blackjack with friends",
    description: "A private, play-money blackjack table for friends. No purchases, prizes, or cash value.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${sans.variable} ${display.variable}`}>{children}</body></html>;
}
