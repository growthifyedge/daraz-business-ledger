import type { Prisma, PrismaClient, StockMovementType } from '@prisma/client';
import type { SessionUser } from './auth';

type Client = PrismaClient | Prisma.TransactionClient;

/** Thrown by a guarded outflow when there is not enough stock. */
export const INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK';

interface MovementArgs {
  productId: string;
  storeId?: string | null;
  type: StockMovementType;
  /** Signed effect on currentStock: positive to add, negative to reduce. */
  quantity: number;
  toStoreId?: string | null;
  reference?: string | null;
  note?: string | null;
  user: SessionUser | null;
  /**
   * When true, a negative movement is applied atomically only if enough stock
   * exists; otherwise it throws INSUFFICIENT_STOCK (race-safe backstop for
   * user-initiated outflows like sales and manual reductions). Reversal /
   * correction paths leave this false so they can never be trapped.
   */
  guard?: boolean;
}

/**
 * Apply a stock change to a product and record it in the movement history.
 * `quantity` is the signed delta applied to `currentStock`.
 * Must be called inside a transaction when combined with other writes.
 */
export async function recordMovement(client: Client, args: MovementArgs) {
  if (args.quantity !== 0) {
    if (args.guard && args.quantity < 0) {
      // Atomic guarded decrement: only succeeds if enough stock remains.
      const res = await client.product.updateMany({
        where: { id: args.productId, currentStock: { gte: -args.quantity } },
        data: { currentStock: { increment: args.quantity } },
      });
      if (res.count === 0) throw new Error(INSUFFICIENT_STOCK);
    } else {
      await client.product.update({
        where: { id: args.productId },
        data: { currentStock: { increment: args.quantity } },
      });
    }
  }
  await client.stockMovement.create({
    data: {
      productId: args.productId,
      storeId: args.storeId ?? null,
      type: args.type,
      quantity: args.quantity,
      toStoreId: args.toStoreId ?? null,
      reference: args.reference ?? null,
      note: args.note ?? null,
      createdById: args.user?.id ?? null,
      createdBy: args.user?.name ?? null,
    },
  });
}
