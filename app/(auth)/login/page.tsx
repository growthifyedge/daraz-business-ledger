import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';
import { Wallet } from 'lucide-react';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
            <Wallet className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">{APP_NAME}</h1>
          <p className="text-sm text-slate-500">{APP_TAGLINE}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <Suspense fallback={<div className="h-48" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Secure access for authorised staff only.
        </p>
      </div>
    </div>
  );
}
