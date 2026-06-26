import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KE GovVault — Kenya Government Document Intelligence',
  description: 'Full-text searchable archive of Kenya Gazette, court rulings, Hansard, budgets, and government documents with AI-powered analysis.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}