import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { brand } from '@/lib/brand'

const inter = Inter({ subsets: ['latin'] })

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
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
