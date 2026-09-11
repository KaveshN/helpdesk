import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Help Desk',
    template: '%s | Help Desk',
  },
  description: 'Multi-tenant help desk platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
