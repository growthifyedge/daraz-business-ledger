'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Pencil, Store as StoreIcon } from 'lucide-react';
import { saveStore, deleteStore } from './actions';
import { initialFormState } from '@/lib/formState';
import { Button, SubmitButton } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ConfirmButton } from '@/components/ConfirmButton';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import type { PageMeta } from '@/lib/pagination';
import {
  Card,
  CardBody,
  Badge,
  EmptyState,
  Field,
  Input,
  Textarea,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatDate } from '@/lib/utils';

interface StoreRow {
  id: string;
  name: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
  _count: { products: number };
}

export function StoresManager({ stores, meta }: { stores: StoreRow[]; meta: PageMeta }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StoreRow | null>(null);
  const [state, formAction] = useActionState(saveStore, initialFormState);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts]);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(row: StoreRow) {
    setEditing(row);
    setOpen(true);
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Stores
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your Daraz stores. Products can belong to one or many stores.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> New Store
        </Button>
      </div>

      <div className="mb-3">
        <SearchBar placeholder="Search store name or notes…" />
      </div>

      {meta.total === 0 ? (
        meta.q ? (
          <EmptyState
            icon={<StoreIcon className="h-10 w-10" />}
            title="No matching stores"
            message={`No stores match “${meta.q}”. Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={<StoreIcon className="h-10 w-10" />}
            title="No stores yet"
            message="Add your first Daraz store to start tracking products, sales and settlements."
            action={
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> New Store
              </Button>
            }
          />
        )
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Store</TH>
                  <TH align="center">Products</TH>
                  <TH align="center">Status</TH>
                  <TH>Created</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {stores.map((s) => (
                  <TRow key={s.id}>
                    <TD>
                      <div className="font-medium text-slate-800">{s.name}</div>
                      {s.notes && (
                        <div className="max-w-xs truncate text-xs text-slate-400">
                          {s.notes}
                        </div>
                      )}
                    </TD>
                    <TD align="center">{s._count.products}</TD>
                    <TD align="center">
                      <Badge tone={s.active ? 'green' : 'slate'}>
                        {s.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TD>
                    <TD>{formatDate(s.createdAt)}</TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(s)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <ConfirmButton
                          action={deleteStore}
                          id={s.id}
                          message={`Delete store "${s.name}"? It will be hidden but its history is kept.`}
                        />
                      </div>
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} />
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Store' : 'New Store'}
        description="Daraz store details."
      >
        <form action={formAction} className="flex flex-col gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {state.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          )}

          <Field label="Store name" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              defaultValue={editing?.name ?? ''}
              placeholder="e.g. Gadget Hub PK"
              required
            />
          </Field>

          <Field label="Notes" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              defaultValue={editing?.notes ?? ''}
              placeholder="Anything worth remembering about this store"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              name="active"
              defaultChecked={editing ? editing.active : true}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Active
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>{editing ? 'Save changes' : 'Create store'}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
