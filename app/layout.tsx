import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import Header from "@/components/header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onyx Paper Trading",
  description: "Onyx paper-trading application.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider
          signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
          signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
          signInFallbackRedirectUrl={
            process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ||
            "/dashboard"
          }
          signUpFallbackRedirectUrl={
            process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ||
            "/dashboard"
          }
          afterSignOutUrl="/"
        >
          <Header />
          <main className="container">{children}</main>
        </ClerkProvider>
      </body>
    </html>
  );
}
