'use client';

import { cn } from '@/lib/utils';
import { Trash2, Loader2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

function Inner({
  label,
  className,
  icon,
}: {
  label: ReactNode;
  className?: string;
  icon?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-lg text-xs font-medium transition disabled:opacity-50',
        className
      )}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        icon && <Trash2 className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}

/**
 * A delete/confirm button that asks for confirmation before running a
 * server action. Pass the server action and the record id.
 */
export function ConfirmButton({
  action,
  id,
  message = 'Are you sure? This can be undone from the trash if soft-deleted.',
  label,
  icon = true,
  className = 'h-8 w-8 p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600',
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  message?: string;
  label?: ReactNode;
  icon?: boolean;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Inner label={label} className={className} icon={icon} />
    </form>
  );
}
