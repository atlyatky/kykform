/**
 * Dashboard'da görünen 8 karakterlik Kayıt ID önekleriyle gönderim siler.
 * Aynı formda önek tek kayda eşleşmeli (aksi halde hata verir).
 *
 * Kullanım:
 *   node scripts/delete-submissions-by-id-prefix.mjs <form-slug-veya-form-id> <id8> [<id8> ...]
 *
 * Örnek:
 *   node scripts/delete-submissions-by-id-prefix.mjs forklift-form cmnq4ts5 cmnq4f5q cmnq4exx
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const key = process.argv[2];
const prefixes = process.argv.slice(3).map((x) => x.trim().toLowerCase()).filter(Boolean);

if (!key || prefixes.length === 0) {
  console.error(
    "Kullanım: node scripts/delete-submissions-by-id-prefix.mjs <form-slug-veya-form-id> <id8> [<id8> ...]"
  );
  process.exit(1);
}

async function resolveForm() {
  let form = await prisma.form.findFirst({
    where: { OR: [{ slug: key }, { id: key }] },
    select: { id: true, slug: true, title: true },
  });
  return form;
}

async function main() {
  const form = await resolveForm();
  if (!form) {
    console.error("Form bulunamadı (slug veya URL’deki form id):", key);
    process.exit(1);
  }
  console.log("Form:", form.title, "| slug:", form.slug);

  const idsToDelete = [];
  for (const p of prefixes) {
    if (p.length < 4) {
      console.error("Önek çok kısa:", p);
      process.exit(1);
    }
    const hits = await prisma.submission.findMany({
      where: { formId: form.id, id: { startsWith: p } },
      select: { id: true },
    });
    if (hits.length === 0) {
      console.error("Bu formda önek için kayıt yok:", p);
      process.exit(1);
    }
    if (hits.length > 1) {
      console.error("Birden fazla kayıt eşleşti (önek belirsiz):", p, hits.map((h) => h.id));
      process.exit(1);
    }
    idsToDelete.push(hits[0].id);
  }

  const r = await prisma.submission.deleteMany({ where: { id: { in: idsToDelete } } });
  console.log("Silinen adet:", r.count);
  for (const id of idsToDelete) console.log(" -", id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
