import Link from "next/link";

export default function HomePage() {
  return (
    <section className="panel">
      <h1>Onyx Paper Trading</h1>
      <p className="page-intro">Practice with $1,000 in virtual cash using live Onyx market prices.</p>
      <p>Sign in to browse markets, buy YES or NO, and track your paper portfolio.</p>
      <Link className="button" href="/dashboard" prefetch={false}>
        Open dashboard
      </Link>
    </section>
  );
}
