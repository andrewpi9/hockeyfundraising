import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono, Oswald } from "next/font/google";
import "./globals.css";
import { brand } from "@/lib/brand";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: `Support ${brand.name}. Every gift goes to the program.`,
  openGraph: { siteName: brand.name, images: [brand.logo] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {/* Inside <body> per Clerk's guidance. `dynamic` is required for the nonce-based strict CSP. */}
        <ClerkProvider dynamic>{children}</ClerkProvider>
      </body>
    </html>
  );
}
