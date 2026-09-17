import { auth } from "@clerk/nextjs/server";
import MarketBrowser from "@/components/market-browser";

export default async function DashboardPage() {
  const { userId } = await auth.protect();

  return (
    <section className="panel">
      <h1>Dashboard</h1>
      <p>Browse live prediction markets.</p>
      <p className="auth-state">User ID: {userId}</p>
      <MarketBrowser />
    </section>
  );
}
