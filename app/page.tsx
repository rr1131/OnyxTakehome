import Link from "next/link";

export default function HomePage() {
  return (
    <section className="panel">
      <h1>Onyx Paper Trading</h1>
      <p>Sign in to access your dashboard.</p>
      <Link className="button" href="/dashboard" prefetch={false}>
        Open dashboard
      </Link>
    </section>
  );
}
