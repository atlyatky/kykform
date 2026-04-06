import nodemailer from "nodemailer";

const host = process.env.MAIL_HOST ?? "localhost";
const port = Number(process.env.MAIL_PORT ?? "1025");
const from = process.env.MAIL_FROM ?? "forms@kyk.local";

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: false,
});

export async function sendMail(to: string[], subject: string, text: string) {
  if (!to.length) return;
  await transporter.sendMail({
    from,
    to: to.join(", "),
    subject,
    text,
  });
}
