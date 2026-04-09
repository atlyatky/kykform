/**
 * Son N form gönderimini siler (test temizliği / geri alma).
 * Kullanım (API konteynerinde): node scripts/delete-last-submissions.mjs <form-slug> [adet]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const slug = process.argv[2];
const n = Math.min(100, Math.max(1, parseInt(process.argv[3] || "3", 10)));

if (!slug) {
  console.error("Kullanım: node scripts/delete-last-submissions.mjs <form-slug> [adet]");
  process.exit(1);
}

async function main() {
  const form = await prisma.form.findUnique({ where: { slug } });
  if (!form) {
    console.error("Form bulunamadı:", slug);
    process.exit(1);
  }
  const last = await prisma.submission.findMany({
    where: { formId: form.id },
    orderBy: { createdAt: "desc" },
    take: n,
    select: { id: true },
  });
  if (!last.length) {
    console.log("Silinecek kayıt yok.");
    return;
  }
  const r = await prisma.submission.deleteMany({
    where: { id: { in: last.map((x) => x.id) } },
  });
  console.log(`Silindi: ${r.count} gönderim (form: ${slug})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
