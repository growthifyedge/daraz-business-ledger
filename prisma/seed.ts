import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = (process.env.OWNER_EMAIL ?? 'owner@example.com').toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD ?? 'ChangeMe123!';
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'yahya@example.com').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

  // --- Users -------------------------------------------------------------
  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      name: 'Owner',
      role: 'OWNER',
      passwordHash: await bcrypt.hash(ownerPassword, 10),
    },
  });
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Yahya',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(adminPassword, 10),
    },
  });
  console.log(`✔ Users ready: ${ownerEmail} (OWNER), ${adminEmail} (ADMIN)`);

  // Only seed demo business data once (skip if any store exists).
  const existingStores = await prisma.store.count();
  if (existingStores > 0) {
    console.log('✔ Demo data already present — skipping sample records.');
    return;
  }

  // --- Stores ------------------------------------------------------------
  const storeA = await prisma.store.create({
    data: { name: 'Gadget Hub', notes: 'Main Daraz store', active: true },
  });
  const storeB = await prisma.store.create({
    data: { name: 'Lifestyle Corner', notes: 'Secondary store', active: true },
  });

  // --- Products ----------------------------------------------------------
  const productsData = [
    { name: 'Wireless Earbuds Pro', sku: 'GAD-001', purchaseCost: 950, sellingPrice: 1899, currentStock: 40, minStockLevel: 10 },
    { name: 'Smart Watch Series 6', sku: 'GAD-002', purchaseCost: 1800, sellingPrice: 3499, currentStock: 8, minStockLevel: 10 },
    { name: 'USB-C Fast Charger 25W', sku: 'GAD-003', purchaseCost: 420, sellingPrice: 899, currentStock: 60, minStockLevel: 15 },
    { name: 'Bluetooth Speaker Mini', sku: 'GAD-004', purchaseCost: 700, sellingPrice: 1499, currentStock: 25, minStockLevel: 8 },
    { name: 'Phone Ring Holder', sku: 'GAD-005', purchaseCost: 60, sellingPrice: 199, currentStock: 0, minStockLevel: 20 },
    { name: 'LED Desk Lamp', sku: 'GAD-006', purchaseCost: 850, sellingPrice: 1699, currentStock: 18, minStockLevel: 6 },
  ];

  const products: { id: string }[] = [];
  for (const p of productsData) {
    const created = await prisma.product.create({
      data: {
        ...p,
        category: 'Lifestyle Gadgets',
        stores: {
          create: [{ storeId: storeA.id }, ...(Math.random() > 0.5 ? [{ storeId: storeB.id }] : [])],
        },
        movements: {
          create: p.currentStock
            ? [{ type: 'ADD', quantity: p.currentStock, note: 'Opening stock' }]
            : [],
        },
      },
    });
    products.push(created);
  }
  console.log(`✔ ${products.length} products created`);

  // --- Owner investment --------------------------------------------------
  await prisma.investment.create({
    data: { date: daysAgo(45), amount: 150000, note: 'Initial capital' },
  });

  // --- Purchases ---------------------------------------------------------
  await prisma.purchase.create({
    data: {
      date: daysAgo(30),
      purchasedBy: 'Yahya',
      storeId: storeA.id,
      productId: products[0].id,
      quantity: 40,
      unitCost: 950,
      totalCost: 38000,
      paymentStatus: 'PAID',
      reimbursementDate: daysAgo(28),
      bankReference: 'TRX-10021',
    },
  });
  await prisma.purchase.create({
    data: {
      date: daysAgo(12),
      purchasedBy: 'Yahya',
      storeId: storeA.id,
      productId: products[2].id,
      quantity: 60,
      unitCost: 420,
      totalCost: 25200,
      paymentStatus: 'UNPAID',
    },
  });

  // --- Sales -------------------------------------------------------------
  const sale = (
    productIdx: number,
    qty: number,
    gross: number,
    days: number
  ) => {
    const commission = Math.round(gross * 0.1);
    const vat = Math.round(gross * 0.05);
    const other = 50;
    const net = gross - commission - vat - other;
    return prisma.sale.create({
      data: {
        date: daysAgo(days),
        storeId: storeA.id,
        productId: products[productIdx].id,
        quantitySold: qty,
        grossAmount: gross,
        commission,
        vat,
        otherCharges: other,
        returnsRefunds: 0,
        netAmount: net,
      },
    });
  };
  await sale(0, 10, 18990, 20);
  await sale(2, 15, 13485, 15);
  await sale(3, 6, 8994, 8);
  await sale(0, 8, 15192, 3);

  // --- Expenses ----------------------------------------------------------
  await prisma.expense.createMany({
    data: [
      { date: daysAgo(25), category: 'PACKAGING', amount: 1200, paidBy: 'Owner', paymentMethod: 'Cash', storeId: storeA.id },
      { date: daysAgo(18), category: 'DELIVERY_TRANSPORT', amount: 800, paidBy: 'Yahya', paymentMethod: 'Cash' },
      { date: daysAgo(10), category: 'BANK_CHARGES', amount: 250, paidBy: 'Owner', paymentMethod: 'Bank Transfer' },
      { date: daysAgo(5), category: 'FLYERS', amount: 600, paidBy: 'Yahya', paymentMethod: 'Cash' },
    ],
  });

  // --- Accessories -------------------------------------------------------
  await prisma.accessory.createMany({
    data: [
      { name: 'Flyer Bags (pack of 100)', quantityPurchased: 500, quantityUsed: 120, unitCost: 8, totalCost: 4000, purchaseDate: daysAgo(25) },
      { name: 'Packing Tape', quantityPurchased: 20, quantityUsed: 7, unitCost: 90, totalCost: 1800, purchaseDate: daysAgo(25) },
      { name: 'Thermal Stickers', quantityPurchased: 1000, quantityUsed: 300, unitCost: 2, totalCost: 2000, purchaseDate: daysAgo(20) },
    ],
  });

  // --- Settlement --------------------------------------------------------
  await prisma.settlement.create({
    data: {
      date: daysAgo(7),
      storeId: storeA.id,
      grossAmount: 42000,
      commission: 4200,
      vat: 2100,
      otherCharges: 300,
      deductions: 0,
      netAmount: 35400,
      bankReference: 'DARAZ-SETTLE-4471',
    },
  });

  console.log('✔ Demo business data seeded');
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
