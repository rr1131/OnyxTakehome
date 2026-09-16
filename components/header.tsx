import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function Header() {
  const { userId } = await auth();

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        Onyx Paper Trading
      </Link>
      <nav aria-label="Main navigation">
        {userId ? (
          <>
            <Link href="/dashboard">Dashboard</Link>
            <span className="auth-state">Signed in</span>
            <UserButton />
          </>
        ) : (
          <>
            <Link href="/sign-in">Sign in</Link>
            <Link href="/sign-up">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}
