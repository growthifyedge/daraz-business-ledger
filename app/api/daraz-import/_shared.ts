// Shared upload intake for the Daraz import route handlers. Route handlers (not
// server actions) are used so uploads are not bound by the default 1 MB server-
// action body limit; the runtime is Node (exceljs + crypto + prisma need it).

import { getSession, type SessionUser } from '@/lib/auth';
import { validateUpload, UploadError, LIMITS } from '@/lib/daraz/xlsx';
import { parseUpload, type ParsedUpload } from '@/lib/daraz/persist';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Owner-only gate for the import routes; returns the session or throws 401/403. */
export async function requireOwnerApi(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new HttpError(401, 'Sign in required.');
  if (user.role !== 'OWNER') throw new HttpError(403, 'Owner access required.');
  return user;
}

/** Validate + parse the multipart upload. Throws HttpError on any problem. */
export async function readUpload(req: Request): Promise<ParsedUpload> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Malformed upload.');
  }
  const ordersFile = form.get('ordersFile');
  const incomeFile = form.get('incomeFile');
  try {
    validateUpload(ordersFile, 'orders');
    validateUpload(incomeFile, 'income');
  } catch (e) {
    if (e instanceof UploadError) throw new HttpError(413, e.message);
    throw new HttpError(400, 'Invalid upload.');
  }
  // Combined size guard (Vercel-safe) — belt-and-braces on top of per-file caps.
  if (ordersFile.size + incomeFile.size > LIMITS.combinedMaxBytes) {
    throw new HttpError(413, 'Combined upload exceeds the 4 MB limit.');
  }

  const ordersBuf = Buffer.from(await ordersFile.arrayBuffer());
  const incomeText = new TextDecoder('utf-8').decode(await incomeFile.arrayBuffer());
  try {
    return await parseUpload(ordersBuf, ordersFile.name, incomeText, incomeFile.name);
  } catch (e) {
    if (e instanceof UploadError) throw new HttpError(422, e.message);
    throw new HttpError(422, 'Could not parse the uploaded files. Check they are the verified Daraz exports.');
  }
}
