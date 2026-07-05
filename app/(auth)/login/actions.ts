'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { setSessionCookie, clearSessionCookie, type SessionUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/dashboard') || '/dashboard';

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    return { error: 'Invalid email or password.' };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return { error: 'Invalid email or password.' };
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  await setSessionCookie(sessionUser);
  await logAudit({ user: sessionUser, action: 'LOGIN', module: 'Auth' });

  redirect(next.startsWith('/') ? next : '/dashboard');
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect('/login');
}
