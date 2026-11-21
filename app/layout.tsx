import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { getRuntimeServerSupabaseConfig } from "@/lib/supabase-env";
import "./globals.css";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BCAS Library",
  description: "Library Management System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const publicConfig = getRuntimeServerSupabaseConfig();
  const serializedConfig =
    publicConfig.url && publicConfig.key
      ? JSON.stringify(publicConfig).replace(/</g, "\\u003c")
      : null;

  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        {serializedConfig && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__SUPABASE_PUBLIC_CONFIG__=${serializedConfig};`,
            }}
          />
        )}
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
