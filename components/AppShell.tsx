'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Store,
  Package,
  ShoppingCart,
  TrendingUp,
  Undo2,
  Receipt,
  Boxes,
  Banknote,
  PieChart,
  FileBarChart,
  Wallet,
  ShieldCheck,
  DatabaseBackup,
  Menu,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/config';
import { logoutAction } from '@/app/(auth)/login/actions';
import type { SessionUser } from '@/lib/auth';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/stores', label: 'Stores', icon: Store },
  { href: '/products', label: 'Products & Inventory', icon: Package },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { href: '/sales', label: 'Sales Income', icon: TrendingUp },
  { href: '/returns', label: 'Returns & Refunds', icon: Undo2 },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/accessories', label: 'Accessories', icon: Boxes },
  { href: '/settlements', label: 'Daraz Settlements', icon: Banknote },
  { href: '/profit-loss', label: 'Profit & Loss', icon: PieChart },
  { href: '/cash-flow', label: 'Cash Flow', icon: Wallet },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
] as const;

const OWNER_NAV = [
  { href: '/audit-log', label: 'Audit Log', icon: ShieldCheck },
  { href: '/backup', label: 'Backup & Export', icon: DatabaseBackup },
] as const;

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  const navContent = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive(item.href)
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            )}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" style={{ width: 18, height: 18 }} />
            {item.label}
          </Link>
        );
      })}

      {user.role === 'OWNER' && (
        <>
          <div className="mt-4 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Owner only
          </div>
          {OWNER_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive(item.href)
                    ? 'bg-amber-50 text-amber-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <Icon style={{ width: 18, height: 18 }} className="shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </>
      )}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Wallet className="h-5 w-5" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold text-slate-900">{APP_NAME}</p>
        <p className="text-[11px] text-slate-400">Ledger & Inventory</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {brand}
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-white shadow-xl">
            {brand}
            {navContent}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="ml-auto">
            <UserMenu user={user} />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
          {user.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-slate-800">
            {user.name}
          </span>
          <span className="block text-[11px] capitalize text-slate-400">
            {user.role.toLowerCase()}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-medium text-slate-800">{user.name}</p>
              <p className="truncate text-xs text-slate-400">{user.email}</p>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
