import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { brand, brandStyleSheet } from '@/config/brand';
import { readPreferences } from '@/lib/preferences/schema';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { ThemeScript } from '@/components/theme/theme-script';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: {
    default: brand.productName,
    template: `%s | ${brand.productName}`,
  },
  description: 'Multi-tenant help desk platform',
};

const brandCss = brandStyleSheet();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading cookies makes the root dynamic. Every route already is
  // (force-dynamic per page), so nothing is lost.
  const cookieStore = await cookies();
  const preferences = readPreferences((name) => cookieStore.get(name)?.value);

  // "system" leaves the attribute off so <ThemeScript /> resolves it from the
  // OS before first paint; an explicit choice is stamped here, server-side.
  const explicitTheme = preferences.theme === 'system' ? undefined : preferences.theme;

  return (
    <html
      lang="en-ZA"
      data-theme={explicitTheme}
      data-density={preferences.density}
      data-sidebar={preferences.sidebar}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        <ThemeScript />
        {brandCss ? <style dangerouslySetInnerHTML={{ __html: brandCss }} /> : null}
        <ThemeProvider initial={preferences}>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
