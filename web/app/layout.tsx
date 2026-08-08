import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes · Assistente da casa",
  description: "Converse por voz com a Hermes e acesse a memória Arkan em qualquer dispositivo da sua casa.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
