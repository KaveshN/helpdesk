import { redirect } from 'next/navigation';
import { getActor } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const actor = await getActor();
  redirect(actor ? '/dashboard' : '/login');
}
