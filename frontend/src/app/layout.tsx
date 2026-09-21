import type { Metadata, Viewport } from 'next'
import './globals.css'
import { brand } from '@/lib/brand'
import Providers from './providers'

// Every page here is a 'use client' page driven by client-side state/query
// params and client-fetched data — Next.js has no server-side signal that
// any of them are dynamic, so it was fully static-optimizing them and
// serving `Cache-Control: s-maxage=31536000` (1 year) app-wide. That let
// the browser (and any proxy in between) keep replaying an old build's
// HTML shell for up to a year after a new deploy, regardless of which JS
// bundle actually got fetched — a real, reproduced cause of "I rebuilt but
// the UI still looks like the old version" reports. Forcing the whole app
// dynamic here (root layout, applies to every nested route) stops it.
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: brand.productName,
  description: 'Project task compliance checking tool',
  icons: { icon: brand.logo },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
