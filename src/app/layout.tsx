import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GoDevLab Hub",
  description: "Internal agency dashboard",
};

// Applied before paint so a saved light/accent preference never flashes the
// dark-green default first. Defaults (no saved preference): dark + Pitch.
const themeInitScript = `
try {
  var theme = localStorage.getItem("godevlab.theme");
  if (theme !== "light") document.documentElement.classList.add("dark");
  var accent = localStorage.getItem("godevlab.accent");
  if (accent && /^[1-5]$/.test(accent)) document.documentElement.setAttribute("data-accent", accent);
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`min-h-screen ${plusJakartaSans.variable} ${jetbrainsMono.variable}`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
