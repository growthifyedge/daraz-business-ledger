'use server';

import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { decryptPii } from '@/lib/daraz/crypto';

export interface RevealedCustomer {
  ok: boolean;
  error?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  phone?: string | null;
  nationalRegistrationNumber?: string | null;
  shippingName?: string | null;
  shippingAddress?: string | null;
  shippingCity?: string | null;
  billingName?: string | null;
  billingAddress?: string | null;
  trackingCode?: string | null;
}

/**
 * Reveal the decrypted customer/shipping details for one order item. Owner/Admin
 * only. Every reveal is audit-logged — but the audit stores ONLY the order-item
 * id and the fact of a reveal, never the decrypted values.
 */
export async function revealCustomer(orderItemId: string): Promise<RevealedCustomer> {
  const user = await requireUser(); // OWNER or ADMIN (only roles that exist)

  const oi = await prisma.darazOrderItem.findUnique({
    where: { orderItemId },
    select: {
      trackingCodeEnc: true,
      shippingNameEnc: true,
      shippingAddressEnc: true,
      shippingCityEnc: true,
      billingNameEnc: true,
      billingAddressEnc: true,
      customer: {
        select: {
          nameEnc: true,
          emailEnc: true,
          phoneEnc: true,
          nationalRegistrationEnc: true,
        },
      },
    },
  });
  if (!oi) return { ok: false, error: 'Order item not found.' };

  // Audit BEFORE returning — record the access, never the value.
  await logAudit({
    user,
    action: 'VIEW',
    module: 'DarazCustomerReveal',
    recordId: orderItemId,
    newValue: { revealed: true, fields: ['customer', 'shipping', 'billing', 'tracking'] },
  });

  try {
    return {
      ok: true,
      customerName: decryptPii(oi.customer?.nameEnc),
      customerEmail: decryptPii(oi.customer?.emailEnc),
      phone: decryptPii(oi.customer?.phoneEnc),
      nationalRegistrationNumber: decryptPii(oi.customer?.nationalRegistrationEnc),
      shippingName: decryptPii(oi.shippingNameEnc),
      shippingAddress: decryptPii(oi.shippingAddressEnc),
      shippingCity: decryptPii(oi.shippingCityEnc),
      billingName: decryptPii(oi.billingNameEnc),
      billingAddress: decryptPii(oi.billingAddressEnc),
      trackingCode: decryptPii(oi.trackingCodeEnc),
    };
  } catch {
    // Never leak ciphertext or key details in the error.
    return { ok: false, error: 'Could not decrypt customer data (key mismatch or tampered record).' };
  }
}
